import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from '../cli.mjs';
import { today } from '../util.mjs';

const CONFIG = {
  dossiers: 'dossiers',
  reposRoot: '.',
  requireCitations: ['Features', 'Architecture', 'Data', 'Deploy'],
  collectors: ['package', 'python', 'go', 'rust', 'docker', 'env', 'git', 'filetypes'],
  thresholds: { amberDays: 30, redDays: 90, redStale: 3 },
};

export async function run(ctx, args, io) {
  parse(args, {}, { positionals: 0 });
  const { root } = ctx.config;
  if (existsSync(join(root, 'dossier-scribe.json'))) {
    io.err('dossier-scribe.json already exists, not overwriting');
    return 1;
  }
  const repo = ctx.repo(root);
  const tracked = repo.head() ? [...repo.tree().keys()] : [];
  const cite = ['package.json', 'README.md'].find((f) => tracked.includes(f)) ?? tracked[0] ?? 'README.md';
  const slug = basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'example';
  const dir = join(root, CONFIG.dossiers);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'dossier-scribe.json'), `${JSON.stringify(CONFIG, null, 2)}\n`);
  const docFile = join(dir, 'example.md');
  if (!existsSync(docFile)) {
    writeFileSync(
      docFile,
      `---
slug: ${slug}
name: ${slug}
repo: .
status: active
last_verified: ${today()}
tags: [example]
---

One sentence on what this project is.

## Features

- Replace this with something true about the project. <!-- src: ${cite} -->

## Notes

- Items outside Features, Architecture, Data and Deploy do not need a source.

<!-- auto:start -->
<!-- auto:end -->
`,
    );
  }
  io.out('created dossier-scribe.json and dossiers/example.md');
  io.out('next: edit dossiers/example.md so each claim cites a file that backs it, then run: dossier-scribe lint && dossier-scribe pin --all');
  return 0;
}
