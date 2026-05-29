const WhatsAppInboundMessage = require('../../models/WhatsAppInboundMessage');
const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');
const WhatsAppAgentHandoff = require('../../models/WhatsAppAgentHandoff');
const WhatsAppConversation = require('../../models/WhatsAppConversation');

async function getMetricsSummary(since = null) {
  const match = since ? { createdAt: { $gte: since } } : {};
  const [inbound, outbound, handoffs, conversations] = await Promise.all([
    WhatsAppInboundMessage.countDocuments(match),
    WhatsAppOutboundMessage.countDocuments(match),
    WhatsAppAgentHandoff.countDocuments(match),
    WhatsAppConversation.countDocuments(
      since ? { updatedAt: { $gte: since } } : {}
    ),
  ]);

  const openHandoffs = await WhatsAppAgentHandoff.countDocuments({
    status: { $in: ['open', 'claimed'] },
  });

  const failedOutbound = await WhatsAppOutboundMessage.countDocuments({
    ...match,
    status: 'failed',
  });

  return {
    inbound,
    outbound,
    handoffs,
    conversations,
    openHandoffs,
    failedOutbound,
  };
}

module.exports = { getMetricsSummary };
