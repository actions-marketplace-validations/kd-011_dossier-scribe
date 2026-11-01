import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkspace, docText, pinnedWorkspace } from './helpers.mjs';

const wsWith = (body, extra = {}) => createWorkspace({ docs: { app: docText({ body, ...extra }) } });

test('a clean dossier passes lint with exit 0', () => {
  const ws = pinnedWorkspace({ pin: false });
  const r = ws.run(['lint']);
  assert.equal(r.status, 0, r.out);
});

test('a missing src path is an error with file and line', () => {
  const ws = wsWith('## Features\n\n- Gone. <!-- src: lib/missing.mjs -->');
  const r = ws.run(['lint']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /dossiers\/app\.md:\d+: error: .*lib\/missing\.mjs.*does not exist/);
});

test('the reported line is the claim line in the file', () => {
  const ws = wsWith('## Features\n\n- Gone. <!-- src: lib/missing.mjs -->');
  const line = ws.doc('app').split('\n').findIndex((l) => l.startsWith('- Gone.')) + 1;
  assert.match(ws.run(['lint']).stdout, new RegExp(`app\\.md:${line}: error`));
});

test('line ranges beyond the end of the file are errors', () => {
  const ws = wsWith('## Features\n\n- Too far. <!-- src: lib/auth.mjs:8-40 -->');
  const r = ws.run(['lint']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /out of bounds/);
  assert.match(r.stdout, /10 lines/);
});

test('a glob that matches nothing is an error', () => {
  const ws = wsWith('## Features\n\n- No match. <!-- src: nothing/*.rs -->');
  const r = ws.run(['lint']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /matches no files/);
});

test('uncited claims are reported under required sections only', () => {
  const ws = wsWith('## Architecture\n\n- Uncited architecture claim.\n\n## Notes\n\n- Uncited note.');
  const r = ws.run(['lint']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Uncited architecture claim/);
  assert.doesNotMatch(r.stdout, /Uncited note/);
});

test('requireCitations in config overrides the default sections', () => {
  const ws = createWorkspace({
    config: { requireCitations: ['Notes'] },
    docs: { app: docText({ body: '## Features\n\n- Uncited feature.\n\n## Notes\n\n- Uncited note.' }) },
  });
  const r = ws.run(['lint']);
  assert.match(r.stdout, /Uncited note/);
  assert.doesNotMatch(r.stdout, /Uncited feature/);
});

test('uncitedSeverity warn keeps the exit code at 0', () => {
  const ws = createWorkspace({
    config: { uncitedSeverity: 'warn' },
    docs: { app: docText({ body: '## Features\n\n- Uncited feature.' }) },
  });
  const r = ws.run(['lint']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /warning/);
});

test('malformed src comments are errors with line numbers', () => {
  const ws = wsWith('## Features\n\n- Broken. <!-- src: lib/auth.mjs');
  const r = ws.run(['lint']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /app\.md:\d+: error: .*unterminated/i);
});

test('invalid frontmatter is reported with its line number', () => {
  const ws = createWorkspace({ docs: { app: '---\nslug: app\nmeta:\n  nested: no\n---\nBody\n' } });
  const r = ws.run(['lint']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /app\.md:3: error: /);
});

test('frontmatter fields are validated', () => {
  const ws = createWorkspace({
    docs: { app: '---\nslug: Bad Slug\nname: X\nrepo: app\nstatus: active\nlast_verified: 2026-13-45\n---\nBody\n' },
  });
  const r = ws.run(['lint']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /slug/);
  assert.match(r.stdout, /last_verified/);
  const missing = createWorkspace({ docs: { app: '---\nslug: app\nname: X\n---\nBody\n' } }).run(['lint']);
  assert.match(missing.stdout, /repo.*required|missing.*repo/i);
});

test('duplicate slugs across files are errors', () => {
  const ws = createWorkspace({ docs: { app: docText({}), copy: docText({ name: 'Copy' }) } });
  const r = ws.run(['lint']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /duplicate slug "app"/);
});

test('a repo that does not exist is an error', () => {
  const ws = createWorkspace({ docs: { app: docText({ repo: 'nope' }) } });
  const r = ws.run(['lint']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /repo "nope"/);
});

test('lint <slug> checks one dossier; an unknown slug is a usage error', () => {
  const ws = createWorkspace({
    docs: { app: docText({}), other: docText({ slug: 'other', body: '## Features\n\n- Gone. <!-- src: nope.js -->' }) },
  });
  assert.equal(ws.run(['lint', 'app']).status, 0);
  assert.equal(ws.run(['lint', 'other']).status, 1);
  assert.equal(ws.run(['lint', 'ghost']).status, 2);
});

test('lint only looks at committed files at HEAD', () => {
  const ws = wsWith('## Features\n\n- Untracked only. <!-- src: lib/new.mjs -->');
  writeFileSync(join(ws.repo, 'lib', 'new.mjs'), 'x\n');
  const r = ws.run(['lint']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /does not exist/);
});
