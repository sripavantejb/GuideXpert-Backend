const FormSubmission = require('../models/FormSubmission');
const { buildSlotNotificationVariables } = require('../utils/slotNotificationFormatters');
const {
  sendSlotBookedWhatsApp,
  sendPre4HrReminderWhatsApp,
  sendMeetLinkWhatsApp,
  sendReminder30MinWhatsApp
} = require('../services/gupshupService');
const { safeSendWhatsApp } = require('../utils/safeSendWhatsApp');

/**
 * Executes one retry scan (same semantics as GET /api/cron/retry-whatsapp).
 * @param {import('mongoose').Types.ObjectId|null} cronRunId
 * @returns {Promise<{ attempted: number, succeeded: number, failed: number, found: number }>}
 */
async function executeRetryWhatsAppBatch(cronRunId) {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const candidates = await FormSubmission.find({
    isRegistered: true,
    whatsappRetryCount: { $gt: 0, $lt: 3 },
    whatsappRetryKind: { $ne: null, $exists: true },
    lastWhatsappAttemptAt: { $lte: fiveMinAgo }
  }).lean();

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const doc of candidates) {
    attempted += 1;
    const kind = doc.whatsappRetryKind;
    const withMeetingLink = kind === 'meet' || kind === '30min';
    const vars = buildSlotNotificationVariables(doc, { withMeetingLink });
    /** @type {any} */
    let sendFn;
    switch (kind) {
      case 'slot_booked':
        sendFn = sendSlotBookedWhatsApp;
        break;
      case 'pre4hr':
        sendFn = sendPre4HrReminderWhatsApp;
        break;
      case 'meet':
        sendFn = sendMeetLinkWhatsApp;
        break;
      case '30min':
        sendFn = sendReminder30MinWhatsApp;
        break;
      default:
        failed += 1;
        continue;
    }

    const r = await safeSendWhatsApp({
      phone10: doc.phone,
      formSubmissionId: doc._id,
      vars,
      retryKind: kind,
      source: 'retry_cron',
      cronRunId,
      cronJobKey: 'retry_whatsapp',
      sendFn
    });
    if (r.success) succeeded += 1;
    else failed += 1;
  }

  return { attempted, succeeded, failed, found: candidates.length };
}

module.exports = {
  executeRetryWhatsAppBatch
};
