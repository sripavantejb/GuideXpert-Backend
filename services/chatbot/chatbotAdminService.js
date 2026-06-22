const mongoose = require('mongoose');
const Admin = require('../../models/Admin');
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

function compareMessageKeysDesc(a, b) {
  const atA = new Date(a.at).getTime();
  const atB = new Date(b.at).getTime();
  if (atA !== atB) return atB - atA;
  return String(b.id).localeCompare(String(a.id));
}

function compareMessageKeysAsc(a, b) {
  return -compareMessageKeysDesc(a, b);
}

function mapInboundMessage(m) {
  return {
    direction: 'in',
    at: m.receivedAt,
    type: m.messageType,
    text: m.text,
    id: m._id,
  };
}

function mapOutboundMessage(m) {
  return {
    direction: 'out',
    at: m.createdAt,
    type: m.messageType,
    text: m.textPreview,
    senderType: m.senderType,
    senderAdminId: m.senderAdminId || null,
    status: m.status,
    id: m._id,
  };
}

function buildBeforeFilter(dateField, beforeAt, beforeId) {
  const beforeDate = new Date(beforeAt);
  const oid = beforeId ? new mongoose.Types.ObjectId(String(beforeId)) : null;
  if (!oid || Number.isNaN(beforeDate.getTime())) {
    return { [dateField]: { $lt: beforeDate } };
  }
  return {
    $or: [{ [dateField]: { $lt: beforeDate } }, { [dateField]: beforeDate, _id: { $lt: oid } }],
  };
}

function buildAfterFilter(dateField, afterAt, afterId) {
  const afterDate = new Date(afterAt);
  const oid = afterId ? new mongoose.Types.ObjectId(String(afterId)) : null;
  if (!oid || Number.isNaN(afterDate.getTime())) {
    return { [dateField]: { $gt: afterDate } };
  }
  return {
    $or: [{ [dateField]: { $gt: afterDate } }, { [dateField]: afterDate, _id: { $gt: oid } }],
  };
}

function cursorFromMessage(message) {
  if (!message) return null;
  return { at: message.at, id: String(message.id) };
}

async function attachSenderNames(messages) {
  const adminIds = [
    ...new Set(
      messages
        .filter((m) => m.senderType === 'agent' && m.senderAdminId)
        .map((m) => String(m.senderAdminId))
    ),
  ];
  if (!adminIds.length) return messages;

  const admins = await Admin.find({ _id: { $in: adminIds } })
    .select('name username')
    .lean();
  const nameById = new Map(
    admins.map((a) => [String(a._id), a.name || a.username || 'Counsellor'])
  );

  return messages.map((m) => {
    if (m.senderType !== 'agent' || !m.senderAdminId) return m;
    return {
      ...m,
      senderName: nameById.get(String(m.senderAdminId)) || 'Counsellor',
    };
  });
}

/**
 * Paginated transcript: newest-first fetch, returned chronological ascending.
 * @param {import('mongoose').Types.ObjectId|string} conversationId
 * @param {{ limit?: number, before?: string|Date, beforeId?: string, after?: string|Date, afterId?: string }} options
 */
async function getConversationTranscriptPage(conversationId, options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), 100);
  const { before, beforeId, after, afterId } = options;
  const fetchN = limit + 1;

  let inboundFilter = { conversationId };
  let outboundFilter = { conversationId };
  let inboundSort = { receivedAt: -1, _id: -1 };
  let outboundSort = { createdAt: -1, _id: -1 };
  let mergeSort = compareMessageKeysDesc;
  let reverseResult = true;

  if (before && beforeId) {
    inboundFilter = { conversationId, ...buildBeforeFilter('receivedAt', before, beforeId) };
    outboundFilter = { conversationId, ...buildBeforeFilter('createdAt', before, beforeId) };
  } else if (after && afterId) {
    inboundFilter = { conversationId, ...buildAfterFilter('receivedAt', after, afterId) };
    outboundFilter = { conversationId, ...buildAfterFilter('createdAt', after, afterId) };
    inboundSort = { receivedAt: 1, _id: 1 };
    outboundSort = { createdAt: 1, _id: 1 };
    mergeSort = compareMessageKeysAsc;
    reverseResult = false;
  }

  const [inbound, outbound, conversation] = await Promise.all([
    WhatsAppInboundMessage.find(inboundFilter).sort(inboundSort).limit(fetchN).lean(),
    WhatsAppOutboundMessage.find(outboundFilter).sort(outboundSort).limit(fetchN).lean(),
    WhatsAppConversation.findById(conversationId).lean(),
  ]);

  const merged = [
    ...inbound.map(mapInboundMessage),
    ...outbound.map(mapOutboundMessage),
  ].sort(mergeSort);

  let page = merged;
  let hasMoreOlder = false;
  let hasMoreNewer = false;

  if (before && beforeId) {
    hasMoreOlder = page.length > limit;
    page = page.slice(0, limit);
    page.reverse();
  } else if (after && afterId) {
    page = page.slice(0, limit);
    hasMoreNewer = merged.length > limit;
  } else {
    hasMoreOlder = page.length > limit;
    page = page.slice(0, limit);
    page.reverse();
  }

  const messages = await attachSenderNames(page);
  const oldestCursor = cursorFromMessage(messages[0]);
  const newestCursor = cursorFromMessage(messages[messages.length - 1]);

  return {
    conversation,
    messages,
    hasMoreOlder,
    hasMoreNewer,
    oldestCursor,
    newestCursor,
  };
}

async function getConversationTranscript(conversationId, limit = 100) {
  const page = await getConversationTranscriptPage(conversationId, { limit });
  return {
    conversation: page.conversation,
    messages: page.messages,
  };
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
  getConversationTranscriptPage,
  adminReplyToHandoff,
  claimHandoff,
  resolveHandoff,
  getMetricsSummary,
};
