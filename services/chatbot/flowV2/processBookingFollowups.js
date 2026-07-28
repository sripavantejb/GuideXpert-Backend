'use strict';

/**
 * Cron worker — send due Stage 10 Maybe Later follow-ups (+30m / +1h / +3h).
 */

const WhatsAppBotState = require('../../../models/WhatsAppBotState');
const whatsappOutbound = require('../whatsappOutboundService');
const {
  nextDueFollowup,
  markFollowupSent,
} = require('./bookingFollowupService');
const { mergeFlowV2Profile } = require('./flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../constants/careerCounsellingFlowV2Profile');

async function processDueBookingFollowups({ limit = 50, now = new Date() } = {}) {
  const cursor = WhatsAppBotState.find({
    state: 'career_counselling_flow_v2',
    'context.flowV2.stage': 'b7_post_decline',
    'context.flowV2.profile.bookingFollowup.declinedAt': { $exists: true },
  })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  const rows = await cursor;
  let scanned = 0;
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    scanned += 1;
    const flowV2 = row.context?.flowV2 || {};
    const profile = flowV2.profile || emptyFlowV2Profile();
    const step = nextDueFollowup(profile, now);
    if (!step) {
      skipped += 1;
      continue;
    }

    try {
      const result = await whatsappOutbound.sendBotButtonReply({
        conversationId: row.conversationId,
        phone10: row.phone,
        body: step.body,
        buttons: step.buttons,
        inReplyToInboundId: null,
      });
      if (!result || result.success === false) {
        errors += 1;
        continue;
      }

      const nextProfile = markFollowupSent(mergeFlowV2Profile(profile, {}), step.level);
      await WhatsAppBotState.updateOne(
        { _id: row._id },
        {
          $set: {
            'context.flowV2.profile': nextProfile,
            'context.flowV2.stage': 'b7_post_decline',
            updatedAt: new Date(),
          },
          $inc: { version: 1 },
        }
      );
      sent += 1;
    } catch (err) {
      errors += 1;
      console.error('[bookingFollowup] send_failed', {
        phone: row.phone,
        level: step.level,
        error: err?.message || String(err),
      });
    }
  }

  return { scanned, sent, skipped, errors };
}

module.exports = {
  processDueBookingFollowups,
};
