'use strict';

const crypto = require('crypto');
const WebChatSession = require('../../models/WebChatSession');
const { classifyIntent } = require('../chatbot/intentClassifierService');
const { handleCollegePredictorMessage } = require('../chatbot/collegePredictorChatService');
const {
  buildWelcomeResponse,
  buildMenuResponse,
  isMenuCommand,
  isResetCommand,
  detectFlowStart,
  QUICK_REPLIES_DEFAULT,
} = require('./webChatMenu');
const { answerKnowledgeQuestion } = require('./webChatKnowledge');
const { handleRankPredictorTurn } = require('./webChatRankPredictor');
const { handleComparisonTurn } = require('./webChatComparison');

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

function mapCollegePredictorResult(result) {
  const nextFlow = result.clearState ? 'idle' : 'college_predictor';
  const payload = {
    reply: result.reply,
    context: result.context || {},
    flow: nextFlow,
    clearFlow: Boolean(result.clearState),
    quickReplies: nextFlow === 'idle' ? ['Predict rank', 'Compare colleges', 'Menu'] : ['Menu', 'Cancel'],
  };
  if (result.predictionIdempotency?.colleges?.length) {
    payload.toolResult = {
      type: 'college_predictor',
      data: {
        colleges: result.predictionIdempotency.colleges.slice(0, 8),
        exam: result.context?.exam || null,
      },
    };
  }
  return payload;
}

async function routeActiveFlow(session, message, identity) {
  if (session.flow === 'college_predictor') {
    const result = await handleCollegePredictorMessage(message, session.context || {}, {
      isNewEntry: false,
    });
    return mapCollegePredictorResult(result);
  }
  if (session.flow === 'rank_predictor') {
    return handleRankPredictorTurn(message, session.context || {}, { isNewEntry: false });
  }
  if (session.flow === 'college_comparison') {
    return handleComparisonTurn(message, session.context || {}, identity);
  }
  return null;
}

async function startFlow(flow, message, identity) {
  if (flow === 'college_predictor') {
    const result = await handleCollegePredictorMessage(message, {}, { isNewEntry: true });
    return mapCollegePredictorResult(result);
  }
  if (flow === 'rank_predictor') {
    return handleRankPredictorTurn(message, {}, { isNewEntry: true });
  }
  if (flow === 'college_comparison') {
    return handleComparisonTurn(message, {}, identity);
  }
  return buildMenuResponse();
}

async function routeIdleIntent(session, message) {
  const botState = { state: 'main_menu' };
  const intent = classifyIntent(message, botState, 'guidexpert', message)?.intent || 'unknown';
  const flowStart = detectFlowStart(message);

  if (flowStart) {
    return startFlow(flowStart, message, {
      phone: session.phone,
      fullName: session.fullName,
    });
  }

  if (intent === 'college_predictor') {
    return startFlow('college_predictor', message, {
      phone: session.phone,
      fullName: session.fullName,
    });
  }
  if (intent === 'rank_predictor') {
    return startFlow('rank_predictor', message, {
      phone: session.phone,
      fullName: session.fullName,
    });
  }

  const kb = await answerKnowledgeQuestion(message);
  if (kb) {
    return {
      reply: kb.reply,
      flow: 'idle',
      context: {},
      usedLlm: Boolean(kb.usedLlm),
      source: kb.source,
      quickReplies: QUICK_REPLIES_DEFAULT,
    };
  }

  return {
    reply:
      'I can predict colleges, predict rank, compare colleges, or answer GuideXpert questions. Say "menu" to see options.',
    flow: 'idle',
    context: {},
    quickReplies: QUICK_REPLIES_DEFAULT,
  };
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

  if (isResetCommand(text)) {
    session.flow = 'idle';
    session.context = {};
    session.messageCount = (session.messageCount || 0) + 1;
    session.lastMessageAt = new Date();
    await session.save?.();
    return formatResponse(session.sessionId, buildMenuResponse({ cleared: true }));
  }

  if (isMenuCommand(text) && session.flow === 'idle') {
    session.messageCount = (session.messageCount || 0) + 1;
    session.lastMessageAt = new Date();
    await session.save?.();
    return formatResponse(session.sessionId, buildMenuResponse());
  }

  let outcome =
    (await routeActiveFlow(session, text, { phone: session.phone, fullName: session.fullName })) ||
    (await routeIdleIntent(session, text));

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

  return formatResponse(session.sessionId, outcome);
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
