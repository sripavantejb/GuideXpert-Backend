const WhatsAppAgentHandoff = require('../../models/WhatsAppAgentHandoff');
const WhatsAppInboundMessage = require('../../models/WhatsAppInboundMessage');
const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');
const WhatsAppConversation = require('../../models/WhatsAppConversation');
const { claimHandoff, resolveHandoff } = require('./handoffService');
const whatsappOutbound = require('./whatsappOutboundService');
const { getMetricsSummary } = require('./chatbotMetricsService');

async function listHandoffs({ status, route, limit = 50 }) {
  const filter = {};
  if (status) filter.status = status;
  if (route) filter.route = route;
  return WhatsAppAgentHandoff.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
}

async function getConversationTranscript(conversationId, limit = 100) {
  const [inbound, outbound] = await Promise.all([
    WhatsAppInboundMessage.find({ conversationId })
      .sort({ receivedAt: 1 })
      .limit(limit)
      .lean(),
    WhatsAppOutboundMessage.find({ conversationId })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean(),
  ]);

  const merged = [
    ...inbound.map((m) => ({
      direction: 'in',
      at: m.receivedAt,
      type: m.messageType,
      text: m.text,
      id: m._id,
    })),
    ...outbound.map((m) => ({
      direction: 'out',
      at: m.createdAt,
      type: m.messageType,
      text: m.textPreview,
      senderType: m.senderType,
      status: m.status,
      id: m._id,
    })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  const conversation = await WhatsAppConversation.findById(conversationId).lean();
  return { conversation, messages: merged };
}

async function adminReplyToHandoff(handoffId, adminId, text) {
  const handoff = await WhatsAppAgentHandoff.findById(handoffId);
  if (!handoff) return { success: false, error: 'not_found' };

  await claimHandoff(handoffId, { adminId });

  const result = await whatsappOutbound.sendAgentTextReply({
    conversationId: handoff.conversationId,
    phone10: handoff.phone,
    text,
    senderAdminId: adminId,
    handoffId: handoff._id,
  });

  if (result.success) {
    await WhatsAppAgentHandoff.updateOne(
      { _id: handoffId },
      { $set: { lastAgentMessageAt: new Date(), status: 'claimed' } }
    );
  }

  return result;
}

module.exports = {
  listHandoffs,
  getConversationTranscript,
  adminReplyToHandoff,
  claimHandoff,
  resolveHandoff,
  getMetricsSummary,
};
