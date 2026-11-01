import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, FrontmatterError } from '../src/frontmatter.mjs';

const doc = (...fm) => `---\n${fm.join('\n')}\n---\nBody here.\n`;

test('parses scalars, quoted strings, lists, booleans and dates as strings', () => {
  const { data, body, bodyLine } = parseFrontmatter(
    doc(
      '# a comment line',
      'slug: my-app',
      'name: "My: App"',
      "alias: 'it''s fine'",
      'last_verified: 2026-03-01',
      'archived: false',
      'public: true',
      'tags: [web, "api, v2", cli]',
      'empty: []',
      '',
      'version: 3',
    ),
  );
  assert.equal(data.slug, 'my-app');
  assert.equal(data.name, 'My: App');
  assert.equal(data.alias, "it's fine");
  assert.equal(data.last_verified, '2026-03-01');
  assert.equal(data.archived, false);
  assert.equal(data.public, true);
  assert.deepEqual(data.tags, ['web', 'api, v2', 'cli']);
  assert.deepEqual(data.empty, []);
  assert.equal(data.version, '3', 'bare numbers stay strings');
  assert.equal(body, 'Body here.\n');
  assert.equal(bodyLine, 14);
});

test('double-quoted strings understand escapes', () => {
  const { data } = parseFrontmatter(doc('note: "a \\"quoted\\" word\\nnext"'));
  assert.equal(data.note, 'a "quoted" word\nnext');
});

function rejects(text, line, pattern) {
  assert.throws(
    () => parseFrontmatter(text),
    (err) => {
      assert.ok(err instanceof FrontmatterError, 'is a FrontmatterError');
      assert.equal(err.line, line, `line number for: ${err.message}`);
      assert.match(err.message, new RegExp(`^line ${line}: `));
      if (pattern) assert.match(err.message, pattern);
      return true;
    },
  );
}

test('rejects a document without frontmatter', () => {
  rejects('# Just a heading\n', 1, /frontmatter/i);
});

test('rejects an unclosed frontmatter block', () => {
  rejects('---\nslug: a\nname: b\n', 1, /closing/i);
});

test('rejects nested (indented) values with the line number', () => {
  rejects(doc('slug: a', 'meta:', '  owner: someone'), 3, /indent|nested/i);
});

test('rejects block lists', () => {
  rejects(doc('slug: a', '- one', '- two'), 3, /block list|list/i);
});

test('rejects a line with no colon', () => {
  rejects(doc('slug: a', 'just words'), 3, /key: value/);
});

test('rejects unterminated quotes and lists', () => {
  rejects(doc('slug: a', 'name: "oops'), 3, /unterminated/i);
  rejects(doc('slug: a', 'tags: [a, b'), 3, /unterminated|\]/i);
});

test('rejects duplicate keys, naming the second line', () => {
  rejects(doc('slug: a', 'name: b', 'slug: c'), 4, /duplicate/i);
});

test('rejects block scalars, flow maps, anchors and tags', () => {
  rejects(doc('slug: a', 'text: |'), 3, /block scalar/i);
  rejects(doc('slug: a', 'text: {a: 1}'), 3, /flow map|\{/i);
  rejects(doc('slug: a', 'text: &anchor x'), 3, /anchor|tag|alias/i);
  rejects(doc('slug: a', 'text: !!str x'), 3, /anchor|tag|alias/i);
});

test('rejects nested lists, trailing comments and empty values', () => {
  rejects(doc('slug: a', 'tags: [[a], b]'), 3, /nested/i);
  rejects(doc('slug: a', 'name: thing # note'), 3, /comment/i);
  rejects(doc('slug: a', 'name:'), 3, /empty/i);
});
