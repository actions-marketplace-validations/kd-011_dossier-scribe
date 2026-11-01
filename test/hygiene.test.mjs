import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

// Patterns are assembled from pieces so this file does not contain them verbatim.
const BANNED = [
  ['k', 'yle'],
  ['de', 'boo'],
  ['gm', 'ail'],
  ['/ho', 'me/'],
  ['cor', 'tex'],
  [String.fromCharCode(0x2014)],
  ['Co-Authored', '-By'],
].map((p) => p.join(''));

function trackedFiles() {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  return r.stdout.split('\0').filter(Boolean).filter((f) => !/\.(png|jpg|jpeg|webp)$/i.test(f));
}

test('no personal data, em dashes or attribution trailers anywhere in the tree', () => {
  const hits = [];
  for (const f of trackedFiles()) {
    if (!existsSync(join(ROOT, f))) continue;
    const text = readFileSync(join(ROOT, f), 'utf8').toLowerCase();
    for (const b of BANNED) if (text.includes(b.toLowerCase())) hits.push(`${f}: ${b}`);
  }
  assert.deepEqual(hits, []);
});

test('MIT licence with the stated copyright line', () => {
  const lic = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
  assert.match(lic, /MIT License/);
  assert.match(lic, /Copyright \(c\) 2026 kd-011/);
});

test('packaging and CI files exist', () => {
  for (const f of ['README.md', 'CONTRIBUTING.md', '.github/workflows/ci.yml', '.github/dependabot.yml', 'examples/workflows/dossier-drift.yml']) {
    assert.ok(existsSync(join(ROOT, f)), f);
  }
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /node --test/);
  assert.match(ci, /22/);
  assert.match(readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8'), /github-actions[\s\S]*monthly/);
});
