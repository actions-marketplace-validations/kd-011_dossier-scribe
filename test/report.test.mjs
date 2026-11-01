import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkspace, docText, lines } from './helpers.mjs';

function fleet() {
  const mk = (slug, name, extra = {}) => docText({ slug, name, body: `## Features\n\n- ${name} claim. <!-- src: lib/${slug}.mjs -->`, ...extra });
  const files = { 'lib/fresh.mjs': lines(3), 'lib/stale.mjs': lines(3), 'lib/broken.mjs': lines(3), 'lib/old.mjs': lines(3) };
  const ws = createWorkspace({
    files,
    docs: { fresh: mk('fresh', 'Fresh Doc'), stale: mk('stale', 'Stale Doc'), broken: mk('broken', 'Broken Doc'), old: mk('old', 'Old Doc') },
  });
  const NOW = '2026-06-01T00:00:00Z';
  ws.run(['pin', '--all'], { env: { DSCRIBE_NOW: NOW } });
  // age the "old" doc far past the red threshold
  ws.writeDoc('old', ws.doc('old').replace(/last_verified: .*/, 'last_verified: 2025-01-01'));
  ws.commit({ 'lib/stale.mjs': 'changed <b>thing</b>\n', 'lib/broken.mjs': null }, 'drift');
  return { ws, NOW };
}

test('markdown report lists every dossier with its state', () => {
  const { ws, NOW } = fleet();
  const out = join(ws.root, 'index.md');
  const r = ws.run(['report', '--out', out], { env: { DSCRIBE_NOW: NOW } });
  assert.equal(r.status, 0, r.out);
  const md = readFileSync(out, 'utf8');
  const row = (name) => md.split('\n').find((l) => l.includes(name));
  assert.match(row('Fresh Doc'), /green/);
  assert.match(row('Stale Doc'), /amber/);
  assert.match(row('Broken Doc'), /red/);
  assert.match(row('Old Doc'), /red/);
  assert.match(row('Stale Doc'), /1 stale/);
});

test('html report is self-contained, phone-ready and shows state and stale claims', () => {
  const { ws, NOW } = fleet();
  const out = join(ws.root, 'index.html');
  assert.equal(ws.run(['report', '--out', out], { env: { DSCRIBE_NOW: NOW } }).status, 0);
  const html = readFileSync(out, 'utf8');
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /name="viewport"/);
  for (const name of ['Fresh Doc', 'Stale Doc', 'Broken Doc', 'Old Doc']) assert.ok(html.includes(name), name);
  for (const state of ['green', 'amber', 'red']) assert.ok(html.includes(`data-state="${state}"`), state);
  assert.ok(html.includes('Stale Doc claim.'), 'stale claim text is listed');
  assert.ok(html.includes('lib/stale.mjs'), 'changed file is listed');
  assert.doesNotMatch(html, /<script/i, 'no JavaScript');
  assert.doesNotMatch(html, /https?:\/\//i, 'no external requests');
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /@import/);
});

test('html report escapes claim and file text', () => {
  const ws = createWorkspace({
    files: { 'lib/x.mjs': '1\n' },
    docs: { x: docText({ slug: 'x', name: 'X <img src=x>', body: '## Features\n\n- Does <script>alert(1)</script> things. <!-- src: lib/x.mjs -->' }) },
  });
  ws.run(['pin', 'x']);
  ws.commit({ 'lib/x.mjs': '2\n' });
  const out = join(ws.root, 'index.html');
  ws.run(['report', '--out', out]);
  const html = readFileSync(out, 'utf8');
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;script&gt;/);
});

test('report defaults to index.html in the working directory', () => {
  const { ws, NOW } = fleet();
  assert.equal(ws.run(['report'], { env: { DSCRIBE_NOW: NOW } }).status, 0);
  assert.ok(readFileSync(join(ws.root, 'index.html'), 'utf8').includes('Fresh Doc'));
});

test('time alone moves the colours: months later nothing is green', () => {
  const { ws } = fleet();
  const out = join(ws.root, 'index.md');
  ws.run(['report', '--out', out], { env: { DSCRIBE_NOW: '2026-12-01T00:00:00Z' } });
  const md = readFileSync(out, 'utf8');
  assert.match(md.split('\n').find((l) => l.includes('Fresh Doc')), /red/);
});

test('amberDays and redDays in config move the thresholds', () => {
  const { ws } = fleet();
  const cfgPath = join(ws.root, 'dossier-scribe.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, thresholds: { amberDays: 1, redDays: 40 } }));
  const out = join(ws.root, 'index.md');
  ws.run(['report', '--out', out], { env: { DSCRIBE_NOW: '2026-06-03T12:00:00Z' } });
  const md = readFileSync(out, 'utf8');
  assert.match(md.split('\n').find((l) => l.includes('Fresh Doc')), /amber/, '2 days old with amberDays 1');
});
