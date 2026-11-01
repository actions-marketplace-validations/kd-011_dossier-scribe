import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from './util.mjs';

export const lockPath = (config) => join(config.dossiersDir, '.dossier-lock.json');
export const statePath = (config) => join(config.dossiersDir, '.dossier-state.json');

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new UsageError(`${file}: ${err.message}`);
  }
}

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function readLock(config) {
  const lock = readJson(lockPath(config), null) ?? { version: 1, docs: {} };
  lock.docs ??= {};
  return lock;
}

export const writeLock = (config, lock) => writeJson(lockPath(config), lock);

export function readState(config) {
  const s = readJson(statePath(config), null) ?? {};
  s.docs ??= {};
  s.emitted ??= {};
  return s;
}

export const writeState = (config, state) => writeJson(statePath(config), state);
