import { globToRegExp } from './claims.mjs';

const clip = (s, n = 70) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

function lineCount(buf) {
  const text = buf.toString('utf8');
  if (text === '') return 0;
  const parts = text.split('\n').length;
  return text.endsWith('\n') ? parts - 1 : parts;
}

/**
 * Lints every doc in `all`. `selected` limits what is reported.
 * Returns [{file, line, severity, message}] sorted by file and line.
 */
export function lintDocs(ctx, all, selected = all) {
  const problems = [];
  const add = (doc, line, severity, message) => problems.push({ file: doc.rel, line, severity, message });
  const slugs = new Map();
  for (const d of all) {
    if (d.fm && typeof d.fm.slug === 'string') {
      if (slugs.has(d.fm.slug)) d.duplicateOf = slugs.get(d.fm.slug);
      else slugs.set(d.fm.slug, d);
    }
  }

  for (const doc of selected) {
    if (doc.fmError) {
      add(doc, doc.fmError.line, 'error', doc.fmError.message.replace(/^line \d+: /, ''));
      continue;
    }
    for (const p of doc.fmProblems) add(doc, p.line, 'error', p.message);
    if (doc.duplicateOf) {
      const line = doc.text.split('\n').findIndex((l) => l.startsWith('slug:')) + 1;
      add(doc, line, 'error', `duplicate slug "${doc.fm.slug}" (also used by ${doc.duplicateOf.rel})`);
    }
    for (const p of doc.problems) add(doc, p.line, 'error', p.message);

    const repoLine = doc.text.split('\n').findIndex((l) => l.startsWith('repo:')) + 1 || 1;
    let repo = null;
    if (doc.repoDir) {
      repo = ctx.repo(doc.repoDir);
      if (!repo.head()) {
        add(doc, repoLine, 'error', `repo "${doc.fm.repo}" is not a git repository with at least one commit (looked in ${doc.fm.repo === '.' ? 'the reposRoot' : `reposRoot/${doc.fm.repo}`})`);
        repo = null;
      }
    }

    let blobs = null;
    const blobsFor = () => {
      if (!blobs) {
        const paths = doc.claims.flatMap((c) => c.sources.filter((s) => !s.glob && s.start !== null).map((s) => s.path));
        blobs = repo.readMany([...new Set(paths)].filter((p) => repo.tree().has(p)));
      }
      return blobs;
    };
    const uncitedSeverity = ctx.config.uncitedSeverity === 'warn' ? 'warning' : 'error';
    for (const c of doc.claims) {
      if (!c.cited) {
        if (c.required) add(doc, c.line, uncitedSeverity, `uncited claim under "${c.section}": "${clip(c.text)}"`);
        continue;
      }
      if (!repo) continue;
      const tree = repo.tree();
      for (const s of c.sources) {
        if (s.glob) {
          const re = globToRegExp(s.path);
          let any = false;
          for (const p of tree.keys()) {
            if (re.test(p)) {
              any = true;
              break;
            }
          }
          if (!any) add(doc, c.line, 'error', `glob "${s.path}" matches no files at HEAD`);
        } else if (!tree.has(s.path)) {
          add(doc, c.line, 'error', `src path "${s.path}" does not exist at HEAD`);
        } else if (s.start !== null) {
          const n = lineCount(blobsFor().get(s.path) ?? Buffer.alloc(0));
          if (s.end > n) add(doc, c.line, 'error', `line range ${s.start}-${s.end} of "${s.path}" is out of bounds (file has ${n} lines)`);
        }
      }
    }
  }
  return problems.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
}

export function formatProblems(problems) {
  return problems.map((p) => `${p.file}:${p.line}: ${p.severity}: ${p.message}`);
}
