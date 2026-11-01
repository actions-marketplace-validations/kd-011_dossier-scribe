import { parse } from '../cli.mjs';
import { loadDossiers, selectDocs } from '../dossiers.mjs';
import { lintDocs, formatProblems } from '../lint.mjs';
import { readLock, writeLock } from '../lock.mjs';
import { pinDoc } from '../pin.mjs';
import { UsageError, today, plural } from '../util.mjs';

export async function run(ctx, args, io) {
  const { values, pos } = parse(args, { all: { type: 'boolean' } });
  if (!pos[0] && !values.all) throw new UsageError('say which dossier to pin: dossier-scribe pin <slug>, or pin --all');
  const all = loadDossiers(ctx.config);
  const selected = selectDocs(all, values.all ? null : pos[0]);
  // Uncited claims are lint's concern; pinning only needs every citation to resolve.
  const problems = lintDocs(ctx, all, selected).filter((p) => p.severity === 'error' && !p.message.startsWith('uncited claim'));
  const blocked = new Set(problems.map((p) => p.file));
  for (const l of formatProblems(problems)) io.err(l);
  const lock = readLock(ctx.config);
  let failed = false;
  for (const doc of selected) {
    if (blocked.has(doc.rel)) {
      io.err(`${doc.slug}: not pinned, fix the lint errors above first`);
      failed = true;
      continue;
    }
    const dirty = pinDoc(ctx, doc, lock, { date: today() });
    const n = doc.claims.filter((c) => c.cited).length;
    io.out(`pinned ${doc.slug}: ${plural(n, 'claim')}, last_verified ${today()}`);
    if (dirty.length) io.err(`warning: ${doc.slug}: ${plural(dirty.length, 'cited file')} with uncommitted changes, pinned the committed (HEAD) version: ${dirty.join(', ')}`);
  }
  writeLock(ctx.config, lock);
  return failed ? 1 : 0;
}
