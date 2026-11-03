import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT as root } from './helpers.mjs';

const script = join(root, 'scripts', 'release.mjs');
const run = (args, env = {}) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', ...env } });
const plan = (version, published, releaseExists) =>
  run(['plan', '--version', version, '--published', published, '--release-exists', String(releaseExists)]);
const read = (p) => readFileSync(join(root, p), 'utf8');

// Version comparison: a dry run, no network.
test('plan: a new version above everything published is published and released', () => {
  const r = plan('0.3.0', '0.1.0,0.2.0', false);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { version: '0.3.0', publish: true, release: true, reason: JSON.parse(r.stdout).reason });
});

test('plan: a version npm already has is not published again', () => {
  const j = JSON.parse(plan('0.2.0', '0.1.0,0.2.0', true).stdout);
  assert.equal(j.publish, false);
  assert.equal(j.release, false);
});

test('plan: published but no release yet finishes the release without publishing', () => {
  const j = JSON.parse(plan('0.2.0', '0.1.0,0.2.0', false).stdout);
  assert.equal(j.publish, false);
  assert.equal(j.release, true);
});

test('plan: first ever publish', () => {
  const j = JSON.parse(plan('0.1.0', '', false).stdout);
  assert.equal(j.publish, true);
});

test('plan: compares numbers, not strings (0.10.0 is above 0.9.0)', () => {
  assert.equal(JSON.parse(plan('0.10.0', '0.9.0', false).stdout).publish, true);
  assert.notEqual(plan('0.9.1', '0.10.0', false).status, 0);
});

test('plan: an unpublished version below the newest published one fails loudly', () => {
  const r = plan('0.1.5', '0.1.0,0.2.0', false);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /0\.2\.0/);
  assert.equal(r.stdout.trim(), '');
});

test('plan: anything but x.y.z fails', () => {
  for (const v of ['1.0', '1.0.0-rc.1', 'v1.0.0', '', '1.0.0+build']) {
    assert.equal(plan(v, '0.1.0', false).status, 1, v);
  }
});

test('plan: ignores pre-release versions that are already on npm', () => {
  assert.equal(JSON.parse(plan('0.1.0', '0.0.0-stage', false).stdout).publish, true);
});

test('plan writes publish= and release= to GITHUB_OUTPUT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dscribe-release-'));
  const out = join(dir, 'out');
  writeFileSync(out, '');
  const r = run(['plan', '--version', '0.3.0', '--published', '0.2.0', '--release-exists', 'false'], { GITHUB_OUTPUT: out });
  const text = readFileSync(out, 'utf8');
  rmSync(dir, { recursive: true });
  assert.equal(r.status, 0, r.stderr);
  assert.match(text, /^publish=true$/m);
  assert.match(text, /^release=true$/m);
  assert.match(text, /^version=0\.3\.0$/m);
});

const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n### Added\n- next thing\n\n## [0.3.0] - 2026-12-01\n\n### Added\n- the thing\n\n### Fixed\n- a fix\n\n## [0.2.0] - 2026-11-02\n\n- old\n\n[0.3.0]: https://example.invalid/0.3.0\n';
function notes(version, text = CHANGELOG) {
  const dir = mkdtempSync(join(tmpdir(), 'dscribe-notes-'));
  const file = join(dir, 'CHANGELOG.md');
  writeFileSync(file, text);
  const r = run(['notes', version, '--changelog', file]);
  rmSync(dir, { recursive: true });
  return r;
}

