// Builds re-verify tasks from check results. Never edits anything.
import { relative } from 'node:path';
import { plural } from './util.mjs';

function trimDiff(diff, cap) {
  if (diff.length <= cap) return diff;
  const lines = diff.split('\n');
  const kept = [];
  let size = 0;
  for (const l of lines) {
    if (size + l.length + 1 > cap) break;
    kept.push(l);
    size += l.length + 1;
  }
  return `${kept.join('\n')}\n... diff truncated (${lines.length - kept.length} more lines, cap ${cap} bytes)`;
}

export function buildTask(ctx, doc, result, { diffCap }) {
  const repo = ctx.repo(doc.repoDir);
  const drifted = result.claims.filter((c) => c.status === 'stale' || c.status === 'broken');
  const bases = new Map();
  for (const c of drifted) {
    for (const f of c.files) {
      if (f.change === 'deleted' || f.change === 'renamed' || !f.base || !repo.isKnown(f.base)) continue;
      if (!bases.has(f.base)) bases.set(f.base, new Set());
      bases.get(f.base).add(f.path);
    }
  }
  const diffs = new Map();
  for (const [base, paths] of bases) for (const [p, d] of repo.diffs(base, [...paths])) diffs.set(p, d);
  const share = Math.max(500, Math.floor(diffCap / Math.max(1, diffs.size)));
  const claims = drifted.map((c) => ({
    id: c.id,
    line: c.line,
    text: c.text,
    status: c.status,
    reason: c.reason,
    sources: (doc.claims.find((x) => x.id === c.id)?.sources ?? []).map((s) => s.spec),
    files: c.files.map((f) => ({
      path: f.path,
      change: f.change,
      renamedTo: f.renamedTo,
      range: f.range,
      commits: (f.commits ?? []).map((m) => ({ sha: m.sha.slice(0, 7), subject: m.subject })),
      diffstat: f.diffstat,
      diff: diffs.has(f.path) ? trimDiff(diffs.get(f.path), share) : undefined,
    })),
  }));
  return {
    slug: doc.slug,
    name: doc.fm.name,
    dossier: doc.rel,
    dossierPath: doc.file,
    repo: doc.fm.repo,
    repoPath: doc.repoDir,
    root: ctx.config.root,
    lastVerified: doc.fm.last_verified,
    claims,
    unpinned: result.claims.filter((c) => c.status === 'new').map((c) => ({ id: c.id, line: c.line, text: c.text })),
    removed: result.claims.filter((c) => c.status === 'removed').map((c) => ({ id: c.id, text: c.text })),
  };
}

const INSTRUCTIONS = (t) => [
  `1. Re-read every file cited by the claims below, as it is now.`,
  `2. Fix only the claims that are now wrong. Leave claims that are still true exactly as they are.`,
  `3. Keep each claim's \`<!-- src: ... -->\` comment accurate: follow renames, adjust line ranges, add or drop sources. Every claim must keep a src comment.`,
  `4. Do not edit the generated block between \`<!-- auto:start -->\` and \`<!-- auto:end -->\`, and do not change any other part of the file.`,
  `5. Run \`dossier-scribe lint ${t.slug}\` and fix what it reports, then run \`dossier-scribe pin ${t.slug}\`. Pinning records that you checked these claims against the files as they are now.`,
];

function claimBlock(c) {
  const out = [`### Line ${c.line}, ${c.status.toUpperCase()}  [${c.id}]`, '', `> ${c.text}`, '', `Sources: ${c.sources.join(', ')}`, ''];
  for (const f of c.files) {
    const stat = f.diffstat ? ` (+${f.diffstat.insertions} -${f.diffstat.deletions})` : '';
    if (f.change === 'renamed') out.push(`- ${f.path}: renamed to ${f.renamedTo}, update the src path`);
    else if (f.change === 'deleted') out.push(`- ${f.path}: deleted, find where this moved or remove the claim`);
    else if (f.change === 'added') out.push(`- ${f.path}: new file matching a cited glob`);
    else out.push(`- ${f.path}${f.range ? `:${f.range.start}-${f.range.end}` : ''}: changed by ${plural(f.commits.length, 'commit')} since the pin${stat}`);
    for (const m of f.commits.slice(0, 5)) out.push(`  - ${m.sha} ${m.subject}`);
  }
  return out.join('\n');
}

function diffSection(t) {
  const seen = new Set();
  const out = [];
  for (const c of t.claims) {
    for (const f of c.files) {
      if (!f.diff || seen.has(f.path)) continue;
      seen.add(f.path);
      out.push(`### ${f.path}`, '', '```diff', f.diff.replace(/\n$/, ''), '```', '');
    }
  }
  return out.length ? ['## Diffs since the pin', '', ...out] : [];
}

export function renderMarkdown(t) {
  const out = [
    `# Re-verify dossier: ${t.name} (${t.slug})`,
    '',
    `Dossier file: ${t.dossier}`,
    `Repo: ${t.repo}`,
    `Last verified: ${t.lastVerified}`,
    `Drifted claims: ${t.claims.length}`,
    '',
    '## Instructions',
    '',
    ...INSTRUCTIONS(t),
    '',
    '## Drifted claims',
    '',
    ...t.claims.flatMap((c) => [claimBlock(c), '']),
    ...diffSection(t),
  ];
  if (t.unpinned.length) out.push('## Claims not yet pinned', '', ...t.unpinned.map((c) => `- line ${c.line}: ${c.text}`), '');
  if (t.removed.length) out.push('## Pinned claims no longer in the document', '', ...t.removed.map((c) => `- ${c.text}`), '');
  return `${out.join('\n').trimEnd()}\n`;
}

export function renderClaudeCode(t) {
  const out = [
    `You are keeping one project documentation file true. The file is a "dossier": markdown whose factual claims each end with an HTML comment naming the source files they came from, like \`- Sessions are signed with HMAC. <!-- src: lib/auth.mjs, lib/keys.mjs:10-40 -->\`. A lock file records what those source files looked like when the claims were last verified. Some of them have changed since, so the claims below may be out of date.`,
    '',
    `Dossier to edit: ${t.dossier} (working directory: ${t.root})`,
    `Repository to read the cited files from: ${t.repoPath}`,
    `Project: ${t.name}, last verified ${t.lastVerified}`,
    '',
    '## What to do',
    '',
    ...INSTRUCTIONS(t),
    '',
    'The tool never edits prose itself. You are the one rewriting claims. A changed file does not always mean a wrong claim, so check before editing.',
    '',
    '## Drifted claims',
    '',
    ...t.claims.flatMap((c) => [claimBlock(c), '']),
    ...diffSection(t),
  ];
  if (t.unpinned.length) out.push('## Claims not yet pinned (check these too)', '', ...t.unpinned.map((c) => `- line ${c.line}: ${c.text}`), '');
  return `${out.join('\n').trimEnd()}\n`;
}

export const renderJson = (t) => `${JSON.stringify(t, null, 2)}\n`;

export const relPath = (from, to) => relative(from, to) || '.';
