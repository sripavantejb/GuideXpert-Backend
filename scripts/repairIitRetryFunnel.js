/**
 * Repair IIT reminder retry funnel: unblock infra-misclassified failures and arm promotion timers.
 *
 * Usage:
 *   node scripts/repairIitRetryFunnel.js
 *   node scripts/repairIitRetryFunnel.js --execute
 */
require('dotenv').config();
const mongoose = require('mongoose');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { IIT_REMINDER_MESSAGE_KINDS } = require('../models/WhatsAppReminderJob');
const {
  scheduleAttempt1RetryPromotion,
  computeRetryCandidates
} = require('../services/whatsappRetryOrchestrator');
const INFRA_RX = /WhatsApp disabled|Gupshup not configured|template id missing|ENABLE_WHATSAPP/i;

async function main() {
  const execute = process.argv.includes('--execute');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const now = new Date();

  const eventFilter = {
    messageKind: { $in: IIT_REMINDER_MESSAGE_KINDS },
    attemptNumber: 1,
    status: { $in: ['failed', 'retry_exhausted'] },
    $or: [
      { errorMessage: { $regex: INFRA_RX } },
      { terminalFailureKind: 'permanent', retryEligible: false }
    ]
  };

  const candidateEvents = await WhatsAppMessageEvent.countDocuments(eventFilter);
  const openIitGroups = await WhatsAppRetryGroup.countDocuments({
    messageKind: { $in: IIT_REMINDER_MESSAGE_KINDS },
    status: 'open'
  });

  if (!execute) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          candidateEventsToRepair: candidateEvents,
          openIitRetryGroups: openIitGroups,
          hint: 'Re-run with --execute to apply fixes'
        },
        null,
        2
      )
    );
    await mongoose.disconnect();
    return;
  }

  const eventFix = await WhatsAppMessageEvent.updateMany(
    {
      messageKind: { $in: IIT_REMINDER_MESSAGE_KINDS },
      attemptNumber: 1,
      status: { $in: ['failed', 'retry_exhausted'] },
      $or: [{ errorMessage: { $regex: INFRA_RX } }, { terminalFailureKind: 'permanent' }]
    },
    {
      $set: {
        status: 'failed',
        retryEligible: true,
        terminalFailureKind: null,
        retryExclusionReason: null,
        retryExclusionAt: null
      },
      $unset: {
        'retryExclusionMeta.nextAttempt': '',
        'retryExclusionMeta.attemptBatchId': '',
        'retryExclusionMeta.note': ''
      }
    }
  );

  const groupReopen = await WhatsAppRetryGroup.updateMany(
    {
      messageKind: { $in: IIT_REMINDER_MESSAGE_KINDS },
      status: { $in: ['exhausted', 'closed_no_more_retries'] }
    },
    {
      $set: {
        status: 'open',
        updatedAt: now
      },
      $unset: {
        attempt2BatchId: '',
        attempt2TriggeredAt: '',
        attempt3BatchId: '',
        attempt3TriggeredAt: ''
      }
    }
  );

  const groups = await WhatsAppRetryGroup.find({
    messageKind: { $in: IIT_REMINDER_MESSAGE_KINDS },
    status: 'open'
  })
    .select('_id messageKind attempt2BatchId')
    .lean();

  let promotionArmed = 0;
  let groupsWithCandidates = 0;

  /* eslint-disable no-await-in-loop */
  for (const g of groups) {
    if (g.attempt2BatchId) continue;
    const preview = await computeRetryCandidates(g._id, 1);
    if (!(preview.candidateCount > 0)) continue;
    groupsWithCandidates += 1;
    await scheduleAttempt1RetryPromotion(g._id, g.messageKind, now);
    promotionArmed += 1;
  }
  /* eslint-enable no-await-in-loop */

  console.log(
    JSON.stringify(
      {
        eventsUnblocked: eventFix.modifiedCount,
        groupsReopened: groupReopen.modifiedCount,
        groupsWithCandidates,
        promotionArmed,
        at: now.toISOString()
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { INFRA_RX };
