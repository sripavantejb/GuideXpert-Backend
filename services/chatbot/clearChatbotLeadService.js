'use strict';

const WhatsAppConversation = require('../../models/WhatsAppConversation');
const WhatsAppBotState = require('../../models/WhatsAppBotState');
const WhatsAppInboundMessage = require('../../models/WhatsAppInboundMessage');
const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');
const WhatsAppLeadProfile = require('../../models/WhatsAppLeadProfile');
const WhatsAppLeadScore = require('../../models/WhatsAppLeadScore');
const WhatsAppLeadEvent = require('../../models/WhatsAppLeadEvent');
const WhatsAppAgentHandoff = require('../../models/WhatsAppAgentHandoff');
const ConversationRecoveryAttempt = require('../../models/ConversationRecoveryAttempt');
const ConversationRecoveryCase = require('../../models/ConversationRecoveryCase');
const ConversationRecoverySnapshot = require('../../models/ConversationRecoverySnapshot');

function phoneOrConversationFilter(phone10, conversationIds) {
  if (conversationIds.length) {
    return {
      $or: [{ phone: phone10 }, { conversationId: { $in: conversationIds } }],
    };
  }
  return { phone: phone10 };
}

/**
 * Fully reset a WhatsApp chatbot lead: profile, bot state, chat transcripts,
 * handoffs, lead scoring/events, and recovery state. Next inbound message is
 * treated like a brand-new lead.
 */
async function clearWhatsAppChatbotLead(phone10) {
  const conversations = await WhatsAppConversation.find({ phone: phone10 }).select('_id').lean();
  const conversationIds = conversations.map((c) => c._id);
  const scoped = phoneOrConversationFilter(phone10, conversationIds);

  const [
    leadEvents,
    outboundMessages,
    inboundMessages,
    handoffs,
    botStates,
    leadScores,
    leadProfiles,
    recoveryAttempts,
    recoveryCases,
    recoverySnapshots,
    deletedConversations,
  ] = await Promise.all([
    WhatsAppLeadEvent.deleteMany(scoped),
    WhatsAppOutboundMessage.deleteMany(scoped),
    WhatsAppInboundMessage.deleteMany(scoped),
    WhatsAppAgentHandoff.deleteMany(scoped),
    WhatsAppBotState.deleteMany(scoped),
    WhatsAppLeadScore.deleteMany({ phone: phone10 }),
    WhatsAppLeadProfile.deleteMany({ phone: phone10 }),
    ConversationRecoveryAttempt.deleteMany({ phone: phone10 }),
    ConversationRecoveryCase.deleteMany({ phone: phone10 }),
    ConversationRecoverySnapshot.deleteMany({ phone: phone10 }),
    WhatsAppConversation.deleteMany({ phone: phone10 }),
  ]);

  const deleted = {
    conversations: deletedConversations.deletedCount || 0,
    inboundMessages: inboundMessages.deletedCount || 0,
    outboundMessages: outboundMessages.deletedCount || 0,
    botStates: botStates.deletedCount || 0,
    leadProfiles: leadProfiles.deletedCount || 0,
    leadScores: leadScores.deletedCount || 0,
    leadEvents: leadEvents.deletedCount || 0,
    handoffs: handoffs.deletedCount || 0,
    recoveryAttempts: recoveryAttempts.deletedCount || 0,
    recoveryCases: recoveryCases.deletedCount || 0,
    recoverySnapshots: recoverySnapshots.deletedCount || 0,
  };

  const totalRemoved = Object.values(deleted).reduce((sum, n) => sum + n, 0);

  return {
    phone: phone10,
    deleted,
    conversationsMatched: conversationIds.length,
    totalRemoved,
  };
}

module.exports = {
  clearWhatsAppChatbotLead,
};
