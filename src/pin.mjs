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

// Windows to try when looking for a moved block: lines times block size.
const RELOCATE_CAP = 2e7;

/**
 * Finds the lines `hash` was taken from when they are no longer at start..end.
 * Returns the {start, end} of the copy nearest the old position, or null when the block is gone.
 * `pinned` is the file as it was at the pin. A block only counts as moved when HEAD still has as many
 * copies of it as the pin did: if it has fewer, a copy was edited in place and another copy elsewhere
 * must not hide that. Without `pinned`, more than one candidate is ambiguous and gives null.
 */
export function relocateRange(buf, { start, end, hash }, pinned = null) {
  const size = end - start + 1;
  const copies = (b) => {
    const text = b.toString('utf8');
    const all = text.split('\n');
    if (text.endsWith('\n')) all.pop();
    if ((all.length - size + 1) * size > RELOCATE_CAP) return null;
    const at = [];
    for (let i = 0; i + size <= all.length; i += 1) if (sha(all.slice(i, i + size).join('\n')) === hash) at.push(i + 1);
    return at;
  };
  const now = copies(buf);
  if (!now || now.length === 0) return null;
  const before = pinned ? copies(pinned) : null;
  if (before && before.length > 0 ? now.length < before.length : now.length > 1) return null;
  const best = now.reduce((a, b) => (Math.abs(b - start) < Math.abs(a - start) ? b : a));
  return { start: best, end: best + size - 1 };
}

const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v));

/**
 * The value at a dotted key of a JSON file, as {found, value, hash, text}. Formatting and key order do not matter.
 * `invalid` is true when the file is not JSON.
 */
export function jsonKeyValue(buf, key) {
  let doc;
  try {
    doc = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    return { found: false, invalid: true };
  }
  let cur = doc;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, part)) return { found: false, invalid: false };
    cur = cur[part];
  }
  const canonical = stable(cur);
  return { found: true, value: cur, hash: sha(canonical), text: canonical.length > 120 ? `${canonical.slice(0, 117)}...` : canonical };
}

/** Expands one claim's sources to concrete file entries against the HEAD tree. */
export function expandSources(claim, tree) {
  const entries = [];
  const globs = {};
  const used = new Set();
  for (const s of claim.sources) {
    if (s.jsonKey) {
      entries.push({ key: `${s.path}#${s.jsonKey}`, path: s.path, glob: null, range: null, jsonKey: s.jsonKey });
    } else if (s.glob) {
      const re = globToRegExp(s.path);
      const matches = [...tree.keys()].filter((p) => re.test(p)).sort();
      globs[s.path] = matches;
      for (const p of matches) {
        if (!used.has(p)) entries.push({ key: p, path: p, glob: s.path, range: null, jsonKey: null });
        used.add(p);
      }
    } else {
      const key = used.has(s.path) ? `${s.path}:${s.start ?? ''}-${s.end ?? ''}` : s.path;
      used.add(s.path);
      entries.push({ key, path: s.path, glob: null, range: s.start === null ? null : { start: s.start, end: s.end }, jsonKey: null });
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
      if (e.range || e.jsonKey) rangedPaths.add(e.path);
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
      if (e.jsonKey) {
        const v = jsonKeyValue(blobs.get(e.path) ?? Buffer.alloc(0), e.jsonKey);
        f.jsonKey = { key: e.jsonKey, hash: v.hash ?? null, value: v.text ?? null };
      }
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
