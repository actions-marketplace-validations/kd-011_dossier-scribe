import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '../cli.mjs';
import { loadDossiers } from '../dossiers.mjs';
import { readLock } from '../lock.mjs';
import { checkDocs } from '../check.mjs';
import { renderHtmlReport, renderMarkdownReport } from '../report.mjs';
import { plural } from '../util.mjs';

export async function buildReport(ctx, file) {
  const results = checkDocs(ctx, loadDossiers(ctx.config), readLock(ctx.config));
  const t = ctx.config.thresholds;
  const text = /\.(md|markdown)$/i.test(file) ? renderMarkdownReport(results, t) : renderHtmlReport(results, t);
  writeFileSync(file, text);
  return results;
}

export async function run(ctx, args, io) {
  const { values } = parse(args, { out: { type: 'string', default: 'index.html' } }, { positionals: 0 });
  const file = resolve(values.out);
  const results = await buildReport(ctx, file);
  io.out(`report: wrote ${values.out} (${plural(results.length, 'dossier')})`);
  return 0;
}
