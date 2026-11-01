import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { run, tmp, git, write } from './helpers.mjs';

test('--help lists every command and --version prints the package version', () => {
  const h = run(['--help']);
  assert.equal(h.status, 0);
  for (const c of ['init', 'lint', 'pin', 'check', 'queue', 'verify', 'auto', 'report', 'demo']) assert.match(h.stdout, new RegExp(`\\b${c}\\b`));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(run(['--version']).stdout.trim(), pkg.version);
});

test('an unknown command is a usage error (exit 2)', () => {
  const r = run(['frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown command/i);
});

test('init scaffolds a config and an example dossier that lints clean', () => {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'package.json', '{"name":"scaffold-me","version":"1.0.0"}\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  const r = run(['init'], { cwd: dir });
  assert.equal(r.status, 0, r.out);
  const cfg = JSON.parse(readFileSync(join(dir, 'dossier-scribe.json'), 'utf8'));
  assert.equal(cfg.dossiers, 'dossiers');
  assert.equal(cfg.reposRoot, '.');
  assert.ok(readdirSync(join(dir, 'dossiers')).some((f) => f.endsWith('.md')));
  const lint = run(['lint'], { cwd: dir });
  assert.equal(lint.status, 0, lint.out);
  const again = run(['init'], { cwd: dir });
  assert.equal(again.status, 1, 'refuses to overwrite');
});

test('single-repo use: repo "." with the default dossiers dir works end to end', () => {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'src/a.js', 'one\n');
  write(dir, 'dossiers/me.md', '---\nslug: me\nname: Me\nrepo: .\nstatus: active\nlast_verified: 2026-01-01\n---\n\n## Features\n\n- A thing. <!-- src: src/a.js -->\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  assert.equal(run(['pin', '--all'], { cwd: dir }).status, 0);
  assert.equal(run(['check'], { cwd: dir }).status, 0);
  write(dir, 'src/a.js', 'two\n');
  git(dir, 'commit', '-q', '-am', 'edit');
  assert.equal(run(['check'], { cwd: dir }).status, 1);
});

test('--root points the tool at another directory', () => {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'dossiers/.keep', '');
  write(dir, 'x.txt', 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  const elsewhere = tmp();
  assert.equal(run(['--root', dir, 'lint'], { cwd: elsewhere }).status, 0);
});

test('demo shows a drifted claim and writes a report, touching only its temp dir', () => {
  const cwd = tmp();
  const r = run(['demo'], { cwd });
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /STALE/);
  assert.match(r.stdout, /report/i);
  assert.deepEqual(readdirSync(cwd), [], 'nothing written to the working directory');
  const m = r.stdout.match(/^report: (.+index\.html)$/m);
  assert.ok(m, 'prints the report path');
  assert.ok(existsSync(m[1]));
  assert.match(readFileSync(m[1], 'utf8'), /data-state="amber"|data-state="red"/);
});

test('the package has no dependencies, ES modules, two bin names and node 22', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.deepEqual(Object.keys(pkg.bin).sort(), ['dossier-scribe', 'dscribe']);
  assert.ok(!pkg.dependencies && !pkg.devDependencies && !pkg.peerDependencies);
  assert.match(pkg.engines.node, />=\s*22/);
  assert.equal(pkg.license, 'MIT');
});

