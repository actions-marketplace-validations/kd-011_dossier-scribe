import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from '../cli.mjs';
import { loadDossiers } from '../dossiers.mjs';
import { readLock, readState, writeState } from '../lock.mjs';
import { checkDocs } from '../check.mjs';
import { buildTask, renderMarkdown, renderClaudeCode, renderJson } from '../task.mjs';
import { UsageError, now, parseDuration, plural } from '../util.mjs';

const FORMATS = {
  md: { ext: 'md', render: renderMarkdown },
  json: { ext: 'json', render: renderJson },
  'claude-code': { ext: 'prompt.md', render: renderClaudeCode },
};

export async function run(ctx, args, io) {
  const t = ctx.config.thresholds;
  const { values } = parse(
    args,
    {
      out: { type: 'string', default: 'dossier-tasks' },
      format: { type: 'string', default: 'md' },
      max: { type: 'string', default: String(t.maxPerDay) },
      cooldown: { type: 'string', default: t.cooldown },
      'diff-cap': { type: 'string', default: String(t.diffBytes) },
      'dispatch-cmd': { type: 'string' },
    },
    { positionals: 0 },
  );
  const fmt = FORMATS[values.format];
  if (!fmt) throw new UsageError(`--format must be one of ${Object.keys(FORMATS).join(', ')}`);
  const max = Number(values.max);
  const diffCap = Number(values['diff-cap']);
  if (!Number.isInteger(max) || max < 0) throw new UsageError('--max must be a whole number');
  if (!Number.isInteger(diffCap) || diffCap < 1) throw new UsageError('--diff-cap must be a positive number of bytes');
  const cooldown = parseDuration(values.cooldown);

  const docs = loadDossiers(ctx.config);
  const results = checkDocs(ctx, docs, readLock(ctx.config));
  const lock = readLock(ctx.config);
  const state = readState(ctx.config);
  const day = now().toISOString().slice(0, 10);
  const drifted = results
    .map((r, i) => ({ r, doc: docs[i] }))
    .filter(({ r }) => !r.error && (r.summary.stale > 0 || r.summary.broken > 0))
    .sort((a, b) => b.r.summary.stale + b.r.summary.broken - (a.r.summary.stale + a.r.summary.broken) || b.r.summary.daysSinceVerified - a.r.summary.daysSinceVerified);
  // A doc that is no longer drifted starts fresh next time.
  for (const slug of Object.keys(state.docs)) if (!drifted.some(({ r }) => r.slug === slug)) delete state.docs[slug];

  const outDir = resolve(values.out);
  let written = 0;
  let cooled = 0;
  let capped = 0;
  let failed = false;
  for (const { r, doc } of drifted) {
    const prev = state.docs[r.slug];
    const pinnedAt = lock.docs[r.slug]?.pinnedAt ?? null;
    if (cooldown > 0 && prev && prev.pinnedAt === pinnedAt && now().getTime() - new Date(prev.at).getTime() < cooldown) {
      cooled += 1;
      io.out(`skipped ${r.slug}: cooldown, queued ${prev.at.slice(0, 10)}`);
      continue;
    }
    if ((state.emitted[day] ?? 0) >= max) {
      capped += 1;
      io.out(`skipped ${r.slug}: daily cap of ${max} reached`);
      continue;
    }
    const task = buildTask(ctx, doc, r, { diffCap });
    const content = fmt.render(task);
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `${r.slug}.${fmt.ext}`);
    writeFileSync(file, content);
    if (values['dispatch-cmd']) {
      const p = spawnSync('sh', ['-c', values['dispatch-cmd']], {
        input: content,
        stdio: ['pipe', 'inherit', 'inherit'],
        env: { ...process.env, DSCRIBE_SLUG: r.slug, DSCRIBE_TASK_FILE: file },
      });
      if (p.status !== 0) {
        io.err(`dispatch failed for ${r.slug} (exit ${p.status ?? p.signal}), not counted against the cooldown`);
        failed = true;
        continue;
      }
    }
    state.docs[r.slug] = { at: now().toISOString(), pinnedAt };
    state.emitted[day] = (state.emitted[day] ?? 0) + 1;
    written += 1;
    io.out(`queued ${r.slug}: ${plural(r.summary.stale + r.summary.broken, 'drifted claim')} -> ${relative(process.cwd(), file) || file}${values['dispatch-cmd'] ? ' (dispatched)' : ''}`);
  }
  for (const d of Object.keys(state.emitted)) if (d !== day) delete state.emitted[d];
  writeState(ctx.config, state);
  const skipped = [cooled && `${cooled} in cooldown`, capped && `${capped} over the daily cap`].filter(Boolean);
  io.out(`queue: ${plural(written, 'task')} written${skipped.length ? `, ${skipped.join(', ')}` : ''}${drifted.length === 0 ? ', nothing has drifted' : ''}`);
  return failed ? 1 : 0;
}
