import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkspace, docText, pinnedWorkspace, lines, STD_BODY } from './helpers.mjs';

const NOW = '2026-03-01T12:00:00Z';

test('pin records claim ids, blob hashes, range hashes and commits, and sets last_verified', () => {
  const ws = pinnedWorkspace({ pin: false });
  const before = ws.doc('app');
  const r = ws.run(['pin', 'app'], { env: { DSCRIBE_NOW: NOW } });
  assert.equal(r.status, 0, r.out);
  const lock = ws.lock();
  const claims = Object.values(lock.docs.app.claims);
  assert.equal(claims.length, 4, 'only the four cited claims are pinned');
  const auth = claims.find((c) => c.text.startsWith('Auth signs'));
  assert.equal(auth.files['lib/auth.mjs'].blob, ws.git('rev-parse', 'HEAD:lib/auth.mjs'));
  assert.equal(auth.files['lib/auth.mjs'].commit, ws.git('rev-parse', 'HEAD'));
  const ranged = claims.find((c) => c.text.startsWith('The ranged'));
  assert.match(ranged.files['lib/ranged.mjs'].range.hash, /^[0-9a-f]{40,64}$/);
  assert.deepEqual([ranged.files['lib/ranged.mjs'].range.start, ranged.files['lib/ranged.mjs'].range.end], [3, 5]);
  const glob = claims.find((c) => c.text.startsWith('Routes live'));
  assert.deepEqual(Object.keys(glob.files).sort(), ['src/routes/a.js', 'src/routes/b.js']);
  // only the last_verified line of the doc changed
  const after = ws.doc('app');
  assert.equal(after, before.replace('last_verified: 2026-01-01', 'last_verified: 2026-03-01'));
});

test('pin then check: every claim is ok and the exit code is 0', () => {
  const ws = pinnedWorkspace();
  const r = ws.check();
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(Object.values(ws.statuses()), ['ok', 'ok', 'ok', 'ok']);
  assert.equal(r.data.docs[0].summary.ok, 4);
});

test('changing a cited file makes exactly that claim STALE, with commits and diffstat', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/auth.mjs': lines(10, 'auth') + 'extra one\nextra two\n' }, 'Switch session signing');
  const r = ws.check();
  assert.equal(r.status, 1);
  const s = ws.statuses();
  assert.equal(s['Auth signs session'], 'stale');
  assert.equal(Object.values(s).filter((x) => x === 'stale').length, 1);
  const claim = r.data.docs[0].claims.find((c) => c.status === 'stale');
  const f = claim.files.find((x) => x.path === 'lib/auth.mjs');
  assert.equal(f.commits.length, 1);
  assert.equal(f.commits[0].subject, 'Switch session signing');
  assert.equal(f.diffstat.insertions, 2);
  assert.equal(f.diffstat.deletions, 0);
  assert.match(ws.run(['check']).stdout, /STALE/);
});

test('changing an UNCITED file makes nothing stale', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'misc/other.txt': 'changed\n' });
  const r = ws.check();
  assert.equal(r.status, 0);
  assert.deepEqual(new Set(Object.values(ws.statuses())), new Set(['ok']));
});

test('changing lines outside a cited range stays ok; inside the range goes stale', () => {
  const ws = pinnedWorkspace();
  const edit = (n, text) => lines(10, 'ranged').split('\n').map((l, i) => (i + 1 === n ? text : l)).join('\n');
  ws.commit({ 'lib/ranged.mjs': edit(9, 'changed outside') });
  assert.equal(ws.check().status, 0);
  assert.equal(ws.statuses()['The ranged helper '], 'ok');
  ws.commit({ 'lib/ranged.mjs': edit(4, 'changed inside') });
  assert.equal(ws.check().status, 1);
  assert.equal(ws.statuses()['The ranged helper '], 'stale');
});

test('inserting lines above a range shifts it: the claim is stale', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/ranged.mjs': 'new first line\n' + lines(10, 'ranged') });
  assert.equal(ws.statuses()['The ranged helper '], 'stale');
});

