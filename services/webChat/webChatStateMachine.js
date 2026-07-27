'use strict';

/**
 * Central conversation state machine for website chat.
 * Runs intent detection before every turn and lets high-priority intents
 * override slot-filling (e.g. waiting for a college name).
 */

const { classifyIntent } = require('../chatbot/intentClassifierService');
const { handleCollegePredictorMessage } = require('../chatbot/collegePredictorChatService');
const {
  buildWelcomeResponse,
  buildMenuResponse,
  QUICK_REPLIES_DEFAULT,
} = require('./webChatMenu');
const { answerKnowledgeQuestion } = require('./webChatKnowledge');
const { handleRankPredictorTurn } = require('./webChatRankPredictor');
const { handleComparisonTurn, initialComparisonContext } = require('./webChatComparison');
const {
  INTENT,
  detectIntent,
  isHighPriorityIntent,
  looksLikeCollegeName,
  normalizeText,
} = require('./webChatIntent');

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

function isAwaitingCollegeName(session) {
  if (session.flow !== 'college_comparison') return false;
  const step = session.context?.step;
  return step === 'collegeA' || step === 'collegeB';
}

function continuePrompt(session) {
  const step = session.context?.step;
  const a = session.context?.collegeAName || '';
  if (step === 'collegeB' && a) {
    return `We're still comparing colleges. First college is ${a}. Send the second college name, or say "cancel" / "menu".`;
  }
  return `We're still comparing colleges. Send a college name (or "VIT vs SRM"), or say "cancel" / "menu".`;
}

async function startFlow(flow, message, identity, opts = {}) {
  if (flow === 'college_predictor') {
    const result = await handleCollegePredictorMessage(message, {}, { isNewEntry: true });
    return mapCollegePredictorResult(result);
  }
  if (flow === 'rank_predictor') {
    return handleRankPredictorTurn(message, {}, { isNewEntry: true });
  }
  if (flow === 'college_comparison') {
    return handleComparisonTurn(message, {}, identity, {
      isNewEntry: true,
      ...opts,
    });
  }
  return buildMenuResponse();
}

async function continueActiveFlow(session, message, identity) {
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
    return handleComparisonTurn(message, session.context || {}, identity, { isNewEntry: false });
  }
  return null;
}

async function handleFaqOrKnowledge(message) {
  const kb = await answerKnowledgeQuestion(message);
  if (!kb) return null;
  return {
    reply: kb.reply,
    flow: 'idle',
    context: {},
    clearFlow: true,
    usedLlm: Boolean(kb.usedLlm),
    source: kb.source,
    quickReplies: QUICK_REPLIES_DEFAULT,
  };
}

async function handleHighPriorityIntent(intent, session, identity) {
  const text = intent.text;

  if (intent.type === INTENT.CANCEL || intent.type === INTENT.RESTART) {
    return buildMenuResponse({
      cleared: true,
      reply:
        intent.type === INTENT.RESTART
          ? 'Restarted. What would you like to do next?'
          : 'Cancelled. What would you like to do next?\n\n' +
            '• Predict colleges\n• Predict rank\n• Compare colleges\n• Ask a GuideXpert question',
    });
  }

  if (intent.type === INTENT.MENU || intent.type === INTENT.HELP) {
    return intent.type === INTENT.HELP
      ? {
          ...buildMenuResponse({ cleared: true }),
          reply:
            'I can help with college prediction, rank prediction, college comparison, and GuideXpert FAQs.\n\nSay "Predict colleges", "Predict rank", "Compare colleges", or ask a question. Type "menu" anytime.',
        }
      : buildMenuResponse({ cleared: true });
  }

  if (intent.type === INTENT.GUIDEXPERT_FAQ) {
    const faq = await handleFaqOrKnowledge(text);
    if (faq) return faq;
    return {
      reply:
        'GuideXpert helps with exam counselling, college shortlisting, rank prediction, branch guidance, and mentor support. Say "menu" to pick a tool.',
      flow: 'idle',
      context: {},
      clearFlow: true,
      quickReplies: QUICK_REPLIES_DEFAULT,
    };
  }

  if (intent.type === INTENT.PREDICT_COLLEGES) {
    return startFlow('college_predictor', text, identity);
  }
  if (intent.type === INTENT.PREDICT_RANK) {
    return startFlow('rank_predictor', text, identity);
  }
  if (intent.type === INTENT.COMPARE_COLLEGES) {
    // Entry phrase must NOT become college A
    return startFlow('college_comparison', '', identity, { isNewEntry: true });
  }
  if (intent.type === INTENT.COLLEGE_PAIR) {
    return startFlow('college_comparison', text, identity, {
      isNewEntry: true,
      pair: intent.meta?.pair || null,
    });
  }

  return null;
}

