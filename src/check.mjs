import { globToRegExp } from './claims.mjs';
import { jsonKeyValue, rangeHash, relocateRange } from './pin.mjs';
import { daysBetween, parseDuration, now, plural } from './util.mjs';

/** green / amber / red from stale and broken claims and days since verified. */
export function docState(summary, t) {
  if (summary.broken > 0 || summary.stale >= t.redStale || summary.daysSinceVerified > t.redDays) return 'red';
  if (summary.stale > 0 || summary.new > 0 || summary.moved > 0 || summary.daysSinceVerified > t.amberDays) return 'amber';
  return 'green';
}

/** --since accepts 7d / 12h, a YYYY-MM-DD date, or any git revision. Returns epoch ms. */
export function parseSince(spec, ctx, docs) {
  if (/^\d+\s*[dhm]$/.test(spec)) return now().getTime() - parseDuration(spec);
  if (/^\d{4}-\d{2}-\d{2}$/.test(spec)) return new Date(`${spec}T00:00:00Z`).getTime();
  for (const d of docs) {
    if (!d.repoDir) continue;
    const t = ctx.repo(d.repoDir).revTime(spec);
    if (t) return t;
  }
  return null;
}

const specKey = (specs) => [...specs].sort().join('\n');

function evalClaim(claim, rec, tree, blobs, pinnedBlob = () => null) {
  const files = [];
  const moved = [];
  let broken = false;
  for (const f of Object.values(rec.files)) {
    if (!tree.has(f.path)) {
      files.push({ path: f.path, change: 'deleted', glob: f.glob ?? null, base: rec.head });
      if (!f.glob) broken = true;
      continue;
    }
    if (f.jsonKey) {
      const v = jsonKeyValue(blobs.get(f.path) ?? Buffer.alloc(0), f.jsonKey.key);
      if (!v.found) {
        files.push({ path: f.path, change: 'keyRemoved', jsonKey: f.jsonKey.key, was: f.jsonKey.value, base: rec.head });
        broken = true;
      } else if (v.hash !== f.jsonKey.hash) {
        files.push({ path: f.path, change: 'modified', jsonKey: f.jsonKey.key, was: f.jsonKey.value, now: v.text, base: rec.head });
      }
    } else if (f.range) {
      const buf = blobs.get(f.path) ?? Buffer.alloc(0);
      if (rangeHash(buf, f.range.start, f.range.end) !== f.range.hash) {
        const to = relocateRange(buf, f.range, pinnedBlob(f.blob));
        const range = { start: f.range.start, end: f.range.end };
        if (to) moved.push({ path: f.path, change: 'moved', range, movedTo: to, base: rec.head });
        else files.push({ path: f.path, change: 'modified', range, base: rec.head });
      }
    } else if (tree.get(f.path) !== f.blob) {
      files.push({ path: f.path, change: 'modified', base: rec.head });
    }
  }
  for (const [pattern, was] of Object.entries(rec.globs ?? {})) {
    const re = globToRegExp(pattern);
    const current = [...tree.keys()].filter((p) => re.test(p)).sort();
    if (current.length === 0 && was.length > 0) {
      broken = true;
      files.push({ path: pattern, change: 'deleted', glob: pattern, base: rec.head });
    }
    for (const p of current) if (!was.includes(p)) files.push({ path: p, change: 'added', glob: pattern, base: rec.head });
  }
  const specsChanged = specKey(claim.sources.map((s) => s.spec)) !== specKey(rec.specs);
  if (broken) return { status: 'broken', reason: files.every((f) => f.change === 'keyRemoved') ? 'a cited key was removed' : 'a cited file was deleted or renamed', files };
  if (files.length) return { status: 'stale', reason: 'a cited file changed since the pin', files };
  if (specsChanged) return { status: 'stale', reason: 'sources edited since the pin, re-pin to record them', files };
  if (moved.length) return { status: 'moved', reason: 'the cited lines are unchanged but sit at other line numbers, update the numbers and re-pin', files: moved };
  return { status: 'ok', files };
}

