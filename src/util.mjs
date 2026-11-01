import { createHash } from 'node:crypto';

export class UsageError extends Error {}

/** Current time. DSCRIBE_NOW (ISO string) overrides it so tests are deterministic. */
export function now() {
  const o = process.env.DSCRIBE_NOW;
  if (o) {
    const d = new Date(o);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function today() {
  return now().toISOString().slice(0, 10);
}

export function daysBetween(dateStr, to = now()) {
  const from = new Date(`${dateStr}T00:00:00Z`);
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  return Math.round((end - from) / 86400000);
}

export function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "7d", "12h", "30m", "0" to milliseconds. */
export function parseDuration(s) {
  const m = /^(\d+)\s*(d|h|m)?$/.exec(String(s).trim());
  if (!m) throw new UsageError(`invalid duration "${s}", use e.g. 7d, 12h or 0`);
  const unit = { d: 86400000, h: 3600000, m: 60000 }[m[2] || 'd'];
  return Number(m[1]) * unit;
}

export function sha(text) {
  return createHash('sha1').update(text).digest('hex');
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
