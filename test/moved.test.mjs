import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinnedWorkspace, lines } from './helpers.mjs';

const RANGED = (n) => lines(n, 'ranged');
const claimOf = (r, start) => r.data.docs[0].claims.find((c) => c.text.startsWith(start));

test('lines inserted above a cited range: the claim is MOVED, not stale, and does not fail', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/ranged.mjs': 'new first line\nand another\n' + RANGED(10) });
  const r = ws.check();
  assert.equal(r.status, 0, r.out);
  const c = claimOf(r, 'The ranged helper');
  assert.equal(c.status, 'moved');
  assert.deepEqual(c.files[0].range, { start: 3, end: 5 });
  assert.deepEqual(c.files[0].movedTo, { start: 5, end: 7 });
  assert.equal(r.data.docs[0].summary.moved, 1);
  assert.equal(r.data.docs[0].summary.stale, 0);
});

test('check prints the new line numbers for a moved claim and the doc turns amber', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/ranged.mjs': 'new first line\nand another\n' + RANGED(10) });
  const out = ws.run(['check']).stdout;
  assert.match(out, /MOVED/);
  assert.match(out, /lib\/ranged\.mjs:3-5\s+now at 5-7/);
  assert.match(out, /1 moved/);
  assert.equal(ws.check().data.docs[0].state, 'amber');
});

test('--fail-on moved makes a moved claim exit 1', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/ranged.mjs': 'new first line\n' + RANGED(10) });
  assert.equal(ws.run(['check', '--fail-on', 'moved']).status, 1);
  assert.equal(ws.run(['check']).status, 0);
});

test('lines removed above a cited range also count as moved', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/ranged.mjs': RANGED(10).split('\n').slice(1).join('\n') });
  const c = claimOf(ws.check(), 'The ranged helper');
  assert.equal(c.status, 'moved');
  assert.deepEqual(c.files[0].movedTo, { start: 2, end: 4 });
});

test('editing a line inside the range after a shift is stale, not moved', () => {
  const ws = pinnedWorkspace();
  const body = RANGED(10).split('\n');
  body[3] = 'changed inside';
  ws.commit({ 'lib/ranged.mjs': 'shift\n' + body.join('\n') });
  assert.equal(claimOf(ws.check(), 'The ranged helper').status, 'stale');
});

test('a block repeated elsewhere resolves to the copy nearest the pinned lines', () => {
  const block = 'alpha\nbeta\ngamma\n';
  const file = ['head 1', 'head 2', block.trim(), 'mid 1', 'mid 2', 'mid 3', block.trim(), 'tail 1'].join('\n') + '\n';
  const body = '## Features\n\n- The block. <!-- src: lib/dup.mjs:3-5 -->\n';
  const ws = pinnedWorkspace({ files: { 'lib/dup.mjs': file, 'README.md': '# x\n' }, body });
  ws.commit({ 'lib/dup.mjs': 'one new line\n' + file });
  const c = claimOf(ws.check(), 'The block');
  assert.equal(c.status, 'moved');
  assert.deepEqual(c.files[0].movedTo, { start: 4, end: 6 });
});

test('a moved claim is not queued, and re-pinning after fixing the numbers returns it to ok', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/ranged.mjs': 'new first line\nand another\n' + RANGED(10) });
  const q = ws.run(['queue', '--out', 'tasks']);
  assert.match(q.stdout, /queue: 0 tasks? written|nothing/i);
  ws.writeDoc('app', ws.doc('app').replace('lib/ranged.mjs:3-5', 'lib/ranged.mjs:5-7'));
  assert.equal(ws.run(['pin', 'app']).status, 0);
  const c = claimOf(ws.check(), 'The ranged helper');
  assert.equal(c.status, 'ok');
});

test('an unmoved, unchanged range stays plain ok', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/ranged.mjs': RANGED(10) + 'appended\n' });
  const c = claimOf(ws.check(), 'The ranged helper');
  assert.equal(c.status, 'ok');
  assert.equal(c.files.length, 0);
});

test('editing a cited line in place is stale even when an identical line exists elsewhere in the file', () => {
  const file = ['a', 'b', 'c', 'd', 'timeout: 30,', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 'timeout: 30,', 'u'].join('\n') + '\n';
  const body = '## Features\n\n- The timeout is 30. <!-- src: lib/config.mjs:5 -->\n';
  const ws = pinnedWorkspace({ files: { 'lib/config.mjs': file, 'README.md': '# x\n' }, body });
  ws.commit({ 'lib/config.mjs': file.replace('timeout: 30,', 'timeout: 60,') });
  const r = ws.check();
  assert.equal(claimOf(r, 'The timeout').status, 'stale');
  assert.equal(r.status, 1);
});

test('a block that shifted while an identical copy was added elsewhere is still moved', () => {
  const file = ['a', 'b', 'c', 'd', 'timeout: 30,', 'f', 'g'].join('\n') + '\n';
  const body = '## Features\n\n- The timeout is 30. <!-- src: lib/config.mjs:5 -->\n';
  const ws = pinnedWorkspace({ files: { 'lib/config.mjs': file, 'README.md': '# x\n' }, body });
  ws.commit({ 'lib/config.mjs': 'new\n' + file + 'timeout: 30,\n' });
  const c = claimOf(ws.check(), 'The timeout');
  assert.equal(c.status, 'moved');
  assert.deepEqual(c.files[0].movedTo, { start: 6, end: 6 });
});
