import { globToRegExp } from './claims.mjs';
import { sha, now } from './util.mjs';
import { setLastVerified } from './dossiers.mjs';

export function lineSlice(buf, start, end) {
  const text = buf.toString('utf8');
  const all = text.split('\n');
  if (text.endsWith('\n')) all.pop();
  return all.slice(start - 1, end).join('\n');
}

export const rangeHash = (buf, start, end) => sha(lineSlice(buf, start, end));

/** Expands one claim's sources to concrete file entries against the HEAD tree. */
export function expandSources(claim, tree) {
  const entries = [];
  const globs = {};
  const used = new Set();
  for (const s of claim.sources) {
    if (s.glob) {
      const re = globToRegExp(s.path);
      const matches = [...tree.keys()].filter((p) => re.test(p)).sort();
      globs[s.path] = matches;
      for (const p of matches) {
        if (!used.has(p)) entries.push({ key: p, path: p, glob: s.path, range: null });
        used.add(p);
      }
    } else {
      const key = used.has(s.path) ? `${s.path}:${s.start ?? ''}-${s.end ?? ''}` : s.path;
      used.add(s.path);
      entries.push({ key, path: s.path, glob: null, range: s.start === null ? null : { start: s.start, end: s.end } });
    }
  }
  return { entries, globs };
}

/**
 * Builds lock records for the given claims at the repo's current HEAD.
 * Two git calls regardless of claim count (log for commits, cat-file for ranges).
 */
export function buildRecords(repo, claims) {
  const head = repo.head();
  const tree = repo.tree();
  const expanded = new Map(claims.map((c) => [c.id, expandSources(c, tree)]));
  const allPaths = new Set();
  const rangedPaths = new Set();
  for (const { entries } of expanded.values()) {
    for (const e of entries) {
      if (!tree.has(e.path)) continue;
      allPaths.add(e.path);
      if (e.range) rangedPaths.add(e.path);
    }
  }
  const commits = repo.lastCommits([...allPaths]);
  const blobs = repo.readMany([...rangedPaths]);
  const records = new Map();
  for (const c of claims) {
    const { entries, globs } = expanded.get(c.id);
    const files = {};
    for (const e of entries) {
      const f = { path: e.path, blob: tree.get(e.path), commit: commits.get(e.path) ?? head };
      if (e.glob) f.glob = e.glob;
      if (e.range) f.range = { ...e.range, hash: rangeHash(blobs.get(e.path) ?? Buffer.alloc(0), e.range.start, e.range.end) };
      files[e.key] = f;
    }
    const rec = { text: c.text.length > 160 ? `${c.text.slice(0, 157)}...` : c.text, line: c.line, specs: c.sources.map((s) => s.spec), head, files };
    if (Object.keys(globs).length) rec.globs = globs;
    records.set(c.id, rec);
  }
  return records;
}

/**
 * Pins a dossier into `lock`. With `only` (a claim id) just that claim is re-pinned and the
 * document is left alone. Returns the list of cited paths that have uncommitted changes.
 */
export function pinDoc(ctx, doc, lock, { only = null, date } = {}) {
  const repo = ctx.repo(doc.repoDir);
  const cited = doc.claims.filter((c) => c.cited && (!only || c.id === only));
  const records = buildRecords(repo, cited);
  const paths = new Set();
  for (const r of records.values()) for (const f of Object.values(r.files)) paths.add(f.path);
  const dirty = [...repo.dirtyPaths([...paths])];
  const entry = lock.docs[doc.slug] ?? { claims: {} };
  if (only) {
    for (const [id, rec] of records) entry.claims[id] = rec;
    entry.pinnedAt ??= now().toISOString();
    entry.head ??= repo.head();
  } else {
    entry.claims = Object.fromEntries(records);
    entry.pinnedAt = now().toISOString();
    entry.head = repo.head();
    setLastVerified(doc, date);
  }
  lock.docs[doc.slug] = entry;
  return dirty;
}
