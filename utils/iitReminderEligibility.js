/**
 * Eligibility and offsets for IIT counselling scheduled WhatsApp reminders.
 */
const { getReminderCronConfigFromEnv } = require('./waSlotRelativeSchedule');

const IIT_REMINDER_KINDS = new Set(['iit_pre2hr', 'iit_pre45min', 'iit_pre15min']);

const DEFAULT_IIT_PRE2HR_OFFSET_MS = 2 * 60 * 60 * 1000;
const DEFAULT_IIT_PRE45MIN_OFFSET_MS = 45 * 60 * 1000;
const DEFAULT_IIT_PRE15MIN_OFFSET_MS = 15 * 60 * 1000;

function parsePositiveIntEnv(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function offsetMsForIitKind(kind) {
  switch (kind) {
    case 'iit_pre2hr':
      return parsePositiveIntEnv('WA_IIT_PRE2HR_OFFSET_MS', DEFAULT_IIT_PRE2HR_OFFSET_MS);
    case 'iit_pre45min':
      return parsePositiveIntEnv('WA_IIT_PRE45MIN_OFFSET_MS', DEFAULT_IIT_PRE45MIN_OFFSET_MS);
    case 'iit_pre15min':
      return parsePositiveIntEnv('WA_IIT_PRE15MIN_OFFSET_MS', DEFAULT_IIT_PRE15MIN_OFFSET_MS);
    default:
      return null;
  }
}

function cronWindowMsForIitKind(kind) {
  switch (kind) {
    case 'iit_pre2hr':
      return getReminderCronConfigFromEnv({
        offsetEnvKey: 'WA_IIT_PRE2HR_OFFSET_MS',
        windowEnvKey: 'WA_IIT_PRE2HR_CRON_WINDOW_MS',
        defaultOffsetMs: DEFAULT_IIT_PRE2HR_OFFSET_MS,
      }).windowMs;
    case 'iit_pre45min':
      return getReminderCronConfigFromEnv({
        offsetEnvKey: 'WA_IIT_PRE45MIN_OFFSET_MS',
        windowEnvKey: 'WA_IIT_PRE45MIN_CRON_WINDOW_MS',
        defaultOffsetMs: DEFAULT_IIT_PRE45MIN_OFFSET_MS,
      }).windowMs;
    case 'iit_pre15min':
      return getReminderCronConfigFromEnv({
        offsetEnvKey: 'WA_IIT_PRE15MIN_OFFSET_MS',
        windowEnvKey: 'WA_IIT_PRE15MIN_CRON_WINDOW_MS',
        defaultOffsetMs: DEFAULT_IIT_PRE15MIN_OFFSET_MS,
      }).windowMs;
    default:
      return 10 * 60 * 1000;
  }
}

/**
 * @param {'iit_pre2hr'|'iit_pre45min'|'iit_pre15min'} kind
 * @param {Date|string|number} slotDate
 * @param {Date} [now]
 */
function getIitReminderEligibility(kind, slotDate, now = new Date()) {
  if (!IIT_REMINDER_KINDS.has(kind)) {
    return { ok: true };
  }
  const slotMs = new Date(slotDate).getTime();
  if (Number.isNaN(slotMs)) {
    return { ok: false, reason: 'invalid_slot_date' };
  }
  const nowMs = now.getTime();
  const slotAt = new Date(slotMs);
  if (nowMs >= slotMs) {
    return { ok: false, reason: 'slot_passed', slotAt };
  }
  const off = offsetMsForIitKind(kind);
  if (off == null) {
    return { ok: true };
  }
  const earliestMs = slotMs - off;
  const earliestAt = new Date(earliestMs);
  if (nowMs < earliestMs) {
    return { ok: false, reason: 'before_eligibility', earliestAt, slotAt };
  }
  return { ok: true, earliestAt, slotAt };
}

function computeIitScheduledSendAt(kind, slotDate) {
  const slotMs = new Date(slotDate).getTime();
  if (Number.isNaN(slotMs)) return null;
  const off = offsetMsForIitKind(kind);
  if (off == null) return null;
  return new Date(slotMs - off);
}

module.exports = {
  IIT_REMINDER_KINDS,
  offsetMsForIitKind,
  cronWindowMsForIitKind,
  getIitReminderEligibility,
  computeIitScheduledSendAt,
  DEFAULT_IIT_PRE2HR_OFFSET_MS,
  DEFAULT_IIT_PRE45MIN_OFFSET_MS,
  DEFAULT_IIT_PRE15MIN_OFFSET_MS,
};
