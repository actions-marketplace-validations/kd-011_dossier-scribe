import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkspace, docText, lines, tmp } from './helpers.mjs';

const body = (n) => `## Features\n\n- Feature ${n} works. <!-- src: lib/f${n}.mjs -->\n- Untouched ${n}. <!-- src: lib/stable.mjs -->`;
const FILES = { 'lib/f1.mjs': lines(5, 'f1'), 'lib/f2.mjs': lines(5, 'f2'), 'lib/f3.mjs': lines(5, 'f3'), 'lib/stable.mjs': lines(5, 'stable') };

function drifted(count = 3, extra = {}) {
  const docs = {};
  for (let n = 1; n <= count; n += 1) docs[`d${n}`] = docText({ slug: `d${n}`, name: `Doc ${n}`, body: body(n) });
  const ws = createWorkspace({ files: FILES, docs, ...extra });
  assert.equal(ws.run(['pin', '--all']).status, 0);
  const change = {};
  for (let n = 1; n <= count; n += 1) change[`lib/f${n}.mjs`] = lines(5, `f${n}`) + `added line for feature ${n}\n`;
  ws.commit(change, 'tweak features');
  return ws;
}

const NOW = '2026-04-01T09:00:00Z';

test('queue writes one task per drifted doc with the stale claims, diffs and instructions', () => {
  const ws = drifted(2);
  ws.writeDoc('clean', docText({ slug: 'clean', name: 'Clean', body: '## Features\n\n- Stable. <!-- src: lib/stable.mjs -->' }));
  ws.run(['pin', 'clean']);
  const docBefore = ws.doc('d1');
  const lockBefore = JSON.stringify(ws.lock());
  const out = join(ws.root, 'tasks');
  const r = ws.run(['queue', '--out', out], { env: { DSCRIBE_NOW: NOW } });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(readdirSync(out).sort(), ['d1.md', 'd2.md'], 'no task for the clean doc');
  const task = readFileSync(join(out, 'd1.md'), 'utf8');
  assert.match(task, /Feature 1 works/);
  assert.doesNotMatch(task, /Untouched 1/, 'ok claims are not listed as stale');
  assert.match(task, /lib\/f1\.mjs/);
  assert.match(task, /\+added line for feature 1/);
  assert.doesNotMatch(task, /added line for feature 2/);
  assert.match(task, /dossier-scribe pin d1/);
  assert.match(task, /fix only the claims/i);
  assert.equal(ws.doc('d1'), docBefore, 'queue never edits dossier prose');
  assert.equal(JSON.stringify(ws.lock()), lockBefore, 'queue never touches the lock');
});

test('queue --max caps how many tasks are written', () => {
  const ws = drifted(3);
  const out = join(ws.root, 'tasks');
  const r = ws.run(['queue', '--out', out, '--max', '2'], { env: { DSCRIBE_NOW: NOW } });
  assert.equal(r.status, 0, r.out);
  assert.equal(readdirSync(out).length, 2);
  const again = ws.run(['queue', '--out', out, '--max', '2', '--cooldown', '0'], { env: { DSCRIBE_NOW: NOW } });
  assert.equal(readdirSync(out).length, 2, 'the cap is per day, a second run adds nothing');
  assert.match(again.out, /cap/i);
});

test('queue respects the per-doc cooldown and records it in .dossier-state.json', () => {
  const ws = drifted(1);
  const out = join(ws.root, 'tasks');
  const q = (now, extra = []) => ws.run(['queue', '--out', out, '--max', '9', ...extra], { env: { DSCRIBE_NOW: now } });
  assert.match(q('2026-04-01T09:00:00Z').out, /d1/);
  assert.ok(existsSync(join(ws.dossiers, '.dossier-state.json')));
  const second = q('2026-04-03T09:00:00Z');
  assert.match(second.out, /cooldown/i);
  assert.match(second.out, /0 task|no tasks/i);
  const third = q('2026-04-09T10:00:00Z');
  assert.doesNotMatch(third.out, /cooldown/i, '8 days later the 7 day cooldown has passed');
  assert.match(third.out, /1 task/);
  assert.match(q('2026-04-09T11:00:00Z', ['--cooldown', '0']).out, /1 task/, '--cooldown 0 disables it');
});

