/**
 * Strict deadline-backward eligibility for slot-relative WhatsApp templates (pre4hr, meet, 30min).
 * Uses the same offset ms as cron config from env (see pre4hrSchedule / waSlotRelativeSchedule).
 */

const { getPre4hrCronConfigFromEnv } = require('./pre4hrSchedule');
const { getMeetCronConfigFromEnv, get30MinCronConfigFromEnv } = require('./waSlotRelativeSchedule');

const CAMPAIGN_RELATIVE_KINDS = new Set(['pre4hr', 'meet', '30min']);

function offsetMsForKind(kind) {
  switch (kind) {
    case 'pre4hr':
      return getPre4hrCronConfigFromEnv().offsetMs;
    case 'meet':
      return getMeetCronConfigFromEnv().offsetMs;
    case '30min':
      return get30MinCronConfigFromEnv().offsetMs;
    default:
      return null;
  }
}

/**
 * @param {'pre4hr'|'meet'|'30min'} kind
 * @param {Date|string|number} slotDate
 * @param {Date} [now]
 * @returns {{ ok: boolean, reason?: string, earliestAt?: Date, slotAt?: Date }}
 */
function getCampaignReminderEligibility(kind, slotDate, now = new Date()) {
  if (!CAMPAIGN_RELATIVE_KINDS.has(kind)) {
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
  const off = offsetMsForKind(kind);
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

/**
 * Catch-up / immediate send after eligibility (Case B): booking when now is already >= earliest and before slot.
 * Replaces "inside cron symmetric window at booking instant" checks.
 */
function shouldSendCampaignReminderImmediately(kind, slotDate, now = new Date()) {
  return getCampaignReminderEligibility(kind, slotDate, now).ok;
}

/**
 * @throws {Error} when send would be before slotTime − offset (campaign kinds only)
 */
function assertCampaignSendNotEarly(kind, slotDate, now = new Date()) {
  const e = getCampaignReminderEligibility(kind, slotDate, now);
  if (!e.ok) {
    throw new Error(e.reason || 'campaign_send_not_eligible');
  }
}

/**
 * Offsets for Mongo $subtract (slotDate BsonDate - ms).
 */
function getReminderOffsetsMsForDiagnostics() {
  return {
    pre4hr: getPre4hrCronConfigFromEnv().offsetMs,
    meet: getMeetCronConfigFromEnv().offsetMs,
    min30: get30MinCronConfigFromEnv().offsetMs
  };
}

module.exports = {
  CAMPAIGN_RELATIVE_KINDS,
  offsetMsForKind,
  getCampaignReminderEligibility,
  shouldSendCampaignReminderImmediately,
  assertCampaignSendNotEarly,
  getReminderOffsetsMsForDiagnostics
};
