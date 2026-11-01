// Read-only fact collectors. They read committed files at HEAD, never run anything and never
// touch the network. Env files contribute variable NAMES only.
import { basename, extname } from 'node:path';

const ENV_FILES = ['.env.example', '.env.sample', '.env.template', '.env.dist'];
const ROOT_FILES = ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'Dockerfile', ...ENV_FILES];

const list = (names) => names.join(', ');
const uniqSorted = (xs) => [...new Set(xs)].sort();

export function collectFacts(repo, { collectors, units = [] }) {
  const tree = repo.tree();
  const want = ROOT_FILES.filter((f) => tree.has(f));
  const unitFiles = collectors.includes('systemd') ? units.filter((u) => tree.has(u)) : [];
  const files = repo.readMany([...want, ...unitFiles]);
  const text = (p) => files.get(p)?.toString('utf8') ?? null;
  const out = [];
  const run = {
    package: () => packageJson(text('package.json')),
    python: () => python(text('pyproject.toml'), text('requirements.txt')),
    go: () => goMod(text('go.mod')),
    rust: () => cargo(text('Cargo.toml')),
    docker: () => docker(text('Dockerfile')),
    env: () => envNames(ENV_FILES.filter((f) => files.has(f)).map((f) => [f, text(f)])),
    systemd: () => systemd(unitFiles.map((f) => [f, text(f)])),
    git: () => gitTotals(repo),
    filetypes: () => fileTypes(tree),
  };
  for (const name of ['package', 'python', 'go', 'rust', 'docker', 'env', 'systemd', 'git', 'filetypes']) {
    if (collectors.includes(name)) out.push(...(run[name]() ?? []));
  }
  return out;
}

function packageJson(src) {
  if (src === null) return null;
  let p;
  try {
    p = JSON.parse(src);
  } catch {
    return ['- package.json: could not be parsed'];
  }
  const out = [`- package: ${[p.name, p.version].filter(Boolean).join(' ') || '(unnamed)'}`];
  const scripts = Object.keys(p.scripts ?? {});
  if (scripts.length) out.push(`- npm scripts (${scripts.length}): ${list(scripts)}`);
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const names = Object.keys(p[key] ?? {}).sort();
    if (names.length) out.push(`- ${key} (${names.length}): ${list(names)}`);
  }
  return out;
}

function pyName(spec) {
  return /^[A-Za-z0-9_.-]+/.exec(spec.trim())?.[0] ?? null;
}

function python(pyproject, requirements) {
  if (pyproject === null && requirements === null) return null;
  const out = [];
  const deps = [];
  if (pyproject !== null) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1];
    const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1];
    if (name) out.push(`- python package: ${[name, version].filter(Boolean).join(' ')}`);
    const arr = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(pyproject)?.[1];
    if (arr) for (const m of arr.matchAll(/"([^"]+)"/g)) deps.push(pyName(m[1]));
  }
  if (requirements !== null) {
    for (const line of requirements.split('\n')) {
      const l = line.trim();
      if (l && !l.startsWith('#') && !l.startsWith('-')) deps.push(pyName(l));
    }
  }
  const names = uniqSorted(deps.filter(Boolean));
  if (names.length) out.push(`- python dependencies (${names.length}): ${list(names)}`);
  return out;
}

function goMod(src) {
  if (src === null) return null;
  const out = [];
  const mod = /^module\s+(\S+)/m.exec(src)?.[1];
  const go = /^go\s+(\S+)/m.exec(src)?.[1];
  if (mod) out.push(`- go module: ${mod}`);
  if (go) out.push(`- go version: ${go}`);
  const reqs = [];
  for (const m of src.matchAll(/^\s*require\s+(\S+)\s+v\S+/gm)) reqs.push(m[1]);
  for (const block of src.matchAll(/^require\s*\(([\s\S]*?)^\)/gm)) {
    for (const line of block[1].split('\n')) {
      const name = /^\s*(\S+)\s+v\S+/.exec(line)?.[1];
      if (name) reqs.push(name);
    }
  }
  const names = uniqSorted(reqs);
  if (names.length) out.push(`- go requires (${names.length}): ${list(names)}`);
  return out;
}

function cargo(src) {
  if (src === null) return null;
  const out = [];
  const pkg = /\[package\]([\s\S]*?)(?=^\[|$(?![\r\n]))/m.exec(src)?.[1] ?? '';
  const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(pkg)?.[1];
  const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(pkg)?.[1];
  if (name) out.push(`- rust crate: ${[name, version].filter(Boolean).join(' ')}`);
  for (const section of ['dependencies', 'dev-dependencies']) {
    const body = new RegExp(`^\\[${section}\\]([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(src)?.[1];
    if (body === undefined) continue;
    const names = uniqSorted([...body.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]));
    if (names.length) out.push(`- rust ${section} (${names.length}): ${list(names)}`);
  }
  return out;
}

function docker(src) {
  if (src === null) return null;
  const out = [];
  const from = [...src.matchAll(/^\s*FROM\s+(?:--\S+\s+)*(\S+)/gim)].map((m) => m[1]).filter((i) => i.toLowerCase() !== 'scratch');
  if (from.length) out.push(`- docker base images: ${list(uniqSorted(from))}`);
  const ports = [...src.matchAll(/^\s*EXPOSE\s+(.+)$/gim)].flatMap((m) => m[1].trim().split(/\s+/));
  if (ports.length) out.push(`- docker exposed ports: ${list(uniqSorted(ports))}`);
  return out;
}

function envNames(files) {
  if (files.length === 0) return null;
  const out = [];
  for (const [file, src] of files) {
    const names = uniqSorted(
      src
        .split('\n')
        .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1])
        .filter(Boolean),
    );
    out.push(`- ${file} variables (${names.length}): ${names.length ? list(names) : 'none'}`);
  }
  return out;
}

function systemd(files) {
  const out = [];
  for (const [file, src] of files) {
    for (const line of src.split('\n')) {
      const m = /^(ExecStart|OnCalendar|OnUnitActiveSec|OnBootSec)\s*=\s*(.+)$/.exec(line.trim());
      if (!m) continue;
      out.push(`- unit ${basename(file)} ${m[1] === 'ExecStart' ? 'ExecStart' : `schedule (${m[1]})`}: ${m[2].trim()}`);
    }
  }
  return out;
}

function gitTotals(repo) {
  const log = repo.run(['log', '--format=%cs%x01%ae'], { allowFail: true });
  if (!log) return null;
  const rows = log.split('\n').filter(Boolean).map((l) => l.split('\x01'));
  const dates = rows.map((r) => r[0]).sort();
  return [
    `- commits: ${rows.length}`,
    `- first commit: ${dates[0]}`,
    `- last commit: ${dates[dates.length - 1]}`,
    `- contributors: ${new Set(rows.map((r) => r[1].toLowerCase())).size}`,
  ];
}

function fileTypes(tree) {
  const counts = new Map();
  for (const p of tree.keys()) {
    const ext = extname(p) || '(none)';
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8);
  return [`- file types (${tree.size} files): ${top.map(([e, n]) => `${e} ${n}`).join(', ')}`];
}
