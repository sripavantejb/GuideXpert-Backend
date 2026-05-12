/**
 * Shared slot-relative WhatsApp reminder cron eligibility:
 * `step3Data.slotDate` in [now + offset − window/2, now + offset + window/2] (plus callers typically add $gt: now).
 *
 * Used for pre4hr (T−4h), meet (T−1h), 30min (T−30m) — not rolling [now, now+X] on slotDate.
 *
 * Env keys per kind:
 *   pre4hr:  WA_PRE4HR_OFFSET_MS, WA_PRE4HR_CRON_WINDOW_MS
 *   meet:    WA_MEET_OFFSET_MS, WA_MEET_CRON_WINDOW_MS
 *   30min:   WA_30MIN_OFFSET_MS, WA_30MIN_CRON_WINDOW_MS
 */

const MIN_WINDOW_MS = 60 * 1000;
const DEFAULT_CRON_WINDOW_MS = 10 * 60 * 1000;

const DEFAULT_PRE4HR_OFFSET_MS = 4 * 60 * 60 * 1000;
const DEFAULT_MEET_OFFSET_MS = 1 * 60 * 60 * 1000;
const DEFAULT_30MIN_OFFSET_MS = 30 * 60 * 1000;

function parsePositiveIntEnv(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * @param {{ offsetEnvKey: string, windowEnvKey: string, defaultOffsetMs: number, defaultWindowMs?: number }}
 * @returns {{ offsetMs: number, windowMs: number }}
 */
function getReminderCronConfigFromEnv({
  offsetEnvKey,
  windowEnvKey,
  defaultOffsetMs,
  defaultWindowMs = DEFAULT_CRON_WINDOW_MS
}) {
  const offsetMs = parsePositiveIntEnv(offsetEnvKey, defaultOffsetMs);
  const windowMs = Math.max(
    parsePositiveIntEnv(windowEnvKey, defaultWindowMs),
    MIN_WINDOW_MS
  );
  return { offsetMs, windowMs };
}

/**
 * Mongo bounds for `step3Data.slotDate` on this cron tick.
 * @param {Date} [now]
 * @param {{ offsetMs: number, windowMs: number }} config
 */
function getSlotDateBoundsForCron(now = new Date(), config) {
  const { offsetMs, windowMs } = config;
  const nowMs = now.getTime();
  const targetMs = nowMs + offsetMs;
  const half = windowMs / 2;
  return {
    slotDateMin: new Date(targetMs - half),
    slotDateMax: new Date(targetMs + half),
    offsetMs,
    windowMs
  };
}

/**
 * @param {Date|string|number} slotDate
 * @param {Date} [now]
 * @param {{ offsetMs: number, windowMs: number }} config
 */
function isSlotDateInCronWindow(slotDate, now = new Date(), config) {
  const { slotDateMin, slotDateMax } = getSlotDateBoundsForCron(now, config);
  const t = new Date(slotDate).getTime();
  if (Number.isNaN(t)) return false;
  return t >= slotDateMin.getTime() && t <= slotDateMax.getTime();
}

function getMeetCronConfigFromEnv() {
  return getReminderCronConfigFromEnv({
    offsetEnvKey: 'WA_MEET_OFFSET_MS',
    windowEnvKey: 'WA_MEET_CRON_WINDOW_MS',
    defaultOffsetMs: DEFAULT_MEET_OFFSET_MS,
    defaultWindowMs: DEFAULT_CRON_WINDOW_MS
  });
}

function getMeetSlotDateBoundsForCron(now = new Date(), configOverride = null) {
  return getSlotDateBoundsForCron(now, configOverride || getMeetCronConfigFromEnv());
}

function get30MinCronConfigFromEnv() {
  return getReminderCronConfigFromEnv({
    offsetEnvKey: 'WA_30MIN_OFFSET_MS',
    windowEnvKey: 'WA_30MIN_CRON_WINDOW_MS',
    defaultOffsetMs: DEFAULT_30MIN_OFFSET_MS,
    defaultWindowMs: DEFAULT_CRON_WINDOW_MS
  });
}

function get30MinSlotDateBoundsForCron(now = new Date(), configOverride = null) {
  return getSlotDateBoundsForCron(now, configOverride || get30MinCronConfigFromEnv());
}

module.exports = {
  MIN_WINDOW_MS,
  DEFAULT_CRON_WINDOW_MS,
  DEFAULT_PRE4HR_OFFSET_MS,
  DEFAULT_MEET_OFFSET_MS,
  DEFAULT_30MIN_OFFSET_MS,
  parsePositiveIntEnv,
  getReminderCronConfigFromEnv,
  getSlotDateBoundsForCron,
  isSlotDateInCronWindow,
  getMeetCronConfigFromEnv,
  getMeetSlotDateBoundsForCron,
  get30MinCronConfigFromEnv,
  get30MinSlotDateBoundsForCron
};
