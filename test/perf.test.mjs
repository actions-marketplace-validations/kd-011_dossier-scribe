import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, docText, lines } from './helpers.mjs';

test('check stays fast on a repo with 2000 files and 300 claims, using few git calls', () => {
  const files = {};
  for (let i = 0; i < 2000; i += 1) files[`src/m${i % 40}/f${i}.js`] = lines(20, `file ${i}`);
  const docs = {};
  for (let d = 0; d < 15; d += 1) {
    const claims = [];
    for (let c = 0; c < 20; c += 1) {
      const n = (d * 20 + c) * 6;
      const src = c % 3 === 0 ? `src/m${n % 40}/f${n}.js:3-9` : `src/m${n % 40}/f${n}.js`;
      claims.push(`- Claim ${d}-${c} describes module ${n}. <!-- src: ${src} -->`);
    }
    docs[`doc${d}`] = docText({ slug: `doc${d}`, name: `Doc ${d}`, body: `## Features\n\n${claims.join('\n')}` });
  }
  const ws = createWorkspace({ files, docs });
  let t = Date.now();
  const pin = ws.run(['pin', '--all']);
  assert.equal(pin.status, 0, pin.out);
  const pinMs = Date.now() - t;

  t = Date.now();
  const clean = ws.check();
  const cleanMs = Date.now() - t;
  assert.equal(clean.status, 0, clean.out);
  assert.equal(clean.data.docs.reduce((n, d) => n + d.summary.ok, 0), 300);
  assert.ok(cleanMs < 8000, `clean check took ${cleanMs}ms`);
  assert.ok(clean.data.stats.gitCalls <= 40, `clean check used ${clean.data.stats.gitCalls} git calls`);

  // change 5 cited files; exactly those claims go stale
  const change = {};
  for (const n of [0, 6, 12, 18, 24]) change[`src/m${n % 40}/f${n}.js`] = 'changed\n';
  ws.commit(change, 'touch five');
  t = Date.now();
  const drift = ws.check();
  const driftMs = Date.now() - t;
  const stale = drift.data.docs.flatMap((d) => d.claims).filter((c) => c.status === 'stale');
  assert.equal(stale.length, 5);
  assert.ok(driftMs < 12000, `drifted check took ${driftMs}ms`);
  assert.ok(drift.data.stats.gitCalls <= 80, `drifted check used ${drift.data.stats.gitCalls} git calls`);
  assert.ok(pinMs < 20000, `pin took ${pinMs}ms`);
});
