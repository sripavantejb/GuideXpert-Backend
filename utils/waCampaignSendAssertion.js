/**
 * Single choke-point helpers for slot-relative campaign WhatsApp sends (pre4hr, meet, 30min).
 */

const FormSubmission = require('../models/FormSubmission');
const { getCampaignReminderEligibility, CAMPAIGN_RELATIVE_KINDS } = require('./waReminderEligibility');

/**
 * Resolve booking instant: FormSubmission.step3Data.slotDate first; else cohortSlotInstantUtc (IIT / edge).
 */
async function resolveCampaignSlotInstant({ formSubmissionId, phone10, cohortSlotInstantUtc }) {
  let slot = null;
  if (formSubmissionId) {
    const sub = await FormSubmission.findById(formSubmissionId).select('step3Data.slotDate').lean();
    slot = sub && sub.step3Data && sub.step3Data.slotDate ? sub.step3Data.slotDate : null;
  } else if (phone10) {
    const sub = await FormSubmission.findOne({ phone: phone10 }).select('step3Data.slotDate').lean();
    slot = sub && sub.step3Data && sub.step3Data.slotDate ? sub.step3Data.slotDate : null;
  }
  if (
    slot == null &&
    cohortSlotInstantUtc instanceof Date &&
    !Number.isNaN(cohortSlotInstantUtc.getTime())
  ) {
    slot = cohortSlotInstantUtc;
  }
  return slot;
}

/**
 * Persisted timing proof for audit / dashboards (campaign kinds only).
 * @param {'pre4hr'|'meet'|'30min'} retryKind
 * @param {Date|string|null} slotInstant
 * @param {Date} actualSentAt
 */
function buildEligibilityTimingRecord(retryKind, slotInstant, actualSentAt) {
  if (!CAMPAIGN_RELATIVE_KINDS.has(retryKind) || slotInstant == null) return null;
  const slotAt = new Date(slotInstant);
  if (Number.isNaN(slotAt.getTime())) return null;
  const sentAt = actualSentAt instanceof Date ? actualSentAt : new Date(actualSentAt);
  const elig = getCampaignReminderEligibility(retryKind, slotAt, sentAt);
  const slotMs = slotAt.getTime();
  const sentMs = sentAt.getTime();
  const firstEligibleAt = elig.earliestAt instanceof Date ? elig.earliestAt : null;
  const firstEligibleMs = firstEligibleAt ? firstEligibleAt.getTime() : null;
  const sentTooEarly = firstEligibleMs != null ? sentMs < firstEligibleMs : false;
  const sentAfterExpiry = !Number.isNaN(slotMs) ? sentMs >= slotMs : false;
  const eligibilityViolationDeltaMs =
    firstEligibleMs != null && Number.isFinite(sentMs) ? sentMs - firstEligibleMs : null;
  return {
    slotInstantUtc: slotAt,
    firstEligibleAt,
    actualSentAt: sentAt,
    sentTooEarly,
    sentAfterExpiry,
    eligibilityViolationDeltaMs
  };
}

function logCampaignTimingBlocked(payload) {
  console.error(
    JSON.stringify({
      event: 'whatsapp_campaign_timing_blocked',
      ...payload
    })
  );
}

function logCampaignTimingInvariantViolation(payload) {
  console.error(
    JSON.stringify({
      event: 'whatsapp_campaign_timing_invariant_violation',
      ...payload
    })
  );
}

module.exports = {
  resolveCampaignSlotInstant,
  buildEligibilityTimingRecord,
  logCampaignTimingBlocked,
  logCampaignTimingInvariantViolation
};
