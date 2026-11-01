// A deliberately small frontmatter parser. Supported subset:
//   key: value            bare scalar (string), or true / false (boolean)
//   key: "text"           double-quoted string with \" \\ \n \t escapes
//   key: 'text'           single-quoted string, '' for a literal quote
//   key: [a, "b, c"]      flat inline list of scalars
//   # comment             full-line comments and blank lines
// Everything else is rejected with a line-numbered error.

export class FrontmatterError extends Error {
  constructor(line, message) {
    super(`line ${line}: ${message}`);
    this.name = 'FrontmatterError';
    this.line = line;
  }
}

const KEY = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/;

export function parseFrontmatter(text) {
  const all = text.split('\n');
  if (all[0].replace(/\r$/, '') !== '---') {
    throw new FrontmatterError(1, 'missing frontmatter: the file must start with a --- line');
  }
  let close = -1;
  for (let i = 1; i < all.length; i += 1) {
    if (all[i].replace(/\r$/, '') === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) throw new FrontmatterError(1, 'frontmatter has no closing --- line');

  const data = {};
  for (let i = 1; i < close; i += 1) {
    const lineNo = i + 1;
    const raw = all[i].replace(/\r$/, '');
    if (raw.trim() === '' || raw.startsWith('#')) continue;
    if (/^\s/.test(raw)) throw new FrontmatterError(lineNo, 'indented lines (nested values) are not supported');
    if (/^-(\s|$)/.test(raw)) throw new FrontmatterError(lineNo, 'block lists are not supported, use an inline list like [a, b]');
    const m = KEY.exec(raw);
    if (!m) throw new FrontmatterError(lineNo, 'expected "key: value"');
    const [, key, rest] = m;
    if (Object.hasOwn(data, key)) throw new FrontmatterError(lineNo, `duplicate key "${key}"`);
    if (rest.trim() === '' && i + 1 < close && /^\s+\S/.test(all[i + 1])) {
      throw new FrontmatterError(lineNo, `"${key}" has indented children: nested values are not supported`);
    }
    data[key] = parseValue(rest.trim(), lineNo, key);
  }
  return {
    data,
    body: all.slice(close + 1).join('\n'),
    bodyLine: close + 2,
  };
}

function parseValue(v, line, key) {
  if (v === '') throw new FrontmatterError(line, `empty value for "${key}", use "" for an empty string`);
  if (v[0] === '[') return parseList(v, line);
  const [value, end] = parseScalar(v, 0, line, false);
  if (v.slice(end).trim() !== '') throw new FrontmatterError(line, 'unexpected text after value');
  return value;
}

function parseScalar(s, start, line, inList) {
  const c = s[start];
  if (c === '"') return parseDouble(s, start, line);
  if (c === "'") return parseSingle(s, start, line);
  if (c === '{') throw new FrontmatterError(line, 'flow maps ({...}) are not supported');
  if (c === '|' || c === '>') throw new FrontmatterError(line, 'block scalars (| and >) are not supported');
  if (c === '&' || c === '*' || c === '!') throw new FrontmatterError(line, 'anchors, aliases and tags are not supported');
  let end = start;
  const stop = inList ? /[,\]]/ : /$^/;
  while (end < s.length && !stop.test(s[end])) end += 1;
  const bare = s.slice(start, end).trim();
  if (/(^|\s)#/.test(bare)) throw new FrontmatterError(line, 'trailing comments are not supported, quote the value if it contains #');
  if (inList && bare === '') throw new FrontmatterError(line, 'empty list item');
  if (inList && /[[]/.test(bare)) throw new FrontmatterError(line, 'nested lists are not supported');
  if (bare === 'true') return [true, end];
  if (bare === 'false') return [false, end];
  return [bare, end];
}

function parseDouble(s, start, line) {
  let out = '';
  for (let i = start + 1; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '\\') {
      const n = s[i + 1];
      const map = { n: '\n', t: '\t', '"': '"', '\\': '\\' };
      if (!(n in map)) throw new FrontmatterError(line, `unsupported escape \\${n ?? ''}`);
      out += map[n];
      i += 1;
    } else if (ch === '"') {
      return [out, i + 1];
    } else {
      out += ch;
    }
  }
  throw new FrontmatterError(line, 'unterminated double-quoted string');
}

function parseSingle(s, start, line) {
  let out = '';
  for (let i = start + 1; i < s.length; i += 1) {
    if (s[i] === "'") {
      if (s[i + 1] === "'") {
        out += "'";
        i += 1;
      } else {
        return [out, i + 1];
      }
    } else {
      out += s[i];
    }
  }
  throw new FrontmatterError(line, 'unterminated single-quoted string');
}

function parseList(v, line) {
  const items = [];
  let i = 1;
  const skip = () => {
    while (v[i] === ' ' || v[i] === '\t') i += 1;
  };
  skip();
  if (v[i] === ']') return finishList(v, i + 1, items, line);
  for (;;) {
    skip();
    if (v[i] === '[') throw new FrontmatterError(line, 'nested lists are not supported');
    if (i >= v.length) throw new FrontmatterError(line, 'unterminated list, missing ]');
    const [item, end] = parseScalar(v, i, line, true);
    items.push(item);
    i = end;
    skip();
    if (v[i] === ',') {
      i += 1;
      continue;
    }
    if (v[i] === ']') return finishList(v, i + 1, items, line);
    throw new FrontmatterError(line, 'unterminated list, missing ]');
  }
}

function finishList(v, end, items, line) {
  if (v.slice(end).trim() !== '') throw new FrontmatterError(line, 'unexpected text after list');
  return items;
}