export function checkDocs(ctx, docs, lock, { since = null } = {}) {
  const t = ctx.config.thresholds;
  const results = [];
  // One cat-file per repo for every ranged file across every doc.
  const rangedByRepo = new Map();
  for (const doc of docs) {
    if (!doc.repoDir || doc.fmError) continue;
    const repo = ctx.repo(doc.repoDir);
    if (!repo.head()) continue;
    const entry = lock.docs[doc.slug];
    if (!entry) continue;
    const set = rangedByRepo.get(doc.repoDir) ?? new Set();
    for (const rec of Object.values(entry.claims)) for (const f of Object.values(rec.files)) if ((f.range || f.jsonKey) && repo.tree().has(f.path)) set.add(f.path);
    rangedByRepo.set(doc.repoDir, set);
  }
  const blobsByRepo = new Map([...rangedByRepo].map(([dir, set]) => [dir, ctx.repo(dir).readMany([...set])]));
  const sinceCache = new Map();
  const pinnedCache = new Map();
  const commitsSince = (repo, head, date) => {
    const key = `${repo.dir}|${head ?? date}`;
    if (!sinceCache.has(key)) sinceCache.set(key, head ? repo.countSince(head) : repo.countAfterDate(date));
    return sinceCache.get(key);
  };

  for (const doc of docs) {
    const base = { slug: doc.slug, name: doc.fm?.name ?? doc.slug, file: doc.rel };
    if (doc.fmError) {
      results.push({ ...base, state: 'red', error: `${doc.rel}:${doc.fmError.line}: ${doc.fmError.message.replace(/^line \d+: /, '')}`, summary: null, claims: [] });
      continue;
    }
    const repo = doc.repoDir ? ctx.repo(doc.repoDir) : null;
    if (!repo || !repo.head()) {
      results.push({ ...base, state: 'red', error: `${doc.rel}: repo "${doc.fm.repo}" is not a git repository with at least one commit`, summary: null, claims: [] });
      continue;
    }
    const entry = lock.docs[doc.slug] ?? null;
    const tree = repo.tree();
    const blobs = blobsByRepo.get(doc.repoDir) ?? new Map();
    const pinnedBlob = (sha) => {
      if (!sha) return null;
      if (!pinnedCache.has(sha)) pinnedCache.set(sha, repo.readBlobs([sha]).get(sha) ?? null);
      return pinnedCache.get(sha);
    };
    const claims = [];
    const currentIds = new Set();
    for (const c of doc.claims) {
      if (!c.cited) {
        if (c.required) claims.push({ id: c.id, line: c.line, text: c.text, status: 'uncited', files: [] });
        continue;
      }
      currentIds.add(c.id);
      const rec = entry?.claims[c.id];
      if (!rec) {
        claims.push({ id: c.id, line: c.line, text: c.text, status: 'new', files: [] });
        continue;
      }
      const r = evalClaim(c, rec, tree, blobs, pinnedBlob);
      claims.push({ id: c.id, line: c.line, text: c.text, ...r, head: rec.head });
    }
    if (entry) {
      for (const [id, rec] of Object.entries(entry.claims)) {
        if (!currentIds.has(id)) claims.push({ id, line: rec.line, text: rec.text, status: 'removed', files: [] });
      }
    }
    enrich(repo, claims);
    let hidden = 0;
    const visible = since === null ? claims : claims.filter((c) => {
      if (c.status !== 'stale' && c.status !== 'broken') return true;
      const withCommits = c.files.filter((f) => f.commits);
      if (withCommits.length === 0) return true;
      const keep = withCommits.some((f) => f.commits.some((m) => m.date >= since));
      if (!keep) hidden += 1;
      return keep;
    });
    for (const c of visible) {
      for (const f of c.files) {
        if (f.commits) f.commits = f.commits.map((m) => ({ sha: m.sha, subject: m.subject, date: new Date(m.date).toISOString() }));
      }
    }
    const count = (s) => visible.filter((c) => c.status === s).length;
    const lastVerified = doc.fm.last_verified;
    const summary = {
      ok: count('ok'),
      stale: count('stale'),
      broken: count('broken'),
      new: count('new'),
      removed: count('removed'),
      moved: count('moved'),
      uncited: count('uncited'),
      hidden,
      pinned: Boolean(entry),
      lastVerified,
      daysSinceVerified: daysBetween(lastVerified),
      commitsSinceVerified: commitsSince(repo, entry?.head && repo.isKnown(entry.head) ? entry.head : null, lastVerified),
    };
    results.push({ ...base, state: docState(summary, t), summary, claims: visible, malformed: doc.problems.length });
  }
  return results;
}

