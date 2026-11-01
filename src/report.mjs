// Static report renderers (markdown and one self-contained HTML page).
import { escapeHtml as h, plural } from './util.mjs';

// Keeps a number and its unit on one line.
const nb = (s) => h(s).replace(/(\d) (?=[a-z])/g, '$1&nbsp;');

const ORDER = { red: 0, amber: 1, green: 2 };

/** One short signal per dossier: the worst thing about it. */
export function signalFor(r, t) {
  if (r.error) return 'invalid';
  const s = r.summary;
  if (s.broken) return `${s.broken} broken`;
  if (s.stale) return `${s.stale} stale`;
  if (s.daysSinceVerified > t.amberDays) return `${s.daysSinceVerified}d old`;
  if (s.new) return `${s.new} new`;
  return 'ok';
}

export function claimCount(r) {
  const s = r.summary;
  return s ? s.ok + s.stale + s.broken + s.new : 0;
}

function sorted(results) {
  return [...results].sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.slug < b.slug ? -1 : 1));
}

export function renderMarkdownReport(results, t) {
  const rows = sorted(results).map((r) => {
    const s = r.summary;
    return `| ${r.name} | ${r.state} | ${signalFor(r, t)} | ${claimCount(r)} | ${s ? s.lastVerified : ''} |`;
  });
  return `${['| Dossier | State | Signal | Claims | Last verified |', '| --- | --- | --- | ---: | --- |', ...rows].join('\n')}\n`;
}

const driftClaims = (r) => (r.claims ?? []).filter((c) => ['stale', 'broken', 'new'].includes(c.status));

const path = (p) => `<code translate="no">${h(p)}</code>`;

function fileLine(f) {
  if (f.change === 'renamed') return `${path(f.path)} <span>renamed to ${h(f.renamedTo)}</span>`;
  if (f.change === 'deleted') return `${path(f.path)} <span>deleted</span>`;
  if (f.change === 'added') return `${path(f.path)} <span>added</span>`;
  const n = f.commits?.length ?? 0;
  return `${path(f.path + (f.range ? `:${f.range.start}-${f.range.end}` : ''))} <span>${nb(plural(n, 'commit'))}</span>`;
}

function row(r, t) {
  const s = r.summary;
  const signal = signalFor(r, t);
  const meta = r.error ? h(r.error) : `${nb(plural(claimCount(r), 'claim'))}, verified ${h(s.lastVerified)}`;
  const head = `<span class="id"><span class="name">${h(r.name)}</span><span class="meta">${meta}</span></span><span class="signal">${nb(signal)}</span>`;
  const items = driftClaims(r);
  if (items.length === 0) return `<li><div class="row" data-state="${r.state}">${head}</div></li>`;
  const body = items
    .map((c) => {
      const files = c.files.map((f) => `<li>${fileLine(f)}</li>`).join('');
      return `<li class="claim"><b data-s="${c.status}">${c.status}</b><p>${h(c.text)}</p>${files ? `<ul class="files">${files}</ul>` : ''}</li>`;
    })
    .join('');
  return `<li><details class="row" data-state="${r.state}"><summary>${head}<svg class="chev" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><ul class="claims">${body}</ul></details></li>`;
}

export function renderHtmlReport(results, t) {
  const rows = sorted(results).map((r) => row(r, t)).join('\n');
  const body = results.length ? `<ul class="list">\n${rows}\n</ul>` : '<p class="empty">No dossiers yet. Run <code>dossier-scribe init</code>.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0d0f12">
<title>Dossiers</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1 class="sr">Dossiers</h1>
${body}
</main>
</body>
</html>
`;
}

const CSS = `
:root{color-scheme:dark light;--bg:#0d0f12;--surface:#161a1f;--surface-2:#1c2127;--text:#eceef1;--muted:#98a2ad;--green:#5ed49a;--amber:#f0b84a;--red:#ff7b72;--focus:#8ab4ff;--ease:cubic-bezier(.23,1,.32,1)}
@media (prefers-color-scheme:light){:root{--bg:#f4f5f7;--surface:#fff;--surface-2:#eef0f3;--text:#14181d;--muted:#5a6572;--green:#16794a;--amber:#8a5a00;--red:#b3261e;--focus:#2457d6}}
*{box-sizing:border-box;margin:0}
html{-webkit-text-size-adjust:100%;scrollbar-color:var(--surface-2) var(--bg)}
body{background:var(--bg);color:var(--text);font:16px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
::selection{background:color-mix(in srgb,var(--focus) 35%,transparent)}
main{max-width:800px;margin:0 auto}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
ul{list-style:none;padding:0}
.list{display:grid;gap:8px}
.row{display:block;background:var(--surface);border-radius:14px;transition:background-color .18s var(--ease)}
.row>summary,div.row{display:flex;align-items:center;gap:12px;min-height:64px;padding:12px 16px}
summary{list-style:none;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:transform .16s var(--ease)}
summary::-webkit-details-marker{display:none}
summary:active{transform:scale(.98)}
details.row[open]{background:var(--surface-2)}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:14px}
.id{display:grid;gap:2px;min-width:0;flex:1}
.name{font-weight:600;font-size:17px;overflow-wrap:anywhere}
.meta{color:var(--muted);font-size:14px;overflow-wrap:anywhere}
.signal{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:15px;white-space:nowrap}
.signal::before{content:"";width:10px;height:10px;border-radius:50%;background:currentColor}
[data-state=green] .signal{color:var(--green)}
[data-state=amber] .signal{color:var(--amber)}
[data-state=red] .signal{color:var(--red)}
.chev{flex:none;color:var(--muted);transition:transform .2s var(--ease)}
details[open] .chev{transform:rotate(180deg)}
.claims{display:grid;gap:18px;padding:4px 16px 20px}
.claim{display:grid;gap:6px}
.claim b{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.claim b[data-s=stale],.claim b[data-s=new]{color:var(--amber)}
.claim b[data-s=broken]{color:var(--red)}
.claim p{overflow-wrap:anywhere}
.files{display:grid;gap:4px;color:var(--muted);font-size:13px}
.files li{overflow-wrap:anywhere}
.files span{color:var(--text);opacity:.75;margin-left:6px}
code{font:13px/1.4 ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.empty{padding:48px 16px;text-align:center;color:var(--muted)}
.empty code{font-size:14px}
@media (min-width:900px){
body{padding-top:64px;padding-bottom:64px}
.list{gap:10px}
.row>summary,div.row{padding:16px 24px;min-height:76px}
.claims{padding:4px 24px 24px;gap:22px}
.claim{grid-template-columns:72px minmax(0,1fr) minmax(0,.9fr);align-items:start;column-gap:20px}
.claim b{padding-top:3px}
.claim p{grid-column:2}
.files{grid-column:3;grid-row:1}
}
@media (hover:hover) and (pointer:fine){summary:hover{background:color-mix(in srgb,var(--text) 4%,transparent);border-radius:14px}}
details[open] .claims{opacity:1;transform:none;transition:opacity .22s var(--ease),transform .22s var(--ease);@starting-style{opacity:0;transform:translateY(-6px)}}
@media (prefers-reduced-motion:reduce){*,::before,::after{transition-duration:.001ms!important}}
`;
