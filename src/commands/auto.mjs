import { writeFileSync } from 'node:fs';
import { parse } from '../cli.mjs';
import { loadDossiers, selectDocs } from '../dossiers.mjs';
import { AUTO_START, AUTO_END } from '../claims.mjs';
import { collectFacts } from '../collectors.mjs';

/** Returns the doc text with its auto block regenerated, appending a block when there is none. */
export function renderAuto(ctx, doc) {
  const repo = ctx.repo(doc.repoDir);
  const facts = collectFacts(repo, { collectors: ctx.config.collectors, units: ctx.config.systemdUnits[doc.slug] ?? [] });
  const inner = facts.length ? facts.join('\n') : '- no collectors matched this repo';
  const block = `${AUTO_START}\n${inner}\n${AUTO_END}`;
  const a = doc.text.indexOf(AUTO_START);
  const b = doc.text.indexOf(AUTO_END);
  if (a === -1 && b === -1) return `${doc.text.trimEnd()}\n\n## Generated facts\n\n${block}\n`;
  if (a === -1 || b === -1 || b < a) throw new Error(`${doc.rel}: unbalanced auto:start / auto:end markers`);
  return doc.text.slice(0, a) + block + doc.text.slice(b + AUTO_END.length);
}

export async function run(ctx, args, io) {
  const { values, pos } = parse(args, { check: { type: 'boolean' } });
  const docs = selectDocs(loadDossiers(ctx.config), pos[0]);
  let stale = 0;
  let failed = false;
  for (const doc of docs) {
    if (doc.fmError || !doc.repoDir || !ctx.repo(doc.repoDir).head()) {
      io.err(`${doc.rel}: cannot read the repo, run lint`);
      failed = true;
      continue;
    }
    let next;
    try {
      next = renderAuto(ctx, doc);
    } catch (err) {
      io.err(err.message);
      failed = true;
      continue;
    }
    if (next === doc.text) {
      io.out(`${doc.slug}: auto block is up to date`);
    } else if (values.check) {
      stale += 1;
      io.out(`${doc.slug}: auto block is out of date, run: dossier-scribe auto ${doc.slug}`);
    } else {
      writeFileSync(doc.file, next);
      io.out(`${doc.slug}: auto block updated`);
    }
  }
  return failed || stale > 0 ? 1 : 0;
}
