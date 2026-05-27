/**
 * Recover IIT pre2hr WhatsApp jobs stuck after Gupshup 132012 + attempt_already_recorded.
 *
 * Usage:
 *   node scripts/repairIitWhatsAppPre2hrJobs.js
 *   node scripts/repairIitWhatsAppPre2hrJobs.js --dispatch
 */
require('dotenv').config();
const mongoose = require('mongoose');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const { clearLeaseFields } = require('../services/whatsappReminderJobLifecycle');
const { dispatchDueReminderJobs } = require('../services/whatsappReminderJobDispatcher');

async function main() {
  const dispatch = process.argv.includes('--dispatch');
  await mongoose.connect(process.env.MONGODB_URI);
  const now = new Date();

  const eventFix = await WhatsAppMessageEvent.updateMany(
    {
      messageKind: 'iit_pre2hr',
      status: 'failed',
      $or: [{ webhookErrorCode: '132012' }, { errorMessage: /132012|parameter format does not match/i }],
      retryGroupId: { $ne: null },
    },
    {
      $set: {
        retryEligible: true,
        terminalFailureKind: 'transient',
        retryExclusionReason: null,
        retryExclusionAt: null,
      },
    }
  );

  const jobFix = await WhatsAppReminderJob.updateMany(
    {
      messageKind: 'iit_pre2hr',
      state: { $in: ['exhausted', 'failed'] },
      slotDate: { $gt: now },
      $or: [
        { lastError: 'attempt_already_recorded' },
        { lastError: /132012|parameter format/i },
      ],
    },
    {
      $set: {
        state: 'pending',
        lastError: null,
        suppressionReason: null,
        updatedAt: now,
        ...clearLeaseFields(),
      },
    }
  );

  console.log(
    JSON.stringify(
      { eventsUnblocked: eventFix.modifiedCount, jobsRequeued: jobFix.modifiedCount },
      null,
      2
    )
  );

  if (dispatch) {
    const stats = await dispatchDueReminderJobs({
      messageKinds: ['iit_pre2hr'],
      now,
      cronJobKey: 'repair_iit_pre2hr',
      limit: 150,
    });
    console.log('dispatch', JSON.stringify(stats, null, 2));
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
