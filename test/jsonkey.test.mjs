import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpec } from '../src/claims.mjs';
import { pinnedWorkspace, createWorkspace, docText, STD_FILES } from './helpers.mjs';

const PKG = (extra = {}) => JSON.stringify({
  name: 'demo',
  version: '1.0.0',
  engines: { node: '>=20' },
  scripts: { test: 'node --test', 'lint:fix': 'eslint . --fix' },
  dependencies: { left: '^1.0.0' },
  ...extra,
}, null, 2) + '\n';

const FILES = { ...STD_FILES, 'package.json': PKG() };
const BODY = `
## Features

- Needs Node 20. <!-- src: package.json#engines.node -->
- The test script runs node --test. <!-- src: package.json#scripts.test -->
- The fix script exists. <!-- src: package.json#scripts.lint:fix -->
- Depends on left. <!-- src: package.json#dependencies -->
`;
const claimOf = (r, start) => r.data.docs[0].claims.find((c) => c.text.startsWith(start));

test('parseSpec reads path#key and keeps colons and slashes in the key', () => {
  assert.deepEqual(
    { path: 'package.json', jsonKey: 'engines.node', start: null, glob: false },
    (({ path, jsonKey, start, glob }) => ({ path, jsonKey, start, glob }))(parseSpec('package.json#engines.node')),
  );
  assert.equal(parseSpec('package.json#scripts.lint:fix').jsonKey, 'scripts.lint:fix');
  assert.equal(parseSpec('package.json#dependencies.@types/node').jsonKey, 'dependencies.@types/node');
  assert.ok(parseSpec('package.json#').error);
  assert.ok(parseSpec('package.json#a:3-4').error, 'a key cannot be combined with a line range');
  assert.ok(parseSpec('*.json#a').error, 'a key cannot be combined with a glob');
});

test('a version bump in package.json leaves key citations ok', () => {
  const ws = pinnedWorkspace({ files: FILES, body: BODY });
  ws.commit({ 'package.json': PKG({ version: '1.0.1' }) }, '1.0.1');
  const r = ws.check();
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(new Set(Object.values(ws.statuses())), new Set(['ok']));
});

test('reformatting or reordering keys leaves a key citation ok', () => {
  const ws = pinnedWorkspace({ files: FILES, body: BODY });
  const obj = JSON.parse(PKG());
  const reordered = { dependencies: obj.dependencies, scripts: { 'lint:fix': obj.scripts['lint:fix'], test: obj.scripts.test }, engines: obj.engines, version: obj.version, name: obj.name };
  ws.commit({ 'package.json': JSON.stringify(reordered) }, 'minify');
  assert.equal(ws.check().status, 0);
});

test('changing the cited value makes only that claim stale', () => {
  const ws = pinnedWorkspace({ files: FILES, body: BODY });
  ws.commit({ 'package.json': PKG({ engines: { node: '>=22' } }) }, 'node 22');
  const r = ws.check();
  assert.equal(r.status, 1);
  assert.equal(claimOf(r, 'Needs Node').status, 'stale');
  assert.equal(claimOf(r, 'The test script').status, 'ok');
  assert.equal(claimOf(r, 'Depends on').status, 'ok');
  const f = claimOf(r, 'Needs Node').files[0];
  assert.equal(f.jsonKey, 'engines.node');
  assert.equal(f.commits[0].subject, 'node 22');
  assert.match(ws.run(['check']).stdout, /package\.json#engines\.node/);
});

test('adding a dependency stales the dependencies claim and nothing else', () => {
  const ws = pinnedWorkspace({ files: FILES, body: BODY });
  ws.commit({ 'package.json': PKG({ dependencies: { left: '^1.0.0', right: '^2.0.0' } }) }, 'add right');
  const s = Object.values(ws.statuses());
  assert.equal(s.filter((x) => x === 'stale').length, 1);
  assert.equal(claimOf(ws.check(), 'Depends on').status, 'stale');
});

test('removing the cited key makes the claim broken', () => {
  const ws = pinnedWorkspace({ files: FILES, body: BODY });
  const obj = JSON.parse(PKG());
  delete obj.engines;
  ws.commit({ 'package.json': JSON.stringify(obj, null, 2) + '\n' }, 'drop engines');
  const r = ws.check();
  assert.equal(claimOf(r, 'Needs Node').status, 'broken');
  assert.equal(r.status, 1);
});

test('lint rejects a missing key, a non-JSON file and invalid JSON', () => {
  const files = { ...FILES, 'notes.txt': 'x\n', 'broken.json': '{ nope' };
  const body = `
## Features

- Missing key. <!-- src: package.json#engines.npm -->
- Not json. <!-- src: notes.txt#a -->
- Bad json. <!-- src: broken.json#a -->
- Fine. <!-- src: package.json#scripts.test -->
`;
  const ws = createWorkspace({ files, docs: { app: docText({ body }) } });
  const r = ws.run(['lint']);
  assert.equal(r.status, 1);
  assert.match(r.out, /key "engines\.npm" not found in "package\.json"/);
  assert.match(r.out, /"notes\.txt" is not valid JSON/);
  assert.match(r.out, /"broken\.json" is not valid JSON/);
  assert.equal((r.out.match(/error:/g) || []).length, 3);
});

test('two keys of one file in one claim are tracked separately', () => {
  const body = '## Features\n\n- Both. <!-- src: package.json#engines.node, package.json#scripts.test -->\n';
  const ws = pinnedWorkspace({ files: FILES, body });
  assert.equal(Object.keys(Object.values(ws.lock().docs.app.claims)[0].files).length, 2);
  ws.commit({ 'package.json': PKG({ scripts: { test: 'node --test --x', 'lint:fix': 'eslint . --fix' } }) });
  assert.equal(claimOf(ws.check(), 'Both').status, 'stale');
});