/** Adds commits, diffstat and rename info to drifted file entries: a few batched git calls per doc. */
function enrich(repo, claims) {
  const groups = new Map();
  for (const c of claims) {
    if (c.status !== 'stale' && c.status !== 'broken') continue;
    for (const f of c.files) {
      if (!groups.has(f.base)) groups.set(f.base, []);
      groups.get(f.base).push(f);
    }
  }
  for (const [base, files] of groups) {
    if (!repo.isKnown(base)) continue;
    const paths = [...new Set(files.map((f) => f.path))];
    const commits = repo.commitsTouching(base, paths);
    const stat = repo.numstat(base, paths);
    const renames = files.some((f) => f.change === 'deleted') ? repo.renames(base) : new Map();
    for (const f of files) {
      f.commits = commits.get(f.path) ?? [];
      const r = renames.get(f.path);
      if (f.change === 'deleted' && r?.status === 'R') {
        f.change = 'renamed';
        f.renamedTo = r.to;
        f.similarity = r.similarity;
      }
      f.diffstat = stat.get(f.path) ?? { insertions: 0, deletions: 0 };
    }
  }
}

const span = (r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`);

const mark = { stale: 'STALE ', broken: 'BROKEN', new: 'NEW   ', moved: 'MOVED ', removed: 'REMOVED', uncited: 'UNCITED' };

export function formatCheck(results, { verbose = true } = {}) {
  const out = [];
  for (const r of results) {
    if (r.error) {
      out.push(`${r.slug}  error  ${r.error}`);
      continue;
    }
    const s = r.summary;
    const bits = [`${s.ok} ok`];
    for (const k of ['stale', 'broken', 'new', 'moved', 'removed', 'uncited']) if (s[k]) bits.unshift(`${s[k]} ${k}`);
    if (s.hidden) bits.push(`${s.hidden} older than --since`);
    out.push(`${r.slug}  ${r.state}  ${bits.join(', ')}  verified ${s.daysSinceVerified}d ago, ${plural(s.commitsSinceVerified ?? 0, 'commit')} since${s.pinned ? '' : ', never pinned'}`);
    if (!verbose) continue;
    const listed = new Set();
    for (const c of r.claims) {
      if (c.status === 'ok') continue;
      out.push(`  ${(mark[c.status] ?? c.status).padEnd(7)} line ${c.line}  ${c.text.length > 90 ? `${c.text.slice(0, 87)}...` : c.text}  [${c.id}]`);
      if (c.reason && c.status !== 'removed') out.push(`          ${c.reason}`);
      for (const f of c.files) {
        const name = f.jsonKey ? `${f.path}#${f.jsonKey}` : f.range ? `${f.path}:${span(f.range)}` : f.path;
        if (f.change === 'renamed') out.push(`          ${f.path}  renamed to ${f.renamedTo}${f.similarity ? ` (${f.similarity}% similar)` : ''}`);
        else if (f.change === 'deleted') out.push(`          ${f.path}  deleted`);
        else if (f.change === 'keyRemoved') out.push(`          ${name}  key removed${f.was ? ` (was ${f.was})` : ''}`);
        else if (f.change === 'added') out.push(`          ${f.path}  added, matches a cited glob`);
        else if (f.change === 'moved') out.push(`          ${name}  now at ${span(f.movedTo)}`);
        else {
          const n = f.commits?.length ?? 0;
          const stat = f.diffstat ? ` (+${f.diffstat.insertions} -${f.diffstat.deletions})` : '';
          const lead = f.jsonKey ? `value changed${f.was && f.now ? `, was ${f.was}, now ${f.now}` : ''}; the file has ${plural(n, 'commit')} since the pin` : f.range ? `range changed; the file has ${plural(n, 'commit')} since the pin` : `changed by ${plural(n, 'commit')}`;
          out.push(`          ${name}  ${lead}${stat}`);
          const key = `${f.path}|${f.base}`;
          if (listed.has(key) && n) {
            out.push('            same change as above');
            continue;
          }
          listed.add(key);
        }
        for (const m of (f.commits ?? []).slice(0, 5)) out.push(`            ${m.sha.slice(0, 7)}  ${m.subject}`);
        if ((f.commits?.length ?? 0) > 5) out.push(`            ... and ${f.commits.length - 5} more`);
      }
    }
    const whole = new Map();
    for (const c of r.claims) {
      if (c.status !== 'stale') continue;
      for (const f of c.files) if (f.change === 'modified' && !f.range && !f.jsonKey && f.path.endsWith('.json')) whole.set(f.path, (whole.get(f.path) ?? 0) + 1);
    }
    for (const [file, n] of whole) out.push(`  tip: ${file} is cited whole by ${plural(n, 'claim')} and changes with every release. Cite one key instead, e.g. ${file}#${file.endsWith('package.json') ? 'engines.node' : 'some.key'}`);
    if (r.malformed) out.push(`  ${plural(r.malformed, 'malformed src comment')}, run lint`);
  }
  return out;
}
