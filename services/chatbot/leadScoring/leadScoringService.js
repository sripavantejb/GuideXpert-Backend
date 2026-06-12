'use strict';

const WhatsAppLeadScore = require('../../../models/WhatsAppLeadScore');
const { logChatbotEvent } = require('../chatbotStructuredLog');
const { maskPhoneTail } = require('../../../utils/chatbotPhone');
const { isLeadScoringEnabled } = require('./leadScoringFlags');
const { buildLeadScoreUpdateOps } = require('./leadScoringConstants');

async function updateLeadScore({ profile, inboundMessageId = null } = {}) {
  if (!isLeadScoringEnabled()) {
    return null;
  }

  const phone10 = String(profile?.phone || '').trim();
  const conversationId = profile?.conversationId;
  if (!/^\d{10}$/.test(phone10) || !conversationId) {
    return null;
  }

  try {
    const now = new Date();
    const update = buildLeadScoreUpdateOps({
      phone: phone10,
      conversationId,
      profile,
      now,
    });

    const scoreDoc = await WhatsAppLeadScore.findOneAndUpdate({ phone: phone10 }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });

    logChatbotEvent('lead_score_updated', {
      conversationId,
      phoneTail: maskPhoneTail(phone10),
      leadScore: scoreDoc?.leadScore ?? update.$set.leadScore,
      leadStage: scoreDoc?.leadStage ?? update.$set.leadStage,
      confidence: scoreDoc?.confidence ?? update.$set.confidence,
      scoreReasonCount: update.$set.scoreReasons.length,
      inboundMessageId: inboundMessageId ? String(inboundMessageId) : null,
    });

    return scoreDoc;
  } catch (error) {
    console.warn('[chatbot] lead_score_update_failed', error.message);
    return null;
  }
}

module.exports = {
  updateLeadScore,
};
