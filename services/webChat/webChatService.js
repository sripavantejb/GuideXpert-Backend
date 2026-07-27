'use strict';

const crypto = require('crypto');
const WebChatSession = require('../../models/WebChatSession');
const { buildWelcomeResponse, QUICK_REPLIES_DEFAULT } = require('./webChatMenu');
const { processConversationTurn } = require('./webChatStateMachine');

function isWebChatEnabled() {
  return String(process.env.WEB_CHAT_ENABLED || '1').trim() !== '0';
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

function normalizeName(value) {
  return String(value || '').trim().slice(0, 120);
}

function newSessionId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

async function getOrCreateSession(sessionId, identity = {}) {
  const id = String(sessionId || '').trim() || newSessionId();
  try {
    let doc = await WebChatSession.findOne({ sessionId: id });
    if (!doc) {
      doc = await WebChatSession.create({
        sessionId: id,
        flow: 'idle',
        context: {},
        phone: normalizePhone(identity.phone),
        fullName: normalizeName(identity.fullName),
      });
      return { doc, isNew: true };
    }
    const phone = normalizePhone(identity.phone);
    const fullName = normalizeName(identity.fullName);
    if ((phone && phone !== doc.phone) || (fullName && fullName !== doc.fullName)) {
      doc.phone = phone || doc.phone;
      doc.fullName = fullName || doc.fullName;
    }
    return { doc, isNew: false };
  } catch {
    return {
      doc: {
        sessionId: id,
        flow: 'idle',
        context: {},
        phone: normalizePhone(identity.phone),
        fullName: normalizeName(identity.fullName),
        messageCount: 0,
        save: async () => {},
      },
      isNew: !sessionId,
    };
  }
}

async function processWebChatMessage({ sessionId, message, phone, fullName, isWelcome = false }) {
  if (!isWebChatEnabled()) {
    const err = new Error('Website chat is temporarily unavailable.');
    err.statusCode = 503;
    throw err;
  }

  const text = String(message || '').trim();
  const { doc: session, isNew } = await getOrCreateSession(sessionId, { phone, fullName });

  if (isWelcome && isNew) {
    const welcome = buildWelcomeResponse({ sessionId: session.sessionId });
    return formatResponse(session.sessionId, welcome);
  }

  if (!text) {
    const err = new Error('Message is required');
    err.statusCode = 400;
    throw err;
  }

  const identity = { phone: session.phone, fullName: session.fullName };
  const outcome = await processConversationTurn({ session, message: text, identity });

  if (outcome.clearFlow) {
    session.flow = 'idle';
    session.context = {};
  } else {
    session.flow = outcome.flow || 'idle';
    session.context = outcome.context || {};
  }

  session.messageCount = (session.messageCount || 0) + 1;
  session.lastMessageAt = new Date();
  await session.save?.();

  return formatResponse(session.sessionId, {
    ...outcome,
    flow: session.flow,
  });
}

async function resetWebChatSession(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return { sessionId: newSessionId(), cleared: true };
  try {
    await WebChatSession.findOneAndUpdate(
      { sessionId: id },
      { $set: { flow: 'idle', context: {}, lastMessageAt: new Date() } }
    );
  } catch {
    // best effort
  }
  return { sessionId: id, cleared: true };
}

function formatResponse(sessionId, outcome) {
  return {
    sessionId,
    reply: outcome.reply,
    flow: outcome.flow || 'idle',
    quickReplies: outcome.quickReplies || QUICK_REPLIES_DEFAULT,
    toolResult: outcome.toolResult || null,
    usedLlm: Boolean(outcome.usedLlm),
    source: outcome.source || (outcome.toolResult ? 'tool' : 'rules'),
  };
}

module.exports = {
  isWebChatEnabled,
  processWebChatMessage,
  resetWebChatSession,
  newSessionId,
};