test('re-pinning resets the cooldown for the next drift', () => {
  const ws = drifted(1);
  const out = join(ws.root, 'tasks');
  const q = (now) => ws.run(['queue', '--out', out, '--max', '9'], { env: { DSCRIBE_NOW: now } });
  q('2026-04-01T09:00:00Z');
  ws.run(['pin', 'd1'], { env: { DSCRIBE_NOW: '2026-04-02T09:00:00Z' } });
  ws.commit({ 'lib/f1.mjs': 'drift again\n' });
  assert.match(q('2026-04-02T10:00:00Z').out, /1 task/);
});

test('large diffs are trimmed to the size cap', () => {
  const ws = drifted(1);
  ws.commit({ 'lib/f1.mjs': lines(4000, 'rewritten') }, 'big rewrite');
  const out = join(ws.root, 'tasks');
  ws.run(['queue', '--out', out, '--diff-cap', '3000'], { env: { DSCRIBE_NOW: NOW } });
  const task = readFileSync(join(out, 'd1.md'), 'utf8');
  assert.ok(task.length < 9000, `task is ${task.length} chars`);
  assert.match(task, /truncated/i);
});

test('queue --format json and claude-code', () => {
  const ws = drifted(1);
  const j = join(ws.root, 'j');
  ws.run(['queue', '--out', j, '--format', 'json'], { env: { DSCRIBE_NOW: NOW } });
  const data = JSON.parse(readFileSync(join(j, 'd1.json'), 'utf8'));
  assert.equal(data.slug, 'd1');
  assert.equal(data.claims.length, 1);
  assert.equal(data.claims[0].files[0].path, 'lib/f1.mjs');
  assert.match(data.claims[0].files[0].diff, /\+added line/);
  const c = join(ws.root, 'c');
  ws.run(['queue', '--out', c, '--format', 'claude-code', '--cooldown', '0'], { env: { DSCRIBE_NOW: NOW } });
  const files = readdirSync(c);
  assert.equal(files.length, 1);
  const prompt = readFileSync(join(c, files[0]), 'utf8');
  assert.match(prompt, /Feature 1 works/);
  assert.match(prompt, /dossier-scribe pin d1/);
  assert.match(prompt, /dossiers\/d1\.md/, 'names the file to edit');
  assert.match(prompt, /lib\/f1\.mjs/);
  assert.match(prompt, /\+added line for feature 1/);
});

test('--dispatch-cmd receives each task on stdin', () => {
  const ws = drifted(2);
  const sink = tmp();
  const r = ws.run(['queue', '--out', join(ws.root, 'tasks'), '--dispatch-cmd', `cat > ${sink}/got-$DSCRIBE_SLUG.txt`], { env: { DSCRIBE_NOW: NOW } });
  assert.equal(r.status, 0, r.out);
  const got1 = readFileSync(join(sink, 'got-d1.txt'), 'utf8');
  assert.match(got1, /Feature 1 works/);
  assert.match(got1, /dossier-scribe pin d1/);
  assert.match(readFileSync(join(sink, 'got-d2.txt'), 'utf8'), /Feature 2 works/);
});

test('a failing dispatch command exits 1 and does not start a cooldown', () => {
  const ws = drifted(1);
  const bad = ws.run(['queue', '--out', join(ws.root, 'tasks'), '--dispatch-cmd', 'exit 3'], { env: { DSCRIBE_NOW: NOW } });
  assert.equal(bad.status, 1);
  const retry = ws.run(['queue', '--out', join(ws.root, 'tasks'), '--dispatch-cmd', 'cat > /dev/null'], { env: { DSCRIBE_NOW: NOW } });
  assert.equal(retry.status, 0, retry.out);
  assert.match(retry.out, /1 task/);
});

test('without --dispatch-cmd nothing is executed', () => {
  const ws = drifted(1);
  const sink = tmp();
  ws.run(['queue', '--out', join(ws.root, 'tasks')], { env: { DSCRIBE_NOW: NOW, DSCRIBE_DISPATCH_CMD: `touch ${sink}/ran` } });
  assert.equal(existsSync(join(sink, 'ran')), false);
});

test('a change outside a cited range produces no task', () => {
  const ws = createWorkspace({
    files: { 'lib/r.mjs': lines(10, 'r') },
    docs: { app: docText({ body: '## Features\n\n- Ranged. <!-- src: lib/r.mjs:2-3 -->' }) },
  });
  ws.run(['pin', 'app']);
  ws.commit({ 'lib/r.mjs': lines(9, 'r') + 'tail changed\n' });
  const out = join(ws.root, 'tasks');
  const r = ws.run(['queue', '--out', out]);
  assert.equal(r.status, 0);
  assert.equal(existsSync(out) ? readdirSync(out).length : 0, 0);
});