test('notes: prints that version\'s section and nothing from its neighbours', () => {
  const r = notes('0.3.0');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /### Added\n- the thing/);
  assert.match(r.stdout, /- a fix/);
  assert.doesNotMatch(r.stdout, /next thing|old|example\.invalid|## \[/);
});

test('notes: the last section stops before the link references', () => {
  const r = notes('0.2.0');
  assert.equal(r.stdout.trim(), '- old');
});

test('notes: a missing or empty section fails', () => {
  assert.equal(notes('9.9.9').status, 1);
  assert.match(notes('9.9.9').stderr, /9\.9\.9/);
  assert.equal(notes('0.3.0', '## [0.3.0] - 2026-12-01\n\n## [0.2.0]\n- x\n').status, 1);
});

test('notes: works on the real CHANGELOG for the current version', () => {
  const version = JSON.parse(read('package.json')).version;
  const r = run(['notes', version]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.trim().length > 20);
});

const publish = read('.github/workflows/publish.yml');

test('publish.yml runs on a push to main that changes package.json, or by hand, never on a tag', () => {
  assert.doesNotMatch(publish, /^\s*tags:/m);
  assert.match(publish, /^on:\n  push:\n    branches: \[main\]\n    paths: \[package\.json\]\n  workflow_dispatch:/m);
});

test('publish.yml has the permissions the release needs and no more', () => {
  assert.match(publish, /^permissions:\n  contents: write\n  id-token: write\n(?! +\w)/m);
});

test('publish.yml plans, gates on the token, tests, checks notes, publishes, then releases', () => {
  const order = ['release.mjs plan', 'Can this run publish', 'npm test', 'release.mjs notes', 'npm publish --provenance --access public', 'gh release create'].map((s) => {
    const at = publish.indexOf(s);
    assert.ok(at >= 0, `publish.yml is missing: ${s}`);
    return at;
  });
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('publish.yml skips publishing with a notice, not a failure, when there is no token and no package yet', () => {
  assert.match(publish, /\[ -z "\$NPM_TOKEN" \] && ! npm view dossier-scribe name/);
  assert.match(publish, /::notice /);
  assert.match(publish, /echo "publish=false"/);
  const gate = publish.slice(publish.indexOf('Can this run publish'), publish.indexOf('Install npm 11'));
  assert.doesNotMatch(gate, /exit [1-9]/);
  for (const step of ['Install npm 11', 'Tests', 'Publish to npm']) {
    const at = publish.indexOf(`- name: ${step}`);
    assert.match(publish.slice(at, at + 200), /if: steps\.gate\.outputs\.publish == 'true'/, step);
  }
});

test('publish.yml uses NPM_TOKEN when it exists and OIDC when it does not', () => {
  assert.match(publish, /secrets\.NPM_TOKEN/);
  assert.match(publish, /npm install -g npm@\^?11/, 'trusted publishing needs npm 11.5.1 or later');
  assert.match(publish, /\[ -n "\$NPM_TOKEN" \]/);
  assert.doesNotMatch(publish, /registry-url/, 'setup-node would write a placeholder token that stops OIDC');
});

test('publish.yml gives the release step its own token and a target commit', () => {
  assert.match(publish, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(publish, /gh release create "v\$\{?VERSION\}?" .*--target "\$\{?GITHUB_SHA\}?"/);
});

test('publish.yml cannot run twice at once', () => {
  assert.match(publish, /^concurrency:\n  group: publish\n  cancel-in-progress: false/m);
});

test('the package is ready for npm: repository, files and a bin that exists', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.repository.url, 'git+https://github.com/kd-011/dossier-scribe.git');
  assert.ok(pkg.bugs.url && pkg.homepage);
  for (const f of Object.values(pkg.bin)) assert.ok(existsSync(join(root, f)), f);
  assert.ok(!pkg.files.some((f) => f.startsWith('test')), 'tests are not shipped');
  assert.match(read('CHANGELOG.md'), new RegExp(`^## \\[${pkg.version.replaceAll('.', '\\.')}\\]`, 'm'));
});

test('actionlint passes on every workflow when it is installed', (t) => {
  const probe = spawnSync('actionlint', ['-version'], { encoding: 'utf8' });
  if (probe.error) return t.skip('actionlint is not installed');
  const r = spawnSync('actionlint', [], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
