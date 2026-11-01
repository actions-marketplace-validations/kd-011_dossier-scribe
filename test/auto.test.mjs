import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, docText, STD_BODY } from './helpers.mjs';

const START = '<!-- auto:start -->';
const END = '<!-- auto:end -->';
const BASE = {
  'package.json': JSON.stringify(
    { name: 'sample-svc', version: '1.4.2', scripts: { build: 'tsc', test: 'node --test' }, dependencies: { express: '^4', zod: '^3' }, devDependencies: { typescript: '^5' } },
    null,
    2,
  ),
  'src/index.ts': 'export {};\n',
  'README.md': '# sample\n',
};

const autoDoc = (body = `${STD_BODY}\n## Generated\n\n${START}\n${END}\n\n## Tail\n\nProse after the block.\n`) => docText({ body });

function split(text) {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  return { before: text.slice(0, a + START.length), block: text.slice(a + START.length, b), after: text.slice(b) };
}

test('auto fills the block with package.json facts', () => {
  const ws = createWorkspace({ files: { ...BASE, 'lib/auth.mjs': 'x\n' }, docs: { app: autoDoc() } });
  const r = ws.run(['auto', 'app']);
  assert.equal(r.status, 0, r.out);
  const { block } = split(ws.doc('app'));
  assert.match(block, /sample-svc/);
  assert.match(block, /1\.4\.2/);
  assert.match(block, /build/);
  assert.match(block, /express/);
  assert.match(block, /typescript/);
});

test('auto is idempotent and never touches prose outside the block', () => {
  const ws = createWorkspace({ files: { ...BASE, 'lib/auth.mjs': 'x\n' }, docs: { app: autoDoc() } });
  const original = ws.doc('app');
  ws.run(['auto', 'app']);
  const once = ws.doc('app');
  const second = ws.run(['auto', 'app']);
  assert.equal(second.status, 0);
  assert.equal(ws.doc('app'), once, 'second run changes nothing');
  const a = split(original);
  const b = split(once);
  assert.equal(b.before, a.before);
  assert.equal(b.after, a.after);
});

test('auto --check exits 1 when the block is out of date and 0 once regenerated', () => {
  const ws = createWorkspace({ files: BASE, docs: { app: autoDoc() } });
  assert.equal(ws.run(['auto', 'app', '--check']).status, 1);
  assert.equal(ws.run(['auto', 'app']).status, 0);
  assert.equal(ws.run(['auto', 'app', '--check']).status, 0);
  ws.commit({ 'package.json': BASE['package.json'].replace('1.4.2', '1.5.0') });
  const r = ws.run(['auto', '--check']);
  assert.equal(r.status, 1);
  assert.match(r.out, /app/);
});

test('auto --check does not modify the file', () => {
  const ws = createWorkspace({ files: BASE, docs: { app: autoDoc() } });
  const before = ws.doc('app');
  ws.run(['auto', 'app', '--check']);
  assert.equal(ws.doc('app'), before);
});

test('a dossier with no auto block gets one appended', () => {
  const ws = createWorkspace({ files: BASE, docs: { app: docText({ body: STD_BODY }) } });
  const before = ws.doc('app');
  ws.run(['auto', 'app']);
  const after = ws.doc('app');
  assert.ok(after.startsWith(before.trimEnd()));
  assert.ok(after.includes(START) && after.includes(END));
});

test('the auto block never counts as claims and auto leaves last_verified alone', () => {
  const ws = createWorkspace({ files: { ...BASE, 'lib/auth.mjs': 'x\n' }, docs: { app: autoDoc() } });
  ws.run(['auto', 'app']);
  assert.match(ws.doc('app'), /last_verified: 2026-01-01/);
  const lint = ws.run(['lint']);
  assert.doesNotMatch(lint.stdout, /uncited/i);
});

