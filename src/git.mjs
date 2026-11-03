// Thin, batched wrapper around the git CLI. Every spawn is counted so tests can
// assert that checks do not spawn one process per claim.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const stats = { gitCalls: 0 };

// Treat paths as literal names, not glob patterns.
const lit = (paths) => paths.map((p) => `:(literal)${p}`);

export class GitError extends Error {}

function exec(cwd, args, input) {
  stats.gitCalls += 1;
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd, input, maxBuffer: 1 << 30 });
  if (r.error) throw new GitError(`could not run git: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr.toString('utf8') };
}

export class Repo {
  constructor(dir) {
    this.dir = dir;
    this._tree = null;
    this._head = undefined;
  }

  run(args, { allowFail = false, input } = {}) {
    const r = exec(this.dir, args, input);
    if (r.status !== 0 && !allowFail) throw new GitError(`git ${args[0]} failed: ${r.stderr.trim()}`);
    return r.status === 0 ? r.stdout.toString('utf8') : null;
  }

  /** HEAD commit sha, or null when the dir is not a git repo or has no commits. */
  head() {
    if (this._head === undefined && !existsSync(this.dir)) this._head = null;
    if (this._head === undefined) this._head = this.run(['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true })?.trim() || null;
    return this._head;
  }

  /** True when the commit exists in this repo (it may be gone after a rewrite of history). */
  isKnown(sha) {
    this._known ??= new Map();
    if (!this._known.has(sha)) this._known.set(sha, exec(this.dir, ['cat-file', '-e', `${sha}^{commit}`]).status === 0);
    return this._known.get(sha);
  }

  /** Map of repo-relative path to blob sha for everything at HEAD (one git call). */
  tree() {
    if (this._tree) return this._tree;
    const map = new Map();
    const out = this.run(['ls-tree', '-r', '-z', 'HEAD']);
    for (const rec of out.split('\0')) {
      if (!rec) continue;
      const tab = rec.indexOf('\t');
      const [, type, blob] = rec.slice(0, tab).split(' ');
      if (type === 'blob') map.set(rec.slice(tab + 1), blob);
    }
    this._tree = map;
    return map;
  }

  /** Read many blobs at HEAD in a single `git cat-file --batch`. Returns Map path to Buffer. */
  readMany(paths, rev = 'HEAD') {
    const found = this.batch(paths.map((p) => `${rev}:./${p}`));
    return new Map(paths.filter((p) => found.has(`${rev}:./${p}`)).map((p) => [p, found.get(`${rev}:./${p}`)]));
  }

  /** Read blobs by sha in one `git cat-file --batch`. Returns Map sha to Buffer; unreadable shas are left out. */
  readBlobs(shas) {
    return this.batch(shas);
  }

  batch(specs) {
    const out = new Map();
    if (specs.length === 0) return out;
    const r = exec(this.dir, ['cat-file', '--batch'], specs.map((p) => `${p}\n`).join(''));
    const buf = r.stdout;
    let pos = 0;
    for (const spec of specs) {
      const nl = buf.indexOf(0x0a, pos);
      const header = buf.toString('utf8', pos, nl);
      pos = nl + 1;
      const m = / blob (\d+)$/.exec(header);
      if (!m) continue;
      const size = Number(m[1]);
      out.set(spec, buf.subarray(pos, pos + size));
      pos += size + 1;
    }
    return out;
  }

  /** Commits (newest first) touching each of the paths in base..HEAD. Returns Map path to commit[]. */
  commitsTouching(base, paths) {
    const result = new Map(paths.map((p) => [p, []]));
    if (paths.length === 0) return result;
    const out = this.run(['log', '--no-renames', '--relative', '--format=%x01%H%x02%ct%x02%s', '--name-only', `${base}..HEAD`, '--', ...lit(paths)]);
    let cur = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('\x01')) {
        const [sha, ct, subject] = line.slice(1).split('\x02');
        cur = { sha, date: Number(ct) * 1000, subject };
      } else if (line && cur) {
        result.get(line)?.push(cur);
      }
    }
    return result;
  }

  /** Diffstat (insertions, deletions) per path between base and HEAD. */
  numstat(base, paths) {
    const result = new Map();
    if (paths.length === 0) return result;
    const out = this.run(['diff', '--numstat', '--no-renames', '--relative', '-z', base, 'HEAD', '--', ...lit(paths)]);
    for (const rec of out.split('\0')) {
      if (!rec.trim()) continue;
      const [ins, del, ...name] = rec.split('\t');
      result.set(name.join('\t').trim(), { insertions: ins === '-' ? 0 : Number(ins), deletions: del === '-' ? 0 : Number(del) });
    }
    return result;
  }

  /** Renames and deletions between base and HEAD. Returns Map oldPath to {status, to}. */
  renames(base) {
    const result = new Map();
    const out = this.run(['diff', '-M', '--name-status', '--relative', '-z', base, 'HEAD']);
    const parts = out.split('\0');
    for (let i = 0; i < parts.length; i += 1) {
      const st = parts[i];
      if (!st) continue;
      if (st[0] === 'R' || st[0] === 'C') {
        if (st[0] === 'R') result.set(parts[i + 1], { status: 'R', to: parts[i + 2], similarity: Number(st.slice(1)) });
        i += 2;
      } else {
        if (st[0] === 'D') result.set(parts[i + 1], { status: 'D' });
        i += 1;
      }
    }
    return result;
  }

  /** Unified diff per path between base and HEAD, split per file. */
  diffs(base, paths, context = 3) {
    const result = new Map();
    if (paths.length === 0) return result;
    const out = this.run(['diff', `-U${context}`, '--no-renames', '--relative', base, 'HEAD', '--', ...lit(paths)]);
    let cur = null;
    let buf = [];
    const done = () => {
      if (cur) result.set(cur, buf.join('\n'));
    };
    for (const line of out.split('\n')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      if (m) {
        done();
        cur = m[2];
        buf = [line];
      } else {
        buf.push(line);
      }
    }
    done();
    return result;
  }

  countSince(base) {
    const out = this.run(['rev-list', '--count', `${base}..HEAD`], { allowFail: true });
    return out === null ? null : Number(out.trim());
  }

  countAfterDate(dateStr) {
    const out = this.run(['rev-list', '--count', `--since=${dateStr}T00:00:00Z`, 'HEAD'], { allowFail: true });
    return out === null ? null : Number(out.trim());
  }

  isAncestor(sha) {
    return exec(this.dir, ['merge-base', '--is-ancestor', sha, 'HEAD']).status === 0;
  }

  /** Date (ms) of a rev, or null. */
  revTime(rev) {
    const out = this.run(['show', '-s', '--format=%ct', rev], { allowFail: true });
    return out ? Number(out.trim()) * 1000 : null;
  }

  /** Paths with uncommitted changes (modified, staged, untracked) in the working tree. */
  dirtyPaths(paths) {
    if (paths.length === 0) return new Set();
    const out = this.run(['status', '--porcelain', '-z', '--', ...lit(paths)], { allowFail: true }) || '';
    return new Set(out.split('\0').filter(Boolean).map((r) => r.slice(3)));
  }

  /** Last commit touching each of the paths: Map path to sha (one git log). */
  lastCommits(paths) {
    const result = new Map();
    if (paths.length === 0) return result;
    const out = this.run(['log', '--no-renames', '--relative', '--format=%x01%H', '--name-only', 'HEAD', '--', ...lit(paths)]);
    let sha = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('\x01')) sha = line.slice(1);
      else if (line && sha && !result.has(line)) result.set(line, sha);
    }
    return result;
  }
}
