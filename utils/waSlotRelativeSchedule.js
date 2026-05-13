/**
 * Shared slot-relative WhatsApp reminder cron eligibility:
 *
 * **Production crons** use a **deadline-backward** band so nothing sends before the true
 * T−offset moment (e.g. pre4hr at slot−4h):
 *   `step3Data.slotDate` ∈ [now + offset − windowMs, now + offset] (upper bound is strict deadline)
 * plus callers keep `step3Data.slotDate > now` so the session has not started.
 *
 * This replaces the older symmetric ±window/2 band around `now + offset`, which could
 * match slots **before** the intended send time (e.g. pre4hr up to ~5m early).
 *
 * Env keys per kind:
 *   pre4hr:  WA_PRE4HR_OFFSET_MS, WA_PRE4HR_CRON_WINDOW_MS
 *   meet:    WA_MEET_OFFSET_MS, WA_MEET_CRON_WINDOW_MS
 *   30min:   WA_30MIN_OFFSET_MS, WA_30MIN_CRON_WINDOW_MS
 *
 * `WA_SLOT_CRON_DEADLINE_FORWARD_SLACK_MS` is deprecated: positive values are ignored and
 * logged so the upper slot bound can never admit sends before slotTime − offset.
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

function parseNonNegativeIntEnv(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function deadlineForwardSlackMs() {
  const raw = parseNonNegativeIntEnv('WA_SLOT_CRON_DEADLINE_FORWARD_SLACK_MS', 0);
  if (raw > 0) {
    console.warn(
      '[waSlotRelativeSchedule] WA_SLOT_CRON_DEADLINE_FORWARD_SLACK_MS=%s ignored (must be 0). Forward slack cannot admit pre-boundary sends.',
      String(process.env.WA_SLOT_CRON_DEADLINE_FORWARD_SLACK_MS)
    );
  }
  return 0;
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
 * Legacy symmetric band (±window/2 around now+offset). Prefer
 * {@link getSlotDateDeadlineBackwardBoundsForCron} for cron eligibility.
 * @param {Date} [now]
 * @param {{ offsetMs: number, windowMs: number }} config
 */
function getSlotDateSymmetricBoundsForCron(now = new Date(), config) {
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
 * Mongo bounds for `step3Data.slotDate` on this cron tick (deadline-backward).
 * Slot is eligible when it lies in the last `windowMs` before `now + offset` (inclusive upper
 * bound `now + offset` only — no forward slack).
 *
 * @param {Date} [now]
 * @param {{ offsetMs: number, windowMs: number }} config
 */
function getSlotDateDeadlineBackwardBoundsForCron(now = new Date(), config) {
  const { offsetMs, windowMs } = config;
  const nowMs = now.getTime();
  const deadlineMs = nowMs + offsetMs;
  const slackMs = deadlineForwardSlackMs();
  return {
    slotDateMin: new Date(deadlineMs - windowMs),
    slotDateMax: new Date(deadlineMs),
    offsetMs,
    windowMs,
    deadlineForwardSlackMs: slackMs
  };
}

/**
 * @param {Date|string|number} slotDate
 * @param {Date} [now]
 * @param {{ offsetMs: number, windowMs: number }} config
 */
function isSlotDateInCronWindow(slotDate, now = new Date(), config) {
  const { slotDateMin, slotDateMax } = getSlotDateDeadlineBackwardBoundsForCron(now, config);
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
  return getSlotDateDeadlineBackwardBoundsForCron(now, configOverride || getMeetCronConfigFromEnv());
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
  return getSlotDateDeadlineBackwardBoundsForCron(now, configOverride || get30MinCronConfigFromEnv());
}

module.exports = {
  MIN_WINDOW_MS,
  DEFAULT_CRON_WINDOW_MS,
  DEFAULT_PRE4HR_OFFSET_MS,
  DEFAULT_MEET_OFFSET_MS,
  DEFAULT_30MIN_OFFSET_MS,
  parsePositiveIntEnv,
  getReminderCronConfigFromEnv,
  /** @deprecated Prefer getSlotDateDeadlineBackwardBoundsForCron for cron queries */
  getSlotDateSymmetricBoundsForCron,
  getSlotDateDeadlineBackwardBoundsForCron,
  isSlotDateInCronWindow,
  getMeetCronConfigFromEnv,
  getMeetSlotDateBoundsForCron,
  get30MinCronConfigFromEnv,
  get30MinSlotDateBoundsForCron
};
