import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinnedWorkspace, createWorkspace, docText, lines, tmp, git, write, run, STD_FILES } from './helpers.mjs';

const PKG = (v, node = '>=20') => JSON.stringify({ name: 'demo', version: v, engines: { node } }, null, 2) + '\n';

test('verify shows only the diff hunks that touch a ranged claim', () => {
  const files = { 'lib/big.mjs': lines(60, 'big'), 'README.md': '# x\n' };
  const body = '## Features\n\n- The middle matters. <!-- src: lib/big.mjs:30-34 -->\n';
  const ws = pinnedWorkspace({ files, body });
  const edit = lines(60, 'big').split('\n');
  edit[4] = 'EDIT NEAR TOP';
  edit[31] = 'EDIT IN RANGE';
  edit[55] = 'EDIT NEAR BOTTOM';
  ws.commit({ 'lib/big.mjs': edit.join('\n') });
  const out = ws.run(['verify', 'app']).stdout;
  assert.match(out, /EDIT IN RANGE/);
  assert.doesNotMatch(out, /EDIT NEAR TOP/);
  assert.doesNotMatch(out, /EDIT NEAR BOTTOM/);
});

test('verify shows the old and new value of a changed JSON key, not the whole file diff', () => {
  const files = { ...STD_FILES, 'package.json': PKG('1.0.0') };
  const body = '## Features\n\n- Needs Node 20. <!-- src: package.json#engines.node -->\n';
  const ws = pinnedWorkspace({ files, body });
  ws.commit({ 'package.json': PKG('1.0.1', '>=22') });
  const out = ws.run(['verify', 'app']).stdout;
  assert.match(out, /package\.json#engines\.node/);
  assert.match(out, /was "?>=20"?/);
  assert.match(out, /now "?>=22"?/);
  assert.doesNotMatch(out, /1\.0\.1/);
});

test('verify on a moved claim shows the lines at the new position', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/ranged.mjs': 'new first line\nand another\n' + lines(10, 'ranged') });
  const out = ws.run(['verify', 'app']).stdout;
  assert.match(out, /MOVED/);
  assert.match(out, /lib\/ranged\.mjs:5-7\s+\(moved from 3-5, update the numbers\)/);
  assert.match(out, /ranged 3/);
});

test('check suggests a JSON key when a claim cites a whole package.json that changed', () => {
  const files = { ...STD_FILES, 'package.json': PKG('1.0.0') };
  const body = '## Features\n\n- Needs Node 20. <!-- src: package.json -->\n';
  const ws = pinnedWorkspace({ files, body });
  ws.commit({ 'package.json': PKG('1.0.1') });
  const out = ws.run(['check']).stdout;
  assert.match(out, /tip: package\.json is cited whole by 1 claim/);
  assert.match(out, /package\.json#engines\.node/);
});

test('check does not give the package.json tip when keys are cited', () => {
  const files = { ...STD_FILES, 'package.json': PKG('1.0.0') };
  const body = '## Features\n\n- Needs Node 20. <!-- src: package.json#engines.node -->\n';
  const ws = pinnedWorkspace({ files, body });
  ws.commit({ 'package.json': PKG('1.0.1', '>=22') });
  assert.doesNotMatch(ws.run(['check']).stdout, /tip:/);
});

test('init next-step text does not tell you to commit a file that is already committed', () => {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'package.json', '{"name":"scaffold-me","version":"1.0.0"}\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  const r = run(['init'], { cwd: dir });
  assert.doesNotMatch(r.stdout, /commit package\.json/);
  assert.match(r.stdout, /dossiers\/example\.md/);
  assert.match(r.stdout, /dossier-scribe lint && dossier-scribe pin --all/);
});
