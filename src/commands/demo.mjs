import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from '../cli.mjs';
import { parseArgs } from 'node:util';

const sh = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
};
const put = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

const API = {
  'package.json': '{ "name": "acme-api", "version": "2.3.0", "scripts": { "start": "node src/server.js", "test": "node --test" } }\n',
  'src/auth.js': 'import { createHmac } from "node:crypto";\n\nexport function sign(session, key) {\n  return createHmac("sha256", key).update(JSON.stringify(session)).digest("hex");\n}\n',
  'src/rate-limit.js': '// Fixed window limiter.\nconst WINDOW_MS = 60_000;\nconst LIMIT = 100;\nconst hits = new Map();\n\nexport function allow(key, now = Date.now()) {\n  const slot = Math.floor(now / WINDOW_MS);\n  const entry = hits.get(key);\n  if (!entry || entry.slot !== slot) hits.set(key, { slot, n: 1 });\n  else entry.n += 1;\n  return hits.get(key).n <= LIMIT;\n}\n',
  'src/db.js': 'import { DatabaseSync } from "node:sqlite";\n\nexport const db = new DatabaseSync("data.sqlite");\n',
  'src/routes/users.js': 'export const users = () => [];\n',
  'src/routes/orders.js': 'export const orders = () => [];\n',
};
const WEB = {
  'package.json': '{ "name": "acme-web", "version": "0.8.1", "scripts": { "build": "vite build" } }\n',
  'src/app.js': 'export const title = "Acme";\n',
  'Dockerfile': 'FROM nginx:1.27\nEXPOSE 8080\n',
};

const doc = (slug, name, repo, body) => `---\nslug: ${slug}\nname: ${name}\nrepo: ${repo}\nstatus: active\nlast_verified: 2026-01-01\ntags: [demo]\n---\n\n${body.trim()}\n`;

export async function run(args, io) {
  const { values } = parseArgs({ args, options: { out: { type: 'string' } }, strict: true });
  const dir = values.out ?? mkdtempSync(join(tmpdir(), 'dscribe-demo-'));
  mkdirSync(dir, { recursive: true });
  io.out(`building a throwaway project in ${dir}`);
  for (const [name, files] of [['acme-api', API], ['acme-web', WEB]]) {
    const repo = join(dir, 'repos', name);
    mkdirSync(repo, { recursive: true });
    sh(repo, 'init', '-q', '-b', 'main');
    for (const [p, c] of Object.entries(files)) put(repo, p, c);
    sh(repo, 'add', '-A');
    sh(repo, 'commit', '-q', '-m', 'Initial commit');
  }
  put(dir, 'dossier-scribe.json', `${JSON.stringify({ dossiers: 'dossiers', reposRoot: 'repos' }, null, 2)}\n`);
  put(dir, 'dossiers/acme-api.md', doc('acme-api', 'Acme API', 'acme-api', `
Public HTTP API for Acme.

## Features

- Sessions are signed with HMAC-SHA256. <!-- src: src/auth.js -->
- Requests are limited to 100 per minute per key. <!-- src: src/rate-limit.js:2-4 -->
- Routes are registered from the routes folder. <!-- src: src/routes/*.js -->

## Data

- Rows are stored in a local SQLite file. <!-- src: src/db.js -->
`));
  put(dir, 'dossiers/acme-web.md', doc('acme-web', 'Acme Web', 'acme-web', `
Static front end served by nginx.

## Features

- The page title is set in one place. <!-- src: src/app.js -->

## Deploy

- The image serves on port 8080. <!-- src: Dockerfile -->
`));

  const claim = readFileSync(join(dir, 'dossiers/acme-api.md'), 'utf8').split('\n').findIndex((l) => l.startsWith('- Sessions are signed')) + 1;
  io.out(`\ndossiers/acme-api.md, line ${claim}:`);
  io.out(`  ${readFileSync(join(dir, 'dossiers/acme-api.md'), 'utf8').split('\n')[claim - 1]}`);

  const step = async (label, argv) => {
    io.out(`\n$ ${label}`);
    return main(['--root', dir, ...argv]);
  };
  await step('dossier-scribe pin --all', ['pin', '--all']);

  io.out('\n(a teammate changes how sessions are signed, then renames the db module)');
  const api = join(dir, 'repos', 'acme-api');
  put(api, 'src/auth.js', 'import { sign as edSign } from "node:crypto";\n\nexport function sign(session, privateKey) {\n  return edSign(null, Buffer.from(JSON.stringify(session)), privateKey).toString("hex");\n}\n');
  put(api, 'src/rate-limit.js', API['src/rate-limit.js'] + 'export const reset = () => hits.clear();\n');
  sh(api, 'add', '-A');
  sh(api, 'commit', '-q', '-m', 'Sign sessions with ed25519');
  io.out('\n$ git show -U0 HEAD -- src/auth.js');
  const shown = spawnSync('git', ['show', '-U0', '--format=%h  %s', 'HEAD', '--', 'src/auth.js'], { cwd: api, encoding: 'utf8' }).stdout;
  io.out(shown.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).join('\n').trimEnd());
  sh(api, 'mv', 'src/db.js', 'src/storage.js');
  sh(api, 'commit', '-q', '-m', 'Rename db module to storage');

  const code = await step('dossier-scribe check', ['check']);
  io.out(`\n(check exited ${code}: that is the signal CI and pre-commit hooks use)`);
  const report = join(dir, 'index.html');
  await step(`dossier-scribe report --out ${report}`, ['report', '--out', report]);
  io.out(`\nreport: ${report}`);
  return 0;
}

