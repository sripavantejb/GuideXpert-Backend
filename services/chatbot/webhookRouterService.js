const { parseInboundWebhook } = require('../../utils/gupshupInboundPayload');

/**
 * Classify webhook body as inbound user message vs outbound DLR.
 * @param {object} body
 */
function classifyWebhookBody(body) {
  const inbound = parseInboundWebhook(body);
  if (inbound.isInbound && inbound.parsed) {
    return { kind: 'inbound', parsed: inbound.parsed };
  }
  return { kind: 'dlr', parsed: null };
}

module.exports = { classifyWebhookBody };
