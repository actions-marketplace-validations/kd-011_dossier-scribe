import { parse } from '../cli.mjs';
import { loadDossiers, selectDocs } from '../dossiers.mjs';
import { lintDocs, formatProblems } from '../lint.mjs';

export async function run(ctx, args, io) {
  const { values, pos } = parse(args, { json: { type: 'boolean' } });
  const all = loadDossiers(ctx.config);
  const selected = selectDocs(all, pos[0]);
  const problems = lintDocs(ctx, all, selected);
  const errors = problems.filter((p) => p.severity === 'error').length;
  if (values.json) {
    io.out(JSON.stringify({ problems, errors }, null, 2));
  } else {
    for (const l of formatProblems(problems)) io.out(l);
    const warnings = problems.length - errors;
    io.out(problems.length === 0 ? `lint: ${selected.length} dossier(s), no problems` : `lint: ${errors} error(s), ${warnings} warning(s)`);
  }
  return errors > 0 ? 1 : 0;
}
