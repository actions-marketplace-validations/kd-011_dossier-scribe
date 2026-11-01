import { parse } from '../cli.mjs';
import { loadDossiers } from '../dossiers.mjs';
import { readLock, writeLock } from '../lock.mjs';
import { checkDocs } from '../check.mjs';
import { expandSources, lineSlice, pinDoc } from '../pin.mjs';
import { UsageError } from '../util.mjs';

const WHOLE_FILE_LINES = 40;
const GLOB_FILE_LINES = 12;

export async function run(ctx, args, io) {
  const { values, pos } = parse(args, { claim: { type: 'string' }, ok: { type: 'boolean' } });
  if (!pos[0]) throw new UsageError('usage: dossier-scribe verify <slug> [--claim ID] [--ok]');
  if (values.ok && !values.claim) throw new UsageError('--ok needs --claim ID: it re-pins one claim, use pin to re-pin a whole dossier');
  const doc = loadDossiers(ctx.config).find((d) => d.slug === pos[0]);
  if (!doc) throw new UsageError(`no dossier with slug "${pos[0]}"`);
  if (doc.fmError) throw new UsageError(`${doc.rel}: ${doc.fmError.message}`);
  const lock = readLock(ctx.config);
  const [result] = checkDocs(ctx, [doc], lock);
  if (result.error) throw new UsageError(result.error);
  const repo = ctx.repo(doc.repoDir);

  let wanted;
  if (values.claim) {
    wanted = result.claims.filter((c) => c.id.startsWith(values.claim));
    if (wanted.length !== 1) throw new UsageError(wanted.length ? `claim id "${values.claim}" is ambiguous` : `no claim with id "${values.claim}" in ${doc.slug}`);
  } else {
    wanted = result.claims.filter((c) => ['stale', 'broken', 'new'].includes(c.status));
    if (wanted.length === 0) {
      io.out(`${doc.slug}: all ${result.summary.ok} cited claims match their pins`);
      return 0;
    }
  }

  if (values.ok) {
    const claim = doc.claims.find((c) => c.id === wanted[0].id);
    if (!claim?.cited) throw new UsageError('that claim has no src comment, so there is nothing to pin');
    const missing = claim.sources.filter((s) => !s.glob && !repo.tree().has(s.path));
    if (missing.length) throw new UsageError(`cannot re-pin: ${missing.map((s) => s.path).join(', ')} does not exist at HEAD`);
    pinDoc(ctx, doc, lock, { only: claim.id });
    writeLock(ctx.config, lock);
    io.out(`re-pinned claim ${claim.id} in ${doc.slug}`);
    return 0;
  }

  const tree = repo.tree();
  for (const w of wanted) {
    const claim = doc.claims.find((c) => c.id === w.id);
    io.out(`${doc.rel}:${w.line}  ${w.status.toUpperCase()}  [${w.id}]`);
    io.out(`  ${w.text}`);
    if (!claim?.cited) {
      io.out('');
      continue;
    }
    const { entries } = expandSources(claim, tree);
    const blobs = repo.readMany(entries.filter((e) => tree.has(e.path)).map((e) => e.path));
    const glob = entries.some((e) => e.glob);
    for (const e of entries) {
      io.out('');
      if (!tree.has(e.path)) {
        const moved = w.files.find((f) => f.path === e.path && f.renamedTo);
        io.out(`  ${e.path}  ${moved ? `(renamed to ${moved.renamedTo}, update the src path)` : '(missing at HEAD)'}`);
        continue;
      }
      const buf = blobs.get(e.path);
      const total = buf.toString('utf8').split('\n').length - (buf.toString('utf8').endsWith('\n') ? 1 : 0);
      const [from, to] = e.range ? [e.range.start, e.range.end] : [1, Math.min(total, e.glob || glob ? GLOB_FILE_LINES : WHOLE_FILE_LINES)];
      io.out(`  ${e.path}${e.range ? `:${from}-${to}` : ''}`);
      lineSlice(buf, from, to).split('\n').forEach((l, i) => io.out(`  ${String(from + i).padStart(4)} | ${l}`));
      if (!e.range && to < total) io.out(`       ... ${total - to} more lines`);
    }
    const drift = w.files.filter((f) => f.change === 'modified');
    if (drift.length && w.status === 'stale') {
      const base = lock.docs[doc.slug].claims[w.id].head;
      if (repo.isKnown(base)) {
        const diffs = repo.diffs(base, drift.map((f) => f.path));
        for (const f of drift) {
          io.out('');
          io.out(`  changes to ${f.path} since the pin:`);
          for (const l of (diffs.get(f.path) ?? '').split('\n').slice(0, 60)) io.out(`  ${l}`);
        }
      }
    }
    io.out('');
  }
  io.out(`after checking, re-pin one claim with: dossier-scribe verify ${doc.slug} --claim <id> --ok`);
  return 0;
}
