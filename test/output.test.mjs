import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinnedWorkspace } from './helpers.mjs';

const BODY = `
## Features

- First claim about auth. <!-- src: lib/auth.mjs -->
- Second claim about auth. <!-- src: lib/auth.mjs -->
- Third claim about auth. <!-- src: lib/auth.mjs -->
`;

test('check lists the commits for a changed file once per dossier, then points back to it', () => {
  const ws = pinnedWorkspace({ body: BODY });
  ws.commit({ 'lib/auth.mjs': 'one\n' }, 'Rework auth');
  const out = ws.run(['check']).stdout;
  assert.equal((out.match(/Rework auth/g) || []).length, 1, out);
  assert.equal((out.match(/same change as above/g) || []).length, 2, out);
  assert.equal((out.match(/STALE/g) || []).length, 3);
});

test('--json still carries the full commit list on every claim', () => {
  const ws = pinnedWorkspace({ body: BODY });
  ws.commit({ 'lib/auth.mjs': 'one\n' }, 'Rework auth');
  const claims = ws.check().data.docs[0].claims.filter((c) => c.status === 'stale');
  assert.equal(claims.length, 3);
  for (const c of claims) assert.equal(c.files[0].commits[0].subject, 'Rework auth');
});

test('a ranged stale claim says the file was touched, not that the range was', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/ranged.mjs': 'ranged 1\nranged 2\nCHANGED\nranged 4\nranged 5\nranged 6\nranged 7\nranged 8\nranged 9\nranged 10\n' }, 'Edit ranged');
  const out = ws.run(['check']).stdout;
  assert.match(out, /lib\/ranged\.mjs:3-5\s+range changed; the file has 1 commit since the pin/);
});