async function handleIdleTurn(session, message, intent) {
  if (intent.type === INTENT.COLLEGE_PAIR) {
    return startFlow('college_comparison', message, {
      phone: session.phone,
      fullName: session.fullName,
    }, { isNewEntry: true, pair: intent.meta?.pair || null });
  }

  // Legacy classifier as a soft assist for predictor phrasing
  const botState = { state: 'main_menu' };
  const classified = classifyIntent(message, botState, 'guidexpert', message)?.intent || 'unknown';
  if (classified === 'college_predictor') {
    return startFlow('college_predictor', message, {
      phone: session.phone,
      fullName: session.fullName,
    });
  }
  if (classified === 'rank_predictor') {
    return startFlow('rank_predictor', message, {
      phone: session.phone,
      fullName: session.fullName,
    });
  }

  const kb = await handleFaqOrKnowledge(message);
  if (kb) return kb;

  if (intent.type === INTENT.GENERAL_QUESTION) {
    return {
      reply:
        'I might not have that exact answer yet. I can predict colleges, predict rank, compare colleges, or answer GuideXpert FAQs. Say "menu" for options.',
      flow: 'idle',
      context: {},
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

async function handleAwaitingCollegeSidePath(session, message, intent, identity) {
  // Soft interrupt: answer a question but keep comparison context if we can
  if (intent.type === INTENT.GENERAL_QUESTION || intent.type === INTENT.UNKNOWN) {
    const kb = await answerKnowledgeQuestion(message);
    if (kb) {
      return {
        reply: `${kb.reply}\n\n${continuePrompt(session)}`,
        flow: 'college_comparison',
        context: session.context || initialComparisonContext(),
        usedLlm: Boolean(kb.usedLlm),
        source: kb.source,
        quickReplies: ['Cancel', 'Menu', session.context?.collegeAName ? 'Send second college' : 'Send college name'],
      };
    }
  }

  return {
    reply: `That doesn't look like a college name.\n\n${continuePrompt(session)}`,
    flow: 'college_comparison',
    context: session.context || initialComparisonContext(),
    quickReplies: ['Cancel', 'Menu', 'IIIT Hyderabad vs NIT Trichy'],
  };
}

/**
 * Main state-machine entry for one user turn.
 * @returns {Promise<object>} outcome { reply, flow, context, clearFlow?, ... }
 */
async function processConversationTurn({ session, message, identity }) {
  const text = normalizeText(message);
  const awaitingCollege = isAwaitingCollegeName(session);
  const intent = detectIntent(text, { awaitingCollege });

  // 1) High-priority intents always override active state
  if (isHighPriorityIntent(intent.type) || intent.type === INTENT.COLLEGE_PAIR) {
    // COLLEGE_PAIR is allowed as override / starter even mid-flow
    if (isHighPriorityIntent(intent.type) || session.flow !== 'college_comparison') {
      const handled = await handleHighPriorityIntent(intent, session, identity);
      if (handled) return handled;
    }
    if (intent.type === INTENT.COLLEGE_PAIR) {
      return handleComparisonTurn(text, {}, identity, {
        isNewEntry: true,
        pair: intent.meta?.pair || null,
      });
    }
  }

  // 2) Active comparison waiting for a college name
  if (awaitingCollege) {
    if (intent.type === INTENT.COLLEGE_NAME && looksLikeCollegeName(text)) {
      return handleComparisonTurn(text, session.context || {}, identity, { isNewEntry: false });
    }
    if (intent.type === INTENT.COLLEGE_PAIR) {
      return handleComparisonTurn(text, {}, identity, {
        isNewEntry: true,
        pair: intent.meta?.pair || null,
      });
    }
    return handleAwaitingCollegeSidePath(session, text, intent, identity);
  }

  // 3) Other active flows — only continue if message is not a hijack
  if (session.flow && session.flow !== 'idle') {
    // Mid rank/college predictor: still allow high priority (already handled).
    // Continue workflow for everything else.
    const continued = await continueActiveFlow(session, text, identity);
    if (continued) return continued;
  }

  // 4) Idle routing
  return handleIdleTurn(session, text, intent);
}

module.exports = {
  processConversationTurn,
  startFlow,
  mapCollegePredictorResult,
  isAwaitingCollegeName,
  buildWelcomeResponse,
};
