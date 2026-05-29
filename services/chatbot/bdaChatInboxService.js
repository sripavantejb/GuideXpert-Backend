const WhatsAppAgentHandoff = require('../../models/WhatsAppAgentHandoff');
const { claimHandoff, resolveHandoff } = require('./handoffService');
const whatsappOutbound = require('./whatsappOutboundService');

async function listHandoffsForBda(bdaId, { status = null, limit = 50 } = {}) {
  const filter = {
    route: 'bda',
    assignedBdaId: bdaId,
  };
  if (status) filter.status = status;
  else filter.status = { $in: ['open', 'claimed'] };

  return WhatsAppAgentHandoff.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
}

async function bdaResolveHandoff(handoffId, bdaId) {
  return resolveHandoff(handoffId, { resolvedBy: 'bda', bdaId });
}

async function bdaReplyToHandoff(handoffId, bdaId, text) {
  const handoff = await WhatsAppAgentHandoff.findById(handoffId);
  if (!handoff) return { success: false, error: 'not_found' };
  if (String(handoff.assignedBdaId) !== String(bdaId)) {
    return { success: false, error: 'not_assigned' };
  }

  await claimHandoff(handoffId, { bdaId });

  const result = await whatsappOutbound.sendAgentTextReply({
    conversationId: handoff.conversationId,
    phone10: handoff.phone,
    text,
    senderBdaId: bdaId,
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
  listHandoffsForBda,
  bdaReplyToHandoff,
  bdaResolveHandoff,
  claimHandoff,
};
