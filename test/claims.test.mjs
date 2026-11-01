import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClaims } from '../src/claims.mjs';

const REQUIRE = ['Features', 'Architecture', 'Data', 'Deploy'];
const extract = (body, opts = {}) => extractClaims(body, { firstLine: 1, requireSections: REQUIRE, ...opts });

test('a list item ending in a src comment is a claim', () => {
  const { claims, problems } = extract('- Uses HMAC sessions. <!-- src: lib/auth.mjs -->\n');
  assert.deepEqual(problems, []);
  assert.equal(claims.length, 1);
  const c = claims[0];
  assert.equal(c.text, 'Uses HMAC sessions.');
  assert.equal(c.line, 1);
  assert.equal(c.cited, true);
  assert.deepEqual(c.sources, [{ spec: 'lib/auth.mjs', path: 'lib/auth.mjs', start: null, end: null, glob: false }]);
});

test('a paragraph ending in a src comment is a claim, line numbers honour firstLine', () => {
  const { claims } = extract('Intro line\nthat wraps. <!-- src: a.js -->\n', { firstLine: 10 });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].line, 10);
  assert.equal(claims[0].text, 'Intro line that wraps.');
});

test('multiple paths, line ranges, single lines and globs are parsed', () => {
  const { claims, problems } = extract('- Mixed. <!-- src: a.js, lib/b.js:12-40, src/routes/*.js, c.js:7 -->');
  assert.deepEqual(problems, []);
  assert.deepEqual(
    claims[0].sources.map((s) => [s.path, s.start, s.end, s.glob]),
    [
      ['a.js', null, null, false],
      ['lib/b.js', 12, 40, false],
      ['src/routes/*.js', null, null, true],
      ['c.js', 7, 7, false],
    ],
  );
});

test('uncited claims are flagged required only under configured sections', () => {
  const body = ['## Features', '- Does a thing.', '### Sub heading', '- Nested section item.', '## Notes', '- Just a remark.'].join('\n');
  const { claims } = extract(body);
  const by = Object.fromEntries(claims.map((c) => [c.text, c]));
  assert.equal(by['Does a thing.'].cited, false);
  assert.equal(by['Does a thing.'].required, true);
  assert.equal(by['Nested section item.'].required, true, 'sub-headings inherit the requirement');
  assert.equal(by['Just a remark.'].required, false);
  assert.equal(by['Does a thing.'].section, 'Features');
});

test('section matching ignores case and respects custom config', () => {
  const body = '## deploy\n- Ships nightly.\n## Features\n- Not required here.';
  const { claims } = extract(body, { requireSections: ['Deploy'] });
  assert.equal(claims[0].required, true);
  assert.equal(claims[1].required, false);
});

test('the auto block, code fences, headings, tables and comments are not claims', () => {
  const body = [
    '## Features',
    '<!-- auto:start -->',
    '- generated bullet',
    '<!-- auto:end -->',
    '```',
    '- inside a fence',
    '```',
    '| a | b |',
    '| - | - |',
    '> quoted text',
    '<!-- some other comment -->',
    '- Real claim. <!-- src: x.js -->',
  ].join('\n');
  const { claims, problems } = extract(body);
  assert.deepEqual(problems, []);
  assert.deepEqual(claims.map((c) => c.text), ['Real claim.']);
});

test('multi-line list items and nested items', () => {
  const body = '- Parent item that\n  continues here. <!-- src: a.js -->\n  - Child item. <!-- src: b.js -->\n';
  const { claims } = extract(body);
  assert.deepEqual(claims.map((c) => [c.text, c.line]), [
    ['Parent item that continues here.', 1],
    ['Child item.', 3],
  ]);
});

test('claim ids are stable under whitespace, case and source edits, and differ with text', () => {
  const a = extract('- Uses  HMAC sessions. <!-- src: a.js -->').claims[0];
  const b = extract('- uses hmac sessions.   <!-- src: b.js, c.js -->').claims[0];
  const c = extract('- Uses JWT sessions. <!-- src: a.js -->').claims[0];
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
  assert.match(a.id, /^[0-9a-f]{12}$/);
});

test('identical claim text in one doc still gets distinct ids', () => {
  const { claims } = extract('- Same. <!-- src: a.js -->\n- Same. <!-- src: b.js -->');
  assert.equal(claims.length, 2);
  assert.notEqual(claims[0].id, claims[1].id);
});

test('malformed src comments are reported with line numbers', () => {
  const cases = [
    ['- Oops. <!-- src: a.js', /unterminated/i],
    ['- Empty. <!-- src: -->', /empty/i],
    ['- Backwards. <!-- src: a.js:40-12 -->', /range/i],
    ['- Zero. <!-- src: a.js:0-3 -->', /range/i],
    ['- Mid <!-- src: a.js --> comment text after.', /end/i],
    ['- Two. <!-- src: a.js --> <!-- src: b.js -->', /one|multiple|more than/i],
    ['- Abs. <!-- src: /etc/passwd -->', /absolute|relative/i],
    ['- Up. <!-- src: ../secret.txt -->', /\.\./],
    ['- Glob range. <!-- src: src/*.js:1-5 -->', /glob/i],
    ['- Typo. <!-- source: a.js -->', /src/i],
  ];
  for (const [text, pattern] of cases) {
    const { problems } = extract(`\n${text}`);
    assert.equal(problems.length >= 1, true, `expected a problem for: ${text}`);
    assert.equal(problems[0].line, 2, `line for: ${text}`);
    assert.match(problems[0].message, pattern, text);
  }
});
