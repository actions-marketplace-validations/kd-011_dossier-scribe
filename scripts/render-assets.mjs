// Renders docs/screenshots/terminal.png from a real `dossier-scribe demo` run.
// Usage: node scripts/render-assets.mjs
// Needs a headless Chromium: set CHROME_BIN, or have chromium, google-chrome or a
// Playwright chrome-headless-shell on the machine. Nothing in the image is typed by hand.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'dscribe-assets-'));

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const pw = join(homedir(), '.cache/ms-playwright');
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).sort().reverse()) {
      if (!d.startsWith('chromium_headless_shell')) continue;
      for (const sub of readdirSync(join(pw, d))) {
        const bin = join(pw, d, sub, 'chrome-headless-shell');
        if (existsSync(bin)) return bin;
      }
    }
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    for (const dir of (process.env.PATH ?? '').split(':')) if (existsSync(join(dir, name))) return join(dir, name);
  }
  throw new Error('no headless Chromium found, set CHROME_BIN');
}

// The demo prints a report step after the part worth showing.
const demo = execFileSync(process.execPath, [join(root, 'bin/dossier-scribe.mjs'), 'demo', '--out', join(work, 'demo')], { encoding: 'utf8' });
const lines = demo.split('\n').slice(1);
const cut = lines.findIndex((l) => l.startsWith('$ dossier-scribe report'));
const shown = lines.slice(0, cut === -1 ? lines.length : cut).join('\n').replace(/\n\(check exited 1[^\n]*\)\n*$/, '\n').trim().split('\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function paint(l) {
  const t = esc(l);
  if (l.startsWith('$ ')) return `<span class="cmd">${t}</span>`;
  if (/^\(.*\)$/.test(l)) return `<span class="dim">${t}</span>`;
  if (/^dossiers\/.*line \d+:$/.test(l)) return `<span class="dim">${t}</span>`;
  if (l.startsWith('@@')) return `<span class="dim">${t}</span>`;
  if (l.startsWith('+')) return `<span class="add">${t}</span>`;
  if (l.startsWith('-')) return `<span class="del">${t}</span>`;
  if (/^\s+STALE/.test(l)) return t.replace('STALE', '<span class="amber">STALE</span>');
  if (/^\s+BROKEN/.test(l)) return t.replace('BROKEN', '<span class="del">BROKEN</span>');
  if (/^\S+\s+red\s/.test(l)) return t.replace(/ red /, ' <span class="del">red</span> ');
  if (/^\S+\s+green\s/.test(l)) return t.replace(/ green /, ' <span class="add">green</span> ');
  if (/^\s+(src\/|a cited)/.test(l)) return `<span class="dim">${t}</span>`;
  if (/^- Sessions|^\s+- Sessions/.test(l)) return `<span class="hl">${t}</span>`;
  return t;
}

const W = 980;
const LINE = 24;
const H = shown.length * LINE + 96;
const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#0d1117}
.card{width:${W - 40}px;margin:20px;background:#161b22;border:1px solid #30363d;border-radius:10px;overflow:hidden}
.bar{height:34px;background:#1c2128;border-bottom:1px solid #30363d;display:flex;align-items:center;gap:8px;padding:0 14px}
.bar i{width:11px;height:11px;border-radius:50%;background:#444c56}
pre{margin:0;padding:18px 22px;font:15px/${LINE}px "JetBrains Mono","DejaVu Sans Mono",Menlo,monospace;color:#e6edf3;white-space:pre;font-variant-ligatures:none;font-feature-settings:"liga" 0,"calt" 0}
.cmd{color:#79c0ff;font-weight:600}.dim{color:#8b949e}.add{color:#7ee787}.del{color:#ff7b72}.amber{color:#e3b341}.hl{color:#e6edf3;background:#1f2a1f}
</style><div class="card"><div class="bar"><i></i><i></i><i></i></div><pre>${shown.map(paint).join('\n')}</pre></div>`;
const file = join(work, 'terminal.html');
writeFileSync(file, html);
const out = join(root, 'docs/screenshots/terminal.png');
execFileSync(findChrome(), ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`, '--force-device-scale-factor=2', `--screenshot=${out}`, `file://${file}`], { stdio: 'ignore' });
rmSync(work, { recursive: true, force: true });
console.log(`wrote ${out} (${shown.length} lines from a real demo run)`);
