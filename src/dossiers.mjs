import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseFrontmatter, FrontmatterError } from './frontmatter.mjs';
import { extractClaims } from './claims.mjs';
import { Repo } from './git.mjs';
import { UsageError, isRealDate } from './util.mjs';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Shared per-run context: config plus one Repo object per repository directory. */
export function createContext(config) {
  const repos = new Map();
  return {
    config,
    repo(dir) {
      if (!repos.has(dir)) repos.set(dir, new Repo(dir));
      return repos.get(dir);
    },
  };
}

export function loadDossiers(config) {
  if (!existsSync(config.dossiersDir) || !statSync(config.dossiersDir).isDirectory()) {
    throw new UsageError(`dossiers directory not found: ${relative(config.root, config.dossiersDir) || '.'} (run "dossier-scribe init")`);
  }
  const files = readdirSync(config.dossiersDir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('.') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
    .sort();
  return files.map((f) => loadOne(config, join(config.dossiersDir, f)));
}

function loadOne(config, file) {
  const text = readFileSync(file, 'utf8');
  const doc = {
    file,
    rel: relative(config.root, file).split('\\').join('/'),
    text,
    slug: file.slice(file.lastIndexOf('/') + 1).replace(/\.md$/, ''),
    fm: null,
    fmError: null,
    fmProblems: [],
    body: '',
    claims: [],
    problems: [],
    repoDir: null,
  };
  try {
    const { data, body, bodyLine } = parseFrontmatter(text);
    doc.fm = data;
    doc.body = body;
    doc.fmProblems = validateFrontmatter(data, text);
    if (typeof data.slug === 'string' && SLUG.test(data.slug)) doc.slug = data.slug;
    if (typeof data.repo === 'string' && data.repo !== '') doc.repoDir = resolve(config.reposDir, data.repo);
    const { claims, problems } = extractClaims(body, { firstLine: bodyLine, requireSections: config.requireCitations });
    doc.claims = claims;
    doc.problems = problems;
  } catch (err) {
    if (!(err instanceof FrontmatterError)) throw err;
    doc.fmError = err;
  }
  return doc;
}

function keyLine(text, key) {
  const i = text.split('\n').findIndex((l) => l.startsWith(`${key}:`));
  return i === -1 ? 1 : i + 1;
}

function validateFrontmatter(d, text) {
  const out = [];
  const bad = (key, message) => out.push({ line: keyLine(text, key), message });
  for (const key of ['slug', 'name', 'repo', 'status', 'last_verified']) {
    if (d[key] === undefined) out.push({ line: 1, message: `frontmatter field "${key}" is required` });
    else if (typeof d[key] !== 'string' || d[key].trim() === '') bad(key, `"${key}" must be a non-empty string`);
  }
  if (typeof d.slug === 'string' && d.slug !== '' && !SLUG.test(d.slug)) bad('slug', `invalid slug "${d.slug}", use lowercase letters, digits and hyphens`);
  if (typeof d.last_verified === 'string' && d.last_verified !== '' && !isRealDate(d.last_verified)) {
    bad('last_verified', `last_verified "${d.last_verified}" is not a valid YYYY-MM-DD date`);
  }
  if (d.tags !== undefined && !(Array.isArray(d.tags) && d.tags.every((t) => typeof t === 'string'))) bad('tags', '"tags" must be an inline list of strings');
  return out;
}

export function selectDocs(docs, slug) {
  if (!slug) return docs;
  const hit = docs.filter((d) => d.slug === slug);
  if (hit.length === 0) throw new UsageError(`no dossier with slug "${slug}"`);
  return hit;
}

/** Rewrites only the last_verified line, leaving every other byte alone. */
export function setLastVerified(doc, date) {
  const re = /^(last_verified:[ \t]*)(.*)$/m;
  const next = doc.text.replace(re, (_, k) => `${k}${date}`);
  if (next !== doc.text) {
    writeFileSync(doc.file, next);
    doc.text = next;
    doc.fm.last_verified = date;
  }
}
