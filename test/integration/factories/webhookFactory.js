'use strict';

const { applyWebhookToMessageEvent } = require('../../../controllers/gupshupWebhookController');

/**
 * Build Gupshup V2 message-event body.
 */
function buildGupshupBody({ gsId, phone10, stage }) {
  return {
    type: 'message-event',
    timestamp: String(Date.now()),
    payload: {
      type: stage,
      gsId,
      id: gsId,
      destination: `91${phone10}`,
      payload: { ts: String(Date.now()) }
    }
  };
}

/**
 * Apply webhook status directly to an event doc (integration path).
 * @param {object} event lean WhatsAppMessageEvent
 * @param {string} newStatus
 * @param {{ receivedAt?: Date }} [opts]
 */
async function replayWebhookOnEvent(event, newStatus, opts = {}) {
  const receivedAt = opts.receivedAt || new Date();
  return applyWebhookToMessageEvent(event, newStatus, {
    receivedAt,
    transitionTs: receivedAt,
    gsId: event.gupshupMessageId,
    outerId: event.gupshupMessageId,
    stage: newStatus
  });
}

module.exports = {
  buildGupshupBody,
  replayWebhookOnEvent
};
