// Pins a dossier against an old commit of a public repo, then checks it against the current HEAD.
// This is how docs/trials.md was measured: it answers "if I had adopted this a year ago, what would
// check say today?"
//
//   node scripts/trial.mjs <git-url> <old-commit> <dossier.md> [--keep]
//
// Clones into a temp dir (needs network and git), pins at <old-commit>, returns to the default
// branch and runs `check`. The dossier's `repo` must be ".". Exit code is check's.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'dossier-scribe.mjs');
const [url, commit, dossier, ...flags] = process.argv.slice(2);
if (!url || !commit || !dossier) {
  console.error('usage: node scripts/trial.mjs <git-url> <old-commit> <dossier.md> [--keep]');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'dscribe-trial-'));
const sh = (cmd, args, cwd = work) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && cmd === 'git') throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r;
};
const ds = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: work, encoding: 'utf8' });

sh('git', ['clone', '-q', url, '.']);
const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
sh('git', ['checkout', '-q', commit]);
writeFileSync(join(work, 'dossier-scribe.json'), '{ "dossiers": "dossiers", "reposRoot": "." }\n');
mkdirSync(join(work, 'dossiers'));
copyFileSync(resolve(dossier), join(work, 'dossiers', 'trial.md'));
const lint = ds('lint');
process.stdout.write(lint.stdout + lint.stderr);
if (lint.status !== 0) process.exit(lint.status ?? 1);
process.stdout.write(ds('pin', '--all').stdout);
sh('git', ['checkout', '-q', branch]);
const t = Date.now();
const check = ds('check');
process.stdout.write(check.stdout + check.stderr);
console.log(`\ncheck took ${Date.now() - t} ms against ${sh('git', ['rev-list', '--count', 'HEAD']).stdout.trim()} commits`);
if (flags.includes('--keep')) console.log(`kept ${work}`);
else rmSync(work, { recursive: true, force: true });
process.exit(check.status ?? 1);
