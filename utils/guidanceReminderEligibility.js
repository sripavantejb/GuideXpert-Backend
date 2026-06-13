/**
 * Eligibility and scheduling for guidance session 30-minute WhatsApp reminders.
 */
const { parseGuidanceSlotTimeWindow } = require('./guidanceSlotTimeWindow');
const { GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER } = require('./guidanceBookingWhatsApp');

const GUIDANCE_PRE30MIN_OFFSET_MS = 30 * 60 * 1000;

function parsePositiveIntEnv(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function offsetMsForGuidancePre30Min() {
  return parsePositiveIntEnv('WA_GUIDANCE_PRE30MIN_OFFSET_MS', GUIDANCE_PRE30MIN_OFFSET_MS);
}

function resolveGuidancePre30MinTemplateEnvKey() {
  const tid = process.env[GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER];
  return tid && String(tid).trim() ? GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER : null;
}

/**
 * @param {{ slotDate?: string, slotTime?: string }} slot
 * @returns {{ startUtc: Date, endUtc: Date }|null}
 */
function getGuidanceSlotStartInstant(slot) {
  const window = parseGuidanceSlotTimeWindow(slot);
  if (!window) return null;
  return { startUtc: window.startUtc, endUtc: window.endUtc };
}

function computeGuidancePre30ScheduledSendAt(slot) {
  const inst = getGuidanceSlotStartInstant(slot);
  if (!inst) return null;
  return new Date(inst.startUtc.getTime() - offsetMsForGuidancePre30Min());
}

/**
 * @param {{ slotDate?: string, slotTime?: string }} slot
 * @param {Date} [now]
 */
function getGuidancePre30ReminderEligibility(slot, now = new Date()) {
  const inst = getGuidanceSlotStartInstant(slot);
  if (!inst) {
    return { ok: false, reason: 'invalid_schedule' };
  }

  const slotMs = inst.startUtc.getTime();
  const nowMs = now.getTime();
  const slotAt = inst.startUtc;

  if (nowMs >= slotMs) {
    return { ok: false, reason: 'slot_passed', slotAt };
  }

  const scheduledSendAt = computeGuidancePre30ScheduledSendAt(slot);
  if (!scheduledSendAt || scheduledSendAt.getTime() >= slotMs) {
    return { ok: false, reason: 'invalid_schedule', slotAt };
  }

  if (nowMs < scheduledSendAt.getTime()) {
    return { ok: false, reason: 'before_eligibility', earliestAt: scheduledSendAt, slotAt };
  }

  return { ok: true, earliestAt: scheduledSendAt, slotAt };
}

/**
 * Scheduling-time checks when a booking is created.
 * @param {{ slotDate?: string, slotTime?: string }} slot
 * @param {Date} [now]
 */
function getGuidancePre30ScheduleDecision(slot, now = new Date()) {
  const templateIdEnvKey = resolveGuidancePre30MinTemplateEnvKey();
  if (!templateIdEnvKey) {
    return { state: 'skipped', suppressionReason: 'template_env_missing' };
  }

  const inst = getGuidanceSlotStartInstant(slot);
  if (!inst) {
    return { state: 'skipped', suppressionReason: 'invalid_schedule' };
  }

  const nowMs = now.getTime();
  const slotAt = inst.startUtc;
  const scheduledSendAt = computeGuidancePre30ScheduledSendAt(slot);

  if (nowMs >= slotAt.getTime()) {
    return { state: 'skipped', suppressionReason: 'slot_passed', slotAt, scheduledSendAt };
  }
  if (!scheduledSendAt || scheduledSendAt.getTime() >= slotAt.getTime()) {
    return { state: 'skipped', suppressionReason: 'invalid_schedule', slotAt, scheduledSendAt };
  }
  if (nowMs >= scheduledSendAt.getTime()) {
    return { state: 'skipped', suppressionReason: 'booking_too_late', slotAt, scheduledSendAt };
  }

  return {
    state: 'pending',
    suppressionReason: null,
    slotAt,
    scheduledSendAt,
    templateIdEnvKey,
    firstEligibleAt: scheduledSendAt,
  };
}

module.exports = {
  GUIDANCE_PRE30MIN_OFFSET_MS,
  offsetMsForGuidancePre30Min,
  resolveGuidancePre30MinTemplateEnvKey,
  getGuidanceSlotStartInstant,
  computeGuidancePre30ScheduledSendAt,
  getGuidancePre30ReminderEligibility,
  getGuidancePre30ScheduleDecision,
};
