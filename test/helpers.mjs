// Shared test helpers: real temp git repos and a black-box CLI runner.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = join(ROOT, 'bin', 'dossier-scribe.mjs');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'author@example.com',
  GIT_COMMITTER_NAME: 'Test Author',
  GIT_COMMITTER_EMAIL: 'author@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

const made = [];
process.on('exit', () => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

export function tmp(prefix = 'dscribe-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

export function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export function write(dir, rel, content) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

export function lines(n, prefix = 'line') {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';
}

export function docText({ slug = 'app', name = 'App', repo = 'app', status = 'active', lastVerified = '2026-01-01', tags, body = '' } = {}) {
  const fm = [`slug: ${slug}`, `name: ${name}`, `repo: ${repo}`, `status: ${status}`, `last_verified: ${lastVerified}`];
  if (tags) fm.push(`tags: [${tags.join(', ')}]`);
  return `---\n${fm.join('\n')}\n---\n\n${body.trim()}\n`;
}

export const STD_FILES = {
  'lib/auth.mjs': lines(10, 'auth'),
  'lib/db.mjs': lines(10, 'db'),
  'lib/ranged.mjs': lines(10, 'ranged'),
  'src/routes/a.js': lines(3, 'route a'),
  'src/routes/b.js': lines(3, 'route b'),
  'README.md': '# demo\n',
  'misc/other.txt': lines(4, 'other'),
};

export const STD_BODY = `
## Features

- Auth signs sessions. <!-- src: lib/auth.mjs -->
- The database layer pools connections. <!-- src: lib/db.mjs -->
- Routes live under src/routes. <!-- src: src/routes/*.js -->
- The ranged helper is small. <!-- src: lib/ranged.mjs:3-5 -->

## Notes

- A loose remark with no citation.
`;

/**
 * A workspace: root/dossier-scribe.json, root/dossiers/*.md, root/repos/app (git repo).
 */
export function createWorkspace({ files = STD_FILES, docs, config = {}, env = {} } = {}) {
  const root = tmp();
  const repo = join(root, 'repos', 'app');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  for (const [p, c] of Object.entries(files)) write(repo, p, c);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'initial');
  write(root, 'dossier-scribe.json', JSON.stringify({ dossiers: 'dossiers', reposRoot: 'repos', ...config }, null, 2));
  mkdirSync(join(root, 'dossiers'), { recursive: true });
  const ws = {
    root,
    repo,
    dossiers: join(root, 'dossiers'),
    git: (...a) => git(repo, ...a),
    commit(change, msg = 'change') {
      for (const [p, c] of Object.entries(change)) {
        if (c === null) git(repo, 'rm', '-q', '-f', p);
        else write(repo, p, c);
      }
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', msg);
      return git(repo, 'rev-parse', 'HEAD');
    },
    writeDoc(slug, text) {
      write(ws.dossiers, `${slug}.md`, text);
    },
    doc(slug) {
      return readFileSync(join(ws.dossiers, `${slug}.md`), 'utf8');
    },
    lock() {
      return JSON.parse(readFileSync(join(ws.dossiers, '.dossier-lock.json'), 'utf8'));
    },
    state() {
      return JSON.parse(readFileSync(join(ws.dossiers, '.dossier-state.json'), 'utf8'));
    },
    run(args, opts = {}) {
      return run(args, { cwd: root, ...opts, env: { ...env, ...opts.env } });
    },
    check(args = []) {
      const r = ws.run(['check', '--json', ...args]);
      let data = null;
      try { data = JSON.parse(r.stdout); } catch { /* leave null */ }
      return { ...r, data };
    },
    statuses(slug = 'app', args = []) {
      const r = ws.check(args);
      const d = r.data.docs.find((x) => x.slug === slug);
      return Object.fromEntries(d.claims.map((c) => [c.text.slice(0, 18), c.status]));
    },
  };
  if (docs) for (const [slug, text] of Object.entries(docs)) ws.writeDoc(slug, text);
  return ws;
}

/** A workspace with the standard doc already written and (optionally) pinned. */
export function pinnedWorkspace({ pin = true, env = {}, files = STD_FILES, body = STD_BODY } = {}) {
  const ws = createWorkspace({ files, docs: { app: docText({ body }) }, env });
  if (pin) {
    const r = ws.run(['pin', 'app']);
    if (r.status !== 0) throw new Error(`pin failed: ${r.stdout}${r.stderr}`);
  }
  return ws;
}

export function run(args, { cwd, env = {}, input } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: r.stdout + r.stderr };
}

export function listFiles(dir) {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}
