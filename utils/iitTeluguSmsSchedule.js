/**
 * Schedule computation for IIT counselling Telugu SMS reminder jobs.
 * T = counsellingSlotInstantUtc (slot start).
 */
const { slotDayIstFromInstant } = require('../services/whatsappOpsCohortShared');
const { IIT_TELUGU_SMS_MESSAGE_KINDS } = require('../models/IitTeluguSmsReminderJob');

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const DEFAULT_CRON_WINDOW_MS = 10 * MS_PER_MINUTE;

function parsePositiveIntEnv(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function cronWindowMs() {
  return parsePositiveIntEnv('IIT_TELUGU_SMS_CRON_WINDOW_MS', DEFAULT_CRON_WINDOW_MS);
}

function isPostSlotKind(kind) {
  return kind === 'iit_sms_tplus_5m';
}

/**
 * @param {string} kind
 * @param {Date} slotAt
 * @returns {Date|null}
 */
function computeScheduledSendAt(kind, slotAt) {
  const slotMs = new Date(slotAt).getTime();
  if (Number.isNaN(slotMs)) return null;

  switch (kind) {
    case 'iit_sms_tminus_1d':
      return new Date(slotMs - MS_PER_DAY);
    case 'iit_sms_tminus_2h':
      return new Date(slotMs - 2 * MS_PER_HOUR);
    case 'iit_sms_session_8am': {
      const slotDayIst = slotDayIstFromInstant(slotAt);
      if (!slotDayIst) return null;
      return new Date(`${slotDayIst}T08:00:00+05:30`);
    }
    case 'iit_sms_tminus_30m':
      return new Date(slotMs - 30 * MS_PER_MINUTE);
    case 'iit_sms_tminus_5m':
      return new Date(slotMs - 5 * MS_PER_MINUTE);
    case 'iit_sms_tplus_5m':
      return new Date(slotMs + 5 * MS_PER_MINUTE);
    default:
      return null;
  }
}

/**
 * @param {string} kind
 * @param {Date} scheduledSendAt
 * @param {Date} slotAt
 * @returns {Date|null}
 */
function computeExpiresAt(kind, scheduledSendAt, slotAt) {
  if (!scheduledSendAt) return null;
  const schedMs = new Date(scheduledSendAt).getTime();
  if (Number.isNaN(schedMs)) return null;
  const window = cronWindowMs();

  if (isPostSlotKind(kind)) {
    return new Date(schedMs + window);
  }

  const slotMs = slotAt ? new Date(slotAt).getTime() : NaN;
  const windowEnd = schedMs + window;
  if (!Number.isNaN(slotMs)) {
    return new Date(Math.min(windowEnd, slotMs));
  }
  return new Date(windowEnd);
}

function noBackfillForKind(kind) {
  return kind !== 'iit_sms_tminus_2h';
}

/**
 * @param {string} kind
 * @param {Date} scheduledSendAt
 * @param {Date} slotAt
 * @param {Date} [now]
 * @returns {{ state: 'pending'|'skipped', suppressionReason: string|null, sendImmediately: boolean }}
 */
function evaluateScheduleAtCreation(kind, scheduledSendAt, slotAt, now = new Date()) {
  const nowMs = now.getTime();
  const schedMs = scheduledSendAt ? new Date(scheduledSendAt).getTime() : NaN;
  const slotMs = slotAt ? new Date(slotAt).getTime() : NaN;

  if (!scheduledSendAt || Number.isNaN(schedMs)) {
    return { state: 'skipped', suppressionReason: 'invalid_schedule', sendImmediately: false };
  }

  if (!Number.isNaN(slotMs) && nowMs >= slotMs && !isPostSlotKind(kind)) {
    return { state: 'skipped', suppressionReason: 'slot_passed', sendImmediately: false };
  }

  if (kind === 'iit_sms_tminus_2h') {
    if (nowMs >= schedMs && nowMs < slotMs) {
      return { state: 'pending', suppressionReason: null, sendImmediately: true };
    }
    if (nowMs >= slotMs) {
      return { state: 'skipped', suppressionReason: 'slot_passed', sendImmediately: false };
    }
    return { state: 'pending', suppressionReason: null, sendImmediately: false };
  }

  if (noBackfillForKind(kind) && nowMs > schedMs) {
    return { state: 'skipped', suppressionReason: 'missed_window', sendImmediately: false };
  }

  return { state: 'pending', suppressionReason: null, sendImmediately: false };
}

/**
 * @param {Date} slotAt
 * @param {Date} [now]
 * @returns {Record<string, { scheduledSendAt: Date|null, expiresAt: Date|null, noBackfill: boolean, ... }>}
 */
function buildAllTriggerSchedules(slotAt, now = new Date()) {
  const out = {};
  for (const kind of IIT_TELUGU_SMS_MESSAGE_KINDS) {
    const scheduledSendAt = computeScheduledSendAt(kind, slotAt);
    const expiresAt = scheduledSendAt
      ? computeExpiresAt(kind, scheduledSendAt, slotAt)
      : null;
    const evalResult = scheduledSendAt
      ? evaluateScheduleAtCreation(kind, scheduledSendAt, slotAt, now)
      : { state: 'skipped', suppressionReason: 'invalid_schedule', sendImmediately: false };

    let effectiveExpiresAt = expiresAt;
    // T−2h "send now" bookings complete after the nominal 4:00 window; keep claimable until slot.
    if (
      kind === 'iit_sms_tminus_2h' &&
      evalResult.sendImmediately &&
      slotAt &&
      !Number.isNaN(new Date(slotAt).getTime())
    ) {
      effectiveExpiresAt = new Date(slotAt);
    }

    out[kind] = {
      scheduledSendAt,
      expiresAt: effectiveExpiresAt,
      noBackfill: noBackfillForKind(kind),
      firstEligibleAt: scheduledSendAt || now,
      ...evalResult,
    };
  }
  return out;
}

module.exports = {
  IIT_TELUGU_SMS_MESSAGE_KINDS,
  MS_PER_DAY,
  MS_PER_HOUR,
  cronWindowMs,
  computeScheduledSendAt,
  computeExpiresAt,
  noBackfillForKind,
  isPostSlotKind,
  evaluateScheduleAtCreation,
  buildAllTriggerSchedules,
};
