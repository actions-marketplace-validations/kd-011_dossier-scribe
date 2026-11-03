import { parse } from '../cli.mjs';
import { loadDossiers, selectDocs } from '../dossiers.mjs';
import { readLock } from '../lock.mjs';
import { checkDocs, formatCheck, parseSince } from '../check.mjs';
import { stats } from '../git.mjs';
import { UsageError } from '../util.mjs';

const STATES = ['stale', 'broken', 'new', 'moved', 'removed', 'uncited'];

export function failOnSet(spec) {
  const set = spec.split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of set) if (!STATES.includes(s)) throw new UsageError(`--fail-on: unknown state "${s}" (use ${STATES.join(', ')})`);
  return new Set(set);
}

export async function run(ctx, args, io) {
  const { values, pos } = parse(args, {
    json: { type: 'boolean' },
    since: { type: 'string' },
    'fail-on': { type: 'string', default: 'stale,broken' },
  });
  const failOn = failOnSet(values['fail-on']);
  const docs = selectDocs(loadDossiers(ctx.config), pos[0]);
  let since = null;
  if (values.since) {
    since = parseSince(values.since, ctx, docs);
    if (since === null) throw new UsageError(`--since: cannot make sense of "${values.since}" (use 7d, a YYYY-MM-DD date or a git ref)`);
  }
  const results = checkDocs(ctx, docs, readLock(ctx.config), { since });
  const failed = results.some((r) => r.error || STATES.some((s) => failOn.has(s) && r.summary[s] > 0));
  if (values.json) io.out(JSON.stringify({ docs: results, stats: { gitCalls: stats.gitCalls }, failed }, null, 2));
  else {
    for (const l of formatCheck(results)) io.out(l);
    const tot = (k) => results.reduce((n, r) => n + (r.summary?.[k] ?? 0), 0);
    io.out(`check: ${results.length} dossier(s), ${tot('ok')} ok, ${tot('stale')} stale, ${tot('broken')} broken, ${tot('new')} new${tot('moved') ? `, ${tot('moved')} moved` : ''}`);
  }
  return failed ? 1 : 0;
}
