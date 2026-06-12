'use strict';

const WhatsAppLeadProfile = require('../../../models/WhatsAppLeadProfile');
const { logChatbotEvent } = require('../chatbotStructuredLog');
const { maskPhoneTail } = require('../../../utils/chatbotPhone');
const { isLeadProfileEnabled } = require('./leadProfileFlags');
const { buildProfileUpdateOps } = require('./leadProfileConstants');
const { isLeadScoringEnabled } = require('../leadScoring/leadScoringFlags');
const { updateLeadScore } = require('../leadScoring/leadScoringService');

async function updateProfile({
  phone,
  conversationId,
  events = [],
  assistantType = 'unknown',
  inboundMessageId = null,
} = {}) {
  if (!isLeadProfileEnabled()) {
    return null;
  }

  const phone10 = String(phone || '').trim();
  if (!/^\d{10}$/.test(phone10) || !conversationId || !Array.isArray(events) || !events.length) {
    return null;
  }

  try {
    const now = new Date();
    const update = buildProfileUpdateOps({
      phone: phone10,
      conversationId,
      events,
      assistantType,
      now,
    });

    const profile = await WhatsAppLeadProfile.findOneAndUpdate({ phone: phone10 }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });

    logChatbotEvent('lead_profile_updated', {
      conversationId,
      phoneTail: maskPhoneTail(phone10),
      eventCountDelta: events.length,
      profileEventCount: profile?.eventCount ?? null,
      inboundMessageId: inboundMessageId ? String(inboundMessageId) : null,
      assistantType,
    });

    if (isLeadScoringEnabled()) {
      updateLeadScore({
        profile,
        inboundMessageId,
      }).catch((err) => {
        console.warn('[chatbot] lead_score_update_failed', err.message);
      });
    }

    return profile;
  } catch (error) {
    console.warn('[chatbot] lead_profile_update_failed', error.message);
    return null;
  }
}

module.exports = {
  updateProfile,
};
