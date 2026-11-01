// Claim extraction. A claim is a list item or a paragraph. It is "cited" when it
// ends with <!-- src: path, path:12-40, glob/*.js -->.
import { createHash } from 'node:crypto';

export const AUTO_START = '<!-- auto:start -->';
export const AUTO_END = '<!-- auto:end -->';

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const WHOLE_COMMENT = /^\s*<!--.*-->\s*$/;
const SRCISH = /<!--\s*(src|srcs|source|sources)\b\s*(:?)/gi;

export function claimId(text) {
  return createHash('sha1').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
}

export function extractClaims(body, { firstLine = 1, requireSections = [] } = {}) {
  const required = requireSections.map((s) => s.trim().toLowerCase());
  const claims = [];
  const problems = [];
  const seen = new Map();
  const headings = [];
  let block = null;
  let inFence = false;
  let inAuto = false;

  const flush = () => {
    if (!block) return;
    finish(block);
    block = null;
  };

  function finish(b) {
    const raw = b.lines.join('\n');
    const text0 = b.first.replace(/^\[[ xX]\]\s+/, '') + (b.lines.length > 1 ? `\n${b.lines.slice(1).join('\n')}` : '');
    const hits = [...raw.matchAll(SRCISH)];
    const section = headings.length ? headings[headings.length - 1].text : '';
    const isRequired = headings.some((h) => required.includes(h.text.toLowerCase()));
    if (hits.length === 0) {
      const text = squash(text0);
      if (!/\p{L}/u.test(text)) return;
      push({ text, line: b.line, section, required: isRequired, cited: false, sources: [] });
      return;
    }
    const lineOf = (idx) => b.line + (raw.slice(0, idx).match(/\n/g) || []).length;
    const bad = (idx, message) => problems.push({ line: lineOf(idx), message });
    if (hits.length > 1) return bad(hits[1].index, 'more than one src comment in a single list item or paragraph');
    const hit = hits[0];
    if (hit[1].toLowerCase() !== 'src') return bad(hit.index, `unknown comment "${hit[1]}", write <!-- src: path -->`);
    if (hit[2] !== ':') return bad(hit.index, 'src comment needs a colon: <!-- src: path -->');
    const close = raw.indexOf('-->', hit.index);
    if (close === -1) return bad(hit.index, 'unterminated src comment (missing -->)');
    if (raw.slice(close + 3).trim() !== '') return bad(close, 'src comment must come at the end of the list item or paragraph');
    const list = raw.slice(hit.index + hit[0].length, close).trim();
    if (list === '') return bad(hit.index, 'empty src list');
    const sources = [];
    for (const piece of list.split(',')) {
      const parsed = parseSpec(piece.trim());
      if (parsed.error) return bad(hit.index, `${parsed.error} in "${piece.trim()}"`);
      sources.push(parsed);
    }
    const text = squash(text0.slice(0, text0.indexOf('<!--')));
    if (!/\p{L}/u.test(text)) return bad(hit.index, 'src comment has no claim text before it');
    push({ text, line: b.line, section, required: isRequired, cited: true, sources });
  }

  function push(c) {
    let id = claimId(c.text);
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    if (n > 1) id = createHash('sha1').update(`${c.text.toLowerCase()}#${n}`).digest('hex').slice(0, 12);
    claims.push({ id, ...c });
  }

  const lines = body.split('\n');
  lines.forEach((rawLine, idx) => {
    const line = rawLine.replace(/\r$/, '');
    const lineNo = firstLine + idx;
    if (inAuto) {
      if (line.trim() === AUTO_END) inAuto = false;
      return;
    }
    if (FENCE.test(line)) {
      flush();
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (line.trim() === AUTO_START) {
      flush();
      inAuto = true;
      return;
    }
    if (line.trim() === '') return flush();
    const h = HEADING.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, text: h[2].trim() });
      return;
    }
    if (/^\s*\|/.test(line) || /^\s*>/.test(line) || RULE.test(line)) return flush();
    if (WHOLE_COMMENT.test(line) && !/<!--\s*(src|srcs|source|sources)\b/i.test(line)) return flush();
    const li = LIST_ITEM.exec(line);
    if (li) {
      flush();
      block = { line: lineNo, first: li[3].trim(), lines: [li[3].trim()] };
      return;
    }
    if (block) {
      block.lines.push(line.trim());
    } else {
      block = { line: lineNo, first: line.trim(), lines: [line.trim()] };
    }
  });
  flush();
  return { claims, problems };
}

function squash(s) {
  return s.replace(/\s+/g, ' ').trim();
}

export function parseSpec(spec) {
  if (spec === '') return { error: 'empty path' };
  let s = spec.replace(/^\.\//, '');
  if (s.startsWith('/')) return { error: 'path must be relative to the repo, not absolute' };
  let start = null;
  let end = null;
  const m = /^(.*):(\d+)(?:-(\d+))?$/.exec(s);
  if (m) {
    s = m[1];
    start = Number(m[2]);
    end = m[3] === undefined ? start : Number(m[3]);
    if (start < 1 || end < start) return { error: 'invalid line range' };
  } else if (/:\S*$/.test(s) && /:[^/]*$/.test(s)) {
    return { error: 'invalid line range, use path:12 or path:12-40' };
  }
  if (s === '') return { error: 'empty path' };
  if (s.split('/').includes('..')) return { error: 'path must not contain ".."' };
  const glob = /[*?]/.test(s);
  if (glob && start !== null) return { error: 'line ranges cannot be combined with a glob' };
  return { spec, path: s, start, end, glob };
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}
