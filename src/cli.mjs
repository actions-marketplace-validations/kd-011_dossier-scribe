import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { createContext, loadDossiers, selectDocs } from './dossiers.mjs';
import { UsageError } from './util.mjs';
import { GitError } from './git.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `dossier-scribe ${VERSION}
Keep per-project docs true: every claim cites a file, drift is reported per claim.

Usage: dossier-scribe [--root DIR] <command> [options]      (alias: dscribe)

Commands:
  init                      scaffold dossier-scribe.json and an example dossier
  lint [slug]               validate frontmatter, citations and line ranges
  pin [slug] [--all]        record what each cited file looks like now
  check [slug]              report which claims drifted since the pin
        [--json] [--since REF|DATE|7d] [--fail-on stale,broken,new,removed,uncited]
  queue                     write re-verify tasks for drifted dossiers
        [--out DIR] [--format md|json|claude-code] [--max N] [--cooldown 7d]
        [--diff-cap BYTES] [--dispatch-cmd CMD]
  verify <slug>             show claims next to their cited excerpts
        [--claim ID] [--ok]
  auto [slug] [--check]     regenerate the auto block from read-only collectors
  report [--out FILE]       static index (index.html or index.md) with freshness
  demo [--out DIR]          build a throwaway repo and show a drifted claim

Global: --root DIR (where dossier-scribe.json lives, default .), --help, --version
`;

const COMMANDS = {
  init: 'commands/init.mjs',
  lint: 'commands/lint.mjs',
  pin: 'commands/pin.mjs',
  check: 'commands/check.mjs',
  queue: 'commands/queue.mjs',
  verify: 'commands/verify.mjs',
  auto: 'commands/auto.mjs',
  report: 'commands/report.mjs',
  demo: 'commands/demo.mjs',
};

export async function main(argv) {
  try {
    const { root, rest, help, version } = splitGlobal(argv);
    if (version) return print(VERSION);
    const [command, ...args] = rest;
    if (help || !command) return print(HELP, command || help ? 0 : 2);
    if (!COMMANDS[command]) throw new UsageError(`unknown command "${command}", run dossier-scribe --help`);
    const mod = await import(`./${COMMANDS[command]}`);
    const io = { out: (s = '') => process.stdout.write(`${s}\n`), err: (s = '') => process.stderr.write(`${s}\n`) };
    if (command === 'demo') return await mod.run(args, io);
    const config = loadConfig(root);
    const ctx = createContext(config);
    return await mod.run(ctx, args, io);
  } catch (err) {
    if (err instanceof UsageError || err instanceof GitError || err?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || err?.code?.startsWith?.('ERR_PARSE_ARGS')) {
      process.stderr.write(`dossier-scribe: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
}

function print(text, code = 0) {
  (code === 0 ? process.stdout : process.stderr).write(`${text.replace(/\n$/, '')}\n`);
  return code;
}

function splitGlobal(argv) {
  let root = process.cwd();
  let help = false;
  let version = false;
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') {
      if (i + 1 >= argv.length) throw new UsageError('--root needs a directory');
      root = argv[(i += 1)];
    } else if (a.startsWith('--root=')) root = a.slice(7);
    else if (a === '--help' || a === '-h') help = true;
    else if (a === '--version') version = true;
    else rest.push(a);
  }
  return { root, rest, help, version };
}

export function parse(args, options, { positionals = 1 } = {}) {
  const { values, positionals: pos } = parseArgs({ args, options, allowPositionals: true, strict: true });
  if (pos.length > positionals) throw new UsageError(`unexpected argument "${pos[positionals]}"`);
  return { values, pos };
}

export { loadDossiers, selectDocs };
