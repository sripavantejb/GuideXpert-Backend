const {
  scanGroupsNeedingRetries,
  processSlotBookedImmediateRetries
} = require('./whatsappRetryOrchestrator');

/**
 * Cron / manual batch: promote open retry groups using message-row failure cohorts (not FormSubmission counters).
 * @param {import('mongoose').Types.ObjectId|null} cronRunId
 * @returns {Promise<{ attempted: number, succeeded: number, failed: number, found: number, groupsTouched: number }>}
 */
async function executeRetryWhatsAppBatch(cronRunId) {
  const [campaign, slotBooked] = await Promise.all([
    scanGroupsNeedingRetries(cronRunId),
    processSlotBookedImmediateRetries(cronRunId)
  ]);
  return {
    attempted: (campaign.attempted || 0) + (slotBooked.attempted || 0),
    succeeded: (campaign.succeeded || 0) + (slotBooked.succeeded || 0),
    failed: (campaign.failed || 0) + (slotBooked.failed || 0),
    found: (campaign.foundCandidates || 0) + (slotBooked.considered || 0),
    groupsTouched: campaign.groupsTouched || 0,
    slotBookedImmediate: slotBooked
  };
}

module.exports = {
  executeRetryWhatsAppBatch
};
