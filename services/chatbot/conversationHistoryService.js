'use strict';

const WhatsAppInboundMessage = require('../../models/WhatsAppInboundMessage');
const WhatsAppOutboundMessage = require('../../models/WhatsAppOutboundMessage');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;

function clampLimit(limit) {
  const parsed = Number(limit) || DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_LIMIT));
}

function cleanContent(value) {
  const text = String(value || '').trim();
  return text || null;
}

function getOutboundText(row) {
  return cleanContent(row?.content?.text) || cleanContent(row?.textPreview);
}

function mapInbound(row) {
  if (row?.messageType && row.messageType !== 'text') return null;
  const content = cleanContent(row?.text);
  if (!content) return null;
  return {
    role: 'user',
    content,
    at: row.receivedAt || row.createdAt || new Date(0),
  };
}

function mapOutbound(row) {
  if (row?.messageType && row.messageType !== 'text') return null;
  const content = getOutboundText(row);
  if (!content) return null;
  return {
    role: 'assistant',
    content,
    at: row.createdAt || row.sentAt || row.updatedAt || new Date(0),
  };
}

async function getConversationHistory({ conversationId, limit = DEFAULT_LIMIT } = {}) {
  if (!conversationId) return [];

  const max = clampLimit(limit);
  const [inboundRows, outboundRows] = await Promise.all([
    WhatsAppInboundMessage.find({
      conversationId,
      messageType: 'text',
      text: { $type: 'string', $ne: '' },
    })
      .sort({ receivedAt: -1 })
      .limit(max)
      .select('messageType text receivedAt createdAt')
      .lean(),
    WhatsAppOutboundMessage.find({
      conversationId,
      senderType: 'bot',
      messageType: 'text',
    })
      .sort({ createdAt: -1 })
      .limit(max)
      .select('messageType content textPreview createdAt sentAt updatedAt')
      .lean(),
  ]);

  return [...inboundRows.map(mapInbound), ...outboundRows.map(mapOutbound)]
    .filter(Boolean)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, max)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .map(({ role, content }) => ({ role, content }));
}

module.exports = { getConversationHistory };
