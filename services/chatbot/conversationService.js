const WhatsAppConversation = require('../../models/WhatsAppConversation');
const WhatsAppBotState = require('../../models/WhatsAppBotState');
const { resolveLeadLinks } = require('../../utils/chatbotPhone');
const { isMongoDuplicateKeyError } = require('../../utils/mongoDuplicateKey');

const SESSION_WINDOW_MS = WhatsAppConversation.SESSION_WINDOW_MS;

function activeConversationFilter(phone, productLine) {
  return {
    phone,
    productLine,
    status: { $in: ['active', 'handoff'] },
  };
}

async function findActiveConversation(phone, productLine) {
  return WhatsAppConversation.findOne(activeConversationFilter(phone, productLine));
}

async function ensureBotStateForConversation(conversation, now) {
  try {
    await WhatsAppBotState.create({
      conversationId: conversation._id,
      phone: conversation.phone,
      state: 'greeting',
      context: {},
      stateEnteredAt: now,
      stateExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    });
  } catch (e) {
    if (!isMongoDuplicateKeyError(e)) {
      throw e;
    }
  }
}

async function createActiveConversation(links, productLine, now) {
  try {
    const convo = await WhatsAppConversation.create({
      phone: links.phone,
      productLine,
      status: 'active',
      formSubmissionId: links.formSubmissionId || null,
      iitCounsellingSubmissionId: links.iitCounsellingSubmissionId || null,
      lastInboundAt: now,
      sessionExpiresAt: new Date(now.getTime() + SESSION_WINDOW_MS),
      messageCount: 0,
      metadata: {},
    });
    await ensureBotStateForConversation(convo, now);
    return convo;
  } catch (e) {
    if (!isMongoDuplicateKeyError(e)) {
      throw e;
    }
    const existing = await findActiveConversation(links.phone, productLine);
    if (!existing) {
      throw e;
    }
    return existing;
  }
}

async function refreshExistingConversation(convo, links, now) {
  const updates = {
    lastInboundAt: now,
    sessionExpiresAt: new Date(now.getTime() + SESSION_WINDOW_MS),
    updatedAt: now,
  };
  if (links.formSubmissionId && !convo.formSubmissionId) {
    updates.formSubmissionId = links.formSubmissionId;
  }
  if (links.iitCounsellingSubmissionId && !convo.iitCounsellingSubmissionId) {
    updates.iitCounsellingSubmissionId = links.iitCounsellingSubmissionId;
  }
  await WhatsAppConversation.updateOne({ _id: convo._id }, { $set: updates });
  await ensureBotStateForConversation(convo, now);
  return WhatsAppConversation.findById(convo._id);
}

/**
 * Get or create active conversation for phone + product line.
 */
async function getOrCreateConversation(phone10, opts = {}) {
  const links = opts.leadLinks || (await resolveLeadLinks(phone10));
  const productLine = opts.productLine || links.productLine || 'unknown';
  const now = opts.now instanceof Date ? opts.now : new Date();

  if (!links.phone) {
    throw new Error('invalid_phone');
  }

  let convo = await findActiveConversation(links.phone, productLine);

  if (!convo) {
    convo = await createActiveConversation(links, productLine, now);
  } else {
    convo = await refreshExistingConversation(convo, links, now);
  }

  return { conversation: convo, leadLinks: links };
}

async function touchInbound(conversationId, now = new Date()) {
  await WhatsAppConversation.updateOne(
    { _id: conversationId },
    {
      $set: {
        lastInboundAt: now,
        sessionExpiresAt: new Date(now.getTime() + SESSION_WINDOW_MS),
        updatedAt: now,
      },
      $inc: { messageCount: 1 },
    }
  );
}

function isSessionActive(conversation, now = new Date()) {
  if (!conversation || !conversation.sessionExpiresAt) return false;
  return now.getTime() < new Date(conversation.sessionExpiresAt).getTime();
}

async function setConversationHandoff(conversationId, handoffId, now = new Date()) {
  await WhatsAppConversation.updateOne(
    { _id: conversationId },
    {
      $set: {
        status: 'handoff',
        currentHandoffId: handoffId,
        updatedAt: now,
      },
    }
  );
}

async function clearConversationHandoff(conversationId, now = new Date()) {
  await WhatsAppConversation.updateOne(
    { _id: conversationId },
    {
      $set: {
        status: 'active',
        currentHandoffId: null,
        updatedAt: now,
      },
    }
  );
}

module.exports = {
  getOrCreateConversation,
  findActiveConversation,
  createActiveConversation,
  touchInbound,
  isSessionActive,
  setConversationHandoff,
  clearConversationHandoff,
  SESSION_WINDOW_MS,
};
