/**
 * Re-queue IIT reminder jobs stuck in exhausted/failed after infra misconfiguration.
 *
 * Usage:
 *   node scripts/requeueIitReminderJobs.js
 *   node scripts/requeueIitReminderJobs.js --dispatch
 */
require('dotenv').config();
const mongoose = require('mongoose');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const { IIT_REMINDER_MESSAGE_KINDS } = require('../models/WhatsAppReminderJob');
const { clearLeaseFields } = require('../services/whatsappReminderJobLifecycle');
const { dispatchDueReminderJobs } = require('../services/whatsappReminderJobDispatcher');

async function main() {
  const dispatch = process.argv.includes('--dispatch');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const now = new Date();

  const eventFix = await WhatsAppMessageEvent.updateMany(
    {
      messageKind: { $in: IIT_REMINDER_MESSAGE_KINDS },
      status: 'failed',
      errorMessage: { $regex: /WhatsApp disabled|Gupshup not configured|template id missing/i },
    },
    { $set: { terminalFailureKind: null, retryEligible: true } }
  );

  const jobFix = await WhatsAppReminderJob.updateMany(
    {
      messageKind: { $in: IIT_REMINDER_MESSAGE_KINDS },
      state: { $in: ['exhausted', 'failed', 'dispatched'] },
      slotDate: { $gt: now },
    },
    { $set: { state: 'pending', updatedAt: now, ...clearLeaseFields() } }
  );

  const failedDispatchedIds = await WhatsAppMessageEvent.distinct('retryGroupId', {
    messageKind: { $in: IIT_REMINDER_MESSAGE_KINDS },
    attemptNumber: 1,
    status: 'failed',
    errorMessage: { $regex: /WhatsApp disabled|Gupshup not configured|template id missing/i },
    retryGroupId: { $ne: null },
  });
  let falseDispatched = { modifiedCount: 0 };
  if (failedDispatchedIds.length) {
    falseDispatched = await WhatsAppReminderJob.updateMany(
      {
        retryGroupId: { $in: failedDispatchedIds },
        state: 'dispatched',
        slotDate: { $gt: now },
      },
      { $set: { state: 'pending', updatedAt: now, ...clearLeaseFields() } }
    );
  }

  console.log(
    JSON.stringify(
      {
        eventsUnblocked: eventFix.modifiedCount,
        jobsRequeued: jobFix.modifiedCount,
        falseDispatchedReset: falseDispatched.modifiedCount || 0,
      },
      null,
      2
    )
  );

  if (dispatch) {
    const stats = await dispatchDueReminderJobs({
      messageKinds: [...IIT_REMINDER_MESSAGE_KINDS],
      now,
      cronJobKey: 'requeue_iit_reminder_jobs',
      limit: 100,
    });
    console.log('dispatch', stats);
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