test('.env.example emits variable NAMES and never values', () => {
  const SECRET = 'sup3rs3cretvalue9917';
  const URLPW = 'hunter2-planted';
  const ws = createWorkspace({
    files: {
      ...BASE,
      '.env.example': `# comment with ${SECRET}x\nAPI_TOKEN=${SECRET}\nexport DB_URL="postgres://user:${URLPW}@db/app"\nPORT=3000\n\nEMPTY=\n`,
    },
    docs: { app: autoDoc() },
  });
  assert.equal(ws.run(['auto', 'app']).status, 0);
  const text = ws.doc('app');
  for (const name of ['API_TOKEN', 'DB_URL', 'PORT', 'EMPTY']) assert.ok(text.includes(name), name);
  assert.ok(!text.includes(SECRET), 'secret value leaked into the dossier');
  assert.ok(!text.includes(URLPW), 'password leaked into the dossier');
  assert.ok(!text.includes('3000'), 'value leaked into the dossier');
  const out = ws.run(['auto', 'app', '--check']);
  assert.ok(!out.out.includes(SECRET));
});

test('python, go, rust, docker and git collectors', () => {
  const ws = createWorkspace({
    files: {
      'pyproject.toml': '[project]\nname = "pysvc"\nversion = "0.3.0"\ndependencies = ["requests>=2", "rich"]\n',
      'requirements.txt': 'flask==3.0\nnumpy>=1.2\n# comment\n',
      'go.mod': 'module example.com/gosvc\n\ngo 1.22\n\nrequire (\n\tgithub.com/a/b v1.0.0\n\tgithub.com/c/d v2.1.0\n)\n',
      'Cargo.toml': '[package]\nname = "rustsvc"\nversion = "0.9.1"\n\n[dependencies]\nserde = "1"\ntokio = "1"\n',
      Dockerfile: 'FROM node:22-alpine AS build\nFROM nginx:1.27\nEXPOSE 8080 9090/tcp\n',
    },
    docs: { app: autoDoc() },
  });
  ws.commit({ 'main.go': 'package main\n' }, 'second');
  assert.equal(ws.run(['auto', 'app']).status, 0);
  const { block } = split(ws.doc('app'));
  for (const s of ['pysvc', '0.3.0', 'requests', 'flask', 'example.com/gosvc', '1.22', 'rustsvc', 'serde', 'node:22-alpine', 'nginx:1.27', '8080', '9090']) {
    assert.ok(block.includes(s), `block should mention ${s}`);
  }
  assert.match(block, /commits?:? *2/i);
});

test('git totals count contributors but never name them', () => {
  const ws = createWorkspace({ files: BASE, docs: { app: autoDoc() } });
  ws.git('commit', '-q', '--allow-empty', '--author=Second Person <second@example.com>', '-m', 'by someone else');
  ws.run(['auto', 'app']);
  const { block } = split(ws.doc('app'));
  assert.match(block, /contributors?:? *2/i);
  assert.ok(!block.includes('Second Person'));
  assert.ok(!block.includes('Test Author'));
  assert.ok(!block.includes('example.com'));
});

test('file-type breakdown lists extensions by count', () => {
  const ws = createWorkspace({ files: { 'a.js': '1', 'b.js': '2', 'c.js': '3', 'd.md': '4' }, docs: { app: autoDoc() } });
  ws.run(['auto', 'app']);
  const { block } = split(ws.doc('app'));
  assert.match(block, /\.js[^\n]*3/);
  assert.match(block, /\.md[^\n]*1/);
});

test('systemd units listed in config contribute ExecStart and schedule', () => {
  const ws = createWorkspace({
    files: {
      ...BASE,
      'deploy/app.service': '[Service]\nExecStart=/usr/bin/node server.js --port 80\n',
      'deploy/app.timer': '[Timer]\nOnCalendar=*-*-* 03:00:00\n',
    },
    config: { collectors: ['package', 'systemd'], systemdUnits: { app: ['deploy/app.service', 'deploy/app.timer'] } },
    docs: { app: autoDoc() },
  });
  ws.run(['auto', 'app']);
  const { block } = split(ws.doc('app'));
  assert.match(block, /\/usr\/bin\/node server\.js --port 80/);
  assert.match(block, /03:00:00/);
});

test('the collectors config restricts what runs', () => {
  const ws = createWorkspace({
    files: { ...BASE, '.env.example': 'FOO=bar\n' },
    config: { collectors: ['package'] },
    docs: { app: autoDoc() },
  });
  ws.run(['auto', 'app']);
  const { block } = split(ws.doc('app'));
  assert.match(block, /sample-svc/);
  assert.ok(!block.includes('FOO'));
});