test('renaming a cited file is BROKEN with a rename hint', () => {
  const ws = pinnedWorkspace();
  ws.git('mv', 'lib/db.mjs', 'lib/database.mjs');
  ws.git('commit', '-q', '-m', 'rename db');
  const r = ws.check();
  assert.equal(r.status, 1);
  const claim = r.data.docs[0].claims.find((c) => c.text.startsWith('The database'));
  assert.equal(claim.status, 'broken');
  assert.equal(claim.files[0].path, 'lib/db.mjs');
  assert.equal(claim.files[0].change, 'renamed');
  assert.equal(claim.files[0].renamedTo, 'lib/database.mjs');
  assert.match(ws.run(['check']).stdout, /renamed to lib\/database\.mjs/);
});

test('deleting a cited file is BROKEN with no rename hint', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/db.mjs': null }, 'drop db');
  const claim = ws.check().data.docs[0].claims.find((c) => c.text.startsWith('The database'));
  assert.equal(claim.status, 'broken');
  assert.equal(claim.files[0].change, 'deleted');
  assert.equal(claim.files[0].renamedTo, undefined);
});

test('adding a file that matches a cited glob makes the claim stale', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'src/routes/c.js': 'new route\n' });
  const claim = ws.check().data.docs[0].claims.find((c) => c.text.startsWith('Routes live'));
  assert.equal(claim.status, 'stale');
  assert.ok(claim.files.some((f) => f.path === 'src/routes/c.js' && f.change === 'added'));
});

test('editing claim text reports the old id REMOVED and the new id NEW', () => {
  const ws = pinnedWorkspace();
  const oldId = Object.keys(ws.lock().docs.app.claims).find((id) => ws.lock().docs.app.claims[id].text.startsWith('Auth signs'));
  ws.writeDoc('app', ws.doc('app').replace('Auth signs sessions.', 'Auth signs sessions with HMAC.'));
  const r = ws.check();
  const claims = r.data.docs[0].claims;
  const removed = claims.filter((c) => c.status === 'removed');
  const added = claims.filter((c) => c.status === 'new');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].id, oldId);
  assert.equal(added.length, 1);
  assert.notEqual(added[0].id, oldId);
  assert.equal(r.status, 0, 'new and removed do not fail by default');
  assert.equal(ws.run(['check', '--fail-on', 'new']).status, 1);
});

test('editing only the cited sources of a claim marks it stale until re-pinned', () => {
  const ws = pinnedWorkspace();
  ws.writeDoc('app', ws.doc('app').replace('<!-- src: lib/auth.mjs -->', '<!-- src: lib/auth.mjs, lib/db.mjs -->'));
  const claim = ws.check().data.docs[0].claims.find((c) => c.text.startsWith('Auth signs'));
  assert.equal(claim.status, 'stale');
  assert.match(claim.reason, /sources/i);
  assert.equal(ws.run(['pin', 'app']).status, 0);
  assert.equal(ws.check().status, 0);
});

test('before any pin every cited claim is NEW', () => {
  const ws = pinnedWorkspace({ pin: false });
  const r = ws.check();
  assert.equal(r.data.docs[0].summary.new, 4);
  assert.equal(r.status, 0);
});

test('uncommitted working-tree edits are not drift; check reads HEAD', () => {
  const ws = pinnedWorkspace();
  writeFileSync(join(ws.repo, 'lib/auth.mjs'), 'uncommitted edit\n');
  assert.equal(ws.check().status, 0);
});

test('re-pinning after a change returns the doc to ok', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/auth.mjs': 'rewritten\n' });
  assert.equal(ws.check().status, 1);
  assert.equal(ws.run(['pin', 'app']).status, 0);
  assert.equal(ws.check().status, 0);
});

test('--fail-on uncited fails on uncited claims under required sections; default does not', () => {
  const body = STD_BODY + '\n## Data\n\n- An uncited data claim.\n';
  const ws = pinnedWorkspace({ body });
  assert.equal(ws.run(['check']).status, 0);
  assert.equal(ws.run(['check', '--fail-on', 'uncited']).status, 1);
  assert.equal(ws.check().data.docs[0].summary.uncited, 1);
});

