'use strict';

const ConversationRecoveryAttempt = require('../../models/ConversationRecoveryAttempt');

/** Count recovery sends in the current IST calendar day. */
async function countSentToday(now = new Date()) {
  const offsetMs = 5.5 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offsetMs);
  const startLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    0,
    0,
    0,
    0
  );
  const dayStart = new Date(startLocal - offsetMs);
  return ConversationRecoveryAttempt.countDocuments({
    sentAt: { $gte: dayStart, $lte: now },
    deliveryStatus: { $in: ['sent', 'delivered', 'read'] },
  });
}

module.exports = {
  countSentToday,
};
