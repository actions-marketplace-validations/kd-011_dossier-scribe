import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UsageError } from './util.mjs';

export const COLLECTORS = ['package', 'python', 'go', 'rust', 'docker', 'env', 'git', 'filetypes', 'systemd'];

const DEFAULTS = {
  dossiers: 'dossiers',
  reposRoot: '.',
  requireCitations: ['Features', 'Architecture', 'Data', 'Deploy'],
  uncitedSeverity: 'error',
  collectors: COLLECTORS.filter((c) => c !== 'systemd'),
  systemdUnits: {},
  thresholds: { amberDays: 30, redDays: 90, redStale: 3, diffBytes: 20000, maxPerDay: 5, cooldown: '7d' },
};

export function loadConfig(root) {
  const rootDir = resolve(root);
  const file = join(rootDir, 'dossier-scribe.json');
  let user = {};
  if (existsSync(file)) {
    try {
      user = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new UsageError(`dossier-scribe.json: ${err.message}`);
    }
    if (user === null || typeof user !== 'object' || Array.isArray(user)) throw new UsageError('dossier-scribe.json must contain a JSON object');
  }
  const cfg = { ...DEFAULTS, ...user, thresholds: { ...DEFAULTS.thresholds, ...(user.thresholds || {}) } };
  for (const c of cfg.collectors) {
    if (!COLLECTORS.includes(c)) throw new UsageError(`dossier-scribe.json: unknown collector "${c}" (known: ${COLLECTORS.join(', ')})`);
  }
  if (!['error', 'warn'].includes(cfg.uncitedSeverity)) throw new UsageError('dossier-scribe.json: uncitedSeverity must be "error" or "warn"');
  return {
    ...cfg,
    root: rootDir,
    configFile: existsSync(file) ? file : null,
    dossiersDir: resolve(rootDir, cfg.dossiers),
    reposDir: resolve(rootDir, cfg.reposRoot),
  };
}