test('--fail-on rejects unknown states', () => {
  const ws = pinnedWorkspace();
  assert.equal(ws.run(['check', '--fail-on', 'bogus']).status, 2);
});

test('summary carries days and commits since verified', () => {
  const ws = pinnedWorkspace({ pin: false });
  ws.run(['pin', 'app'], { env: { DSCRIBE_NOW: NOW } });
  ws.commit({ 'misc/other.txt': 'a\n' }, 'one');
  ws.commit({ 'misc/other.txt': 'b\n' }, 'two');
  const r = ws.check();
  const later = ws.run(['check', '--json'], { env: { DSCRIBE_NOW: '2026-03-11T12:00:00Z' } });
  const s = JSON.parse(later.stdout).docs[0].summary;
  assert.equal(s.lastVerified, '2026-03-01');
  assert.equal(s.daysSinceVerified, 10);
  assert.equal(s.commitsSinceVerified, 2);
  assert.ok(r.data.stats.gitCalls > 0);
});

test('--since hides drift whose changes are all older than the cutoff', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/auth.mjs': 'changed\n' });
  assert.equal(ws.run(['check', '--since', '1d']).status, 1);
  const future = ws.check(['--since', '2999-01-01']);
  assert.equal(future.status, 0);
  assert.equal(future.data.docs[0].summary.stale, 0);
});

test('pin refuses a dossier with lint errors and leaves the lock without it', () => {
  const ws = createWorkspace({ docs: { app: docText({ body: '## Features\n\n- Gone. <!-- src: lib/missing.mjs -->' }) } });
  const r = ws.run(['pin', 'app']);
  assert.equal(r.status, 1);
  assert.match(r.out, /lint/i);
  assert.equal(ws.doc('app').includes('last_verified: 2026-01-01'), true);
});

test('pin <slug> keeps other dossiers\' lock entries; pin with no target is a usage error', () => {
  const ws = createWorkspace({
    docs: { app: docText({ body: STD_BODY }), two: docText({ slug: 'two', name: 'Two', body: '## Features\n\n- Readme. <!-- src: README.md -->' }) },
  });
  assert.equal(ws.run(['pin', '--all']).status, 0);
  const twoBefore = JSON.stringify(ws.lock().docs.two);
  ws.commit({ 'lib/auth.mjs': 'changed\n' });
  assert.equal(ws.run(['pin', 'app']).status, 0);
  assert.equal(JSON.stringify(ws.lock().docs.two), twoBefore);
  assert.equal(ws.run(['pin']).status, 2);
});

test('verify shows the claim with the cited excerpt; --claim --ok re-pins only that claim', () => {
  const ws = pinnedWorkspace();
  ws.commit({ 'lib/auth.mjs': 'new auth line\n', 'lib/db.mjs': 'new db line\n' });
  const shown = ws.run(['verify', 'app']);
  assert.match(shown.stdout, /Auth signs sessions/);
  assert.match(shown.stdout, /new auth line/);
  assert.match(shown.stdout, /new db line/);
  const id = ws.check().data.docs[0].claims.find((c) => c.text.startsWith('Auth signs')).id;
  const r = ws.run(['verify', 'app', '--claim', id, '--ok']);
  assert.equal(r.status, 0, r.out);
  const s = ws.statuses();
  assert.equal(s['Auth signs session'], 'ok');
  assert.equal(s['The database layer'], 'stale');
});

test('verify shows only the ranged lines for a ranged claim', () => {
  const ws = pinnedWorkspace();
  const out = ws.run(['verify', 'app', '--claim', Object.keys(ws.lock().docs.app.claims).find((id) => ws.lock().docs.app.claims[id].text.startsWith('The ranged'))]).stdout;
  assert.match(out, /ranged 3/);
  assert.match(out, /ranged 5/);
  assert.doesNotMatch(out, /ranged 8/);
});
