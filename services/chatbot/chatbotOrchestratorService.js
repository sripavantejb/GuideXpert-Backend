const WhatsAppConversation = require('../../models/WhatsAppConversation');
const { classifyIntent } = require('./intentClassifierService');
const botStateService = require('./botStateService');
const leadContextService = require('./leadContextService');
const { retrieveFacts } = require('./knowledgeRetrievalService');
const { searchStaticFaq, searchBlog, formatFaqAnswerAsync } = require('./faqService');
const { buildCounsellingSupportReply } = require('./counsellingSupportService');
const { buildDemoSupportReply } = require('./demoSupportService');
const { handleRankPredictorMessage, listExamsMessage } = require('./rankPredictorChatService');
const { handleCollegePredictorMessage } = require('./collegePredictorChatService');
const handoffService = require('./handoffService');
const whatsappOutbound = require('./whatsappOutboundService');
const { tryLlmReply } = require('./llmReplyService');
const { answerWithTimeout } = require('./knowledgeAssistantService');
const { buildWelcomeMenuText } = require('./welcomeMessageService');
const { emptySubflows } = require('./botSubflowContext');
const { maskPhoneTail } = require('../../utils/chatbotPhone');
const { logChatbotEvent, extractPredictorExam } = require('./chatbotStructuredLog');
const {
  isMultilingualEnabled,
  prepareMultilingualInbound,
  finalizeMultilingualOutbound,
} = require('../../middleware/multilingualMiddleware');
const { seedPreferredLanguageFromLead } = require('./conversationLanguageService');
const { incrementLanguageRequest } = require('../analytics/languageRequestAnalyticsService');
const { localizeKnownFallback } = require('../../constants/localizedFallbackStrings');
const { resolveGreetingReply } = require('../../constants/greetingReplies');
const { formatForWhatsApp } = require('../../utils/whatsappMessageFormatter');

function previewLogText(text, max = 200) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

const ORCHESTRATOR_FALLBACK_REPLY =
  'Sorry, something went wrong on our side. Please try again in a moment or reply MENU for options.';

const HANDOFF_WAIT_REPLY =
  'Our counsellor team is handling your chat. Please wait for their reply here.\n\nReply MENU to return to the assistant.';

const KNOWLEDGE_ASSISTANT_FALLBACK_REPLY =
  'I am not sure I understood. Reply MENU for options or AGENT to speak with our team.';

const COLLEGE_PREDICTOR_MAINTENANCE_REPLY = [
  'College predictions are temporarily unavailable (service is under maintenance).',
  '',
  'Please try again later.',
  '',
  'Reply MENU for other options.',
].join('\n');

/** Set CHATBOT_COLLEGE_PREDICTOR_ENABLED=1 to turn the WhatsApp college predictor back on. */
function isCollegePredictorEnabled() {
  return String(process.env.CHATBOT_COLLEGE_PREDICTOR_ENABLED || '').trim() === '1';
}

function outboundSucceeded(result) {
  return Boolean(result && result.success);
}

function summarizeProcessResult(result) {
  if (!result) {
    return { outboundSuccess: false, delivered: false };
  }
  if (result.skipped) {
    return {
      outboundSuccess: outboundSucceeded(result),
      delivered: outboundSucceeded(result),
      skipped: true,
      reason: result.reason || null,
    };
  }
  if (result.handoff) {
    return { outboundSuccess: true, delivered: true, handoff: true };
  }
  const success = outboundSucceeded(result);
  return { outboundSuccess: success, delivered: success, error: result.error || null };
}

const defaultHooks = {
  buildLeadContext: (links) => leadContextService.buildLeadContext(links),
  retrieveFacts: (links, ctx) => retrieveFacts(links, ctx),
  getBotState: (id) => botStateService.getBotState(id),
  transitionState: (...args) => botStateService.transitionState(...args),
  isBotPausedForConversation: (c) => handoffService.isBotPausedForConversation(c),
  createHandoff: (args) => handoffService.createHandoff(args),
  cancelActiveHandoffForUser: (conversation) =>
    handoffService.cancelActiveHandoffForUser(conversation),
  updateConversationIntent: (id, intent) =>
    WhatsAppConversation.updateOne({ _id: id }, { $set: { lastIntent: intent, updatedAt: new Date() } }),
  outbound: whatsappOutbound,
};

let testHooks = null;

function setChatbotOrchestratorTestHooks(hooks) {
  testHooks = hooks || null;
}

function hooks() {
  return testHooks || defaultHooks;
}

function buildMainMenuText(leadContext) {
  return buildWelcomeMenuText(leadContext);
}

function buildMainMenuButtons(leadContext) {
  const line = leadContext?.productLine || 'unknown';
  if (line === 'iit_counselling') {
    return [
      { id: 'menu_1', title: 'My Details' },
      { id: 'menu_4', title: 'Rank Predictor' },
      { id: 'menu_agent', title: 'Talk to Counsellor' },
    ];
  }
  if (line === 'guidexpert') {
    return [
      { id: 'menu_2', title: 'Program Overview' },
      { id: 'menu_faq', title: 'Fees & Enrollment' },
      { id: 'menu_agent', title: 'Talk to Team' },
    ];
  }
  return [
    { id: 'menu_1', title: 'IIT Counselling' },
    { id: 'menu_3', title: 'Rank Predictor' },
    { id: 'menu_agent', title: 'Talk to Expert' },
  ];
}

function buildMainMenuListSections() {
  return [
    {
      title: 'IIT Counselling',
      rows: [
        { id: 'menu_1', title: 'My Details', description: 'Counselling profile' },
        { id: 'menu_2', title: 'Meeting Link', description: 'Session link & time' },
        { id: 'menu_3', title: 'Assigned Expert', description: 'Your counsellor' },
        { id: 'menu_4', title: 'Rank Predictor', description: 'Estimate rank' },
        { id: 'menu_5', title: 'College Predictor', description: 'College matches' },
        { id: 'menu_6', title: 'Talk to Counsellor', description: 'Human handoff' },
      ],
    },
  ];
}

function mapMenuIdToIntent(menuId, productLine = 'unknown') {
  const id = String(menuId || '');
  const line = productLine || 'unknown';

  if (line === 'iit_counselling') {
    if (id === 'menu_1') return 'lead_lookup';
    if (id === 'menu_2') return 'counselling_support';
    if (id === 'menu_3') return 'assigned_expert';
    if (id === 'menu_4') return 'rank_predictor';
    if (id === 'menu_5') return 'college_predictor';
    if (id === 'menu_6' || id === 'menu_agent') return 'human_handoff';
    return 'main_menu';
  }

  if (line === 'guidexpert') {
    if (id === 'menu_1' || id === 'menu_2' || id === 'menu_faq') return 'faq';
    if (id === 'menu_agent' || id === 'menu_5') return 'human_handoff';
    return 'main_menu';
  }

  if (id === 'menu_1') return 'counselling_support';
  if (id === 'menu_3') return 'rank_predictor';
  if (id === 'menu_agent' || id === 'menu_5') return 'human_handoff';
  return 'main_menu';
}

async function sendMainMenu(conversation, leadContext, inReplyToInboundId) {
  const h = hooks();
  const body = buildMainMenuText(leadContext);
  logChatbotEvent('main_menu_sent', {
    conversationId: conversation._id,
    phone10: conversation.phone,
    productLine: leadContext?.productLine || conversation.productLine || null,
    textLength: String(body || '').length,
  });
  return h.outbound.sendBotTextReply({
    conversationId: conversation._id,
    phone10: conversation.phone,
    text: body,
    inReplyToInboundId,
  });
}

async function buildLeadLookupReply(leadContext) {
  const lines = [];
  if (leadContext.hasIit && leadContext.iit) {
    lines.push('📋 IIT Counselling profile:');
    lines.push(`Name: ${leadContext.iit.fullName || '—'}`);
    lines.push(`Slot: ${leadContext.iit.slotBooking || '—'}`);
    lines.push(`When: ${leadContext.iit.slotInstantLabel || '—'}`);
    lines.push(`Language: ${leadContext.iit.preferredLanguage || '—'}`);
  }
  if (leadContext.hasGx && leadContext.gx) {
    lines.push('\n📋 GuideXpert demo:');
    lines.push(`Name: ${leadContext.gx.fullName || '—'}`);
    lines.push(
      `Slot: ${[leadContext.gx.slotDateLabel, leadContext.gx.slotTimeLabel].filter(Boolean).join(' at ') || '—'}`
    );
    lines.push(`Meeting link: ${leadContext.meetingLink}`);
  }
  if (!leadContext.hasIit && !leadContext.hasGx) {
    lines.push('No registration found for this number yet.');
    lines.push(`Register: ${leadContext.iitPageUrl || leadContext.meetingLink}`);
  }
  lines.push('\nReply MENU for options.');
  return lines.join('\n');
}

function resolveInteractiveMenuId(inbound) {
  const payload = inbound.interactivePayload || {};
  return payload.id || (payload.reply && payload.reply.id) || null;
}

function logInboundResult({
  event,
  conversation,
  botState,
  intent,
  contextPatch,
  durationMs,
  upstreamStatus = null,
  errMessage = null,
  multilingual = null,
}) {
  logChatbotEvent(event, {
    conversationId: conversation._id,
    phone10: conversation.phone,
    intent,
    botState: botState?.state || null,
    productLine: conversation.productLine || null,
    predictorExam: extractPredictorExam(contextPatch),
    upstreamStatus,
    durationMs,
    errMessage,
    ...(multilingual || {}),
  });
}

/**
 * Process one inbound message and send reply(ies).
 */
async function processInbound({ conversation, inbound, leadLinks }) {
  const startedAt = Date.now();
  const h = hooks();
  try {
    const result = await processInboundCore({ conversation, inbound, leadLinks, startedAt });
    return { ...result, ...summarizeProcessResult(result) };
  } catch (err) {
    logInboundResult({
      event: 'inbound_failed',
      conversation,
      botState: null,
      intent: null,
      contextPatch: {},
      durationMs: Date.now() - startedAt,
      errMessage: err.message,
    });
    console.error('[chatbot] processInbound failed', {
      phone_tail: maskPhoneTail(conversation.phone),
      conversation_id: String(conversation._id),
      err_message: err.message,
    });
    try {
      const result = await h.outbound.sendBotTextReply({
        conversationId: conversation._id,
        phone10: conversation.phone,
        text: ORCHESTRATOR_FALLBACK_REPLY,
        inReplyToInboundId: inbound._id,
      });
      return { ...result, ...summarizeProcessResult(result) };
    } catch (sendErr) {
      console.error('[chatbot] fallback reply failed', sendErr.message);
      throw err;
    }
  }
}

async function processInboundCore({ conversation, inbound, leadLinks, startedAt }) {
  const h = hooks();
  let activeConversation = conversation;
  const paused = await h.isBotPausedForConversation(activeConversation);
  if (paused) {
    const menuIntent = classifyIntent(
      inbound.text,
      null,
      activeConversation.productLine
    );
    if (menuIntent.intent === 'main_menu') {
      await h.cancelActiveHandoffForUser(activeConversation);
      activeConversation =
        (await WhatsAppConversation.findById(activeConversation._id).lean()) ||
        activeConversation;
    } else {
      const result = await h.outbound.sendBotTextReply({
        conversationId: activeConversation._id,
        phone10: activeConversation.phone,
        text: HANDOFF_WAIT_REPLY,
        inReplyToInboundId: inbound._id,
      });
      logInboundResult({
        event: 'inbound_skipped',
        conversation: activeConversation,
        botState: null,
        intent: null,
        contextPatch: {},
        durationMs: Date.now() - startedAt,
      });
      return { ...result, skipped: true, reason: 'handoff_active' };
    }
  }

  const leadContext = await h.buildLeadContext(leadLinks);
  await seedPreferredLanguageFromLead(activeConversation._id, leadContext);
  const facts = await h.retrieveFacts(leadLinks, leadContext);
  const botState = await h.getBotState(activeConversation._id);

  let multilingualInbound = null;
  if (isMultilingualEnabled() && inbound.text) {
    try {
      multilingualInbound = await prepareMultilingualInbound({
        message: inbound.text,
        conversation: activeConversation,
        leadContext,
      });
      if (multilingualInbound.resolvedLanguage && multilingualInbound.resolvedLanguage !== 'en') {
        incrementLanguageRequest({
          language: multilingualInbound.resolvedLanguage,
          translated: multilingualInbound.translationApplied,
        }).catch(() => {});
      }
    } catch (err) {
      console.warn('[chatbot] prepareMultilingualInbound failed', err.message);
    }
  }

  const intentText =
    multilingualInbound?.englishMessage ||
    String(inbound.text || '').trim();

  let intentResult;
  if (
    (inbound.messageType === 'button_reply' || inbound.messageType === 'list_reply') &&
    inbound.interactivePayload
  ) {
    intentResult = {
      intent: mapMenuIdToIntent(resolveInteractiveMenuId(inbound), activeConversation.productLine),
      confidence: 'high',
    };
  } else {
    intentResult = classifyIntent(intentText, botState, activeConversation.productLine);
  }

  await h.updateConversationIntent(activeConversation._id, intentResult.intent);

  if (intentResult.intent === 'opt_out') {
    await h.transitionState(activeConversation._id, activeConversation.phone, 'idle', {
      optedOut: true,
      knowledgeAssistantActive: false,
    });
    const result = await h.outbound.sendBotTextReply({
      conversationId: activeConversation._id,
      phone10: activeConversation.phone,
      text: 'You have been opted out of automated messages. Reply MENU anytime to start again.',
      inReplyToInboundId: inbound._id,
    });
    logInboundResult({
      event: 'inbound_processed',
      conversation: activeConversation,
      botState,
      intent: intentResult.intent,
      contextPatch: { optedOut: true },
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  if (intentResult.intent === 'human_handoff') {
    await h.createHandoff({
      conversation: activeConversation,
      leadContext,
      reason: 'user_requested',
      userLastMessage: inbound.text,
    });
    logInboundResult({
      event: 'inbound_processed',
      conversation: activeConversation,
      botState,
      intent: intentResult.intent,
      contextPatch: emptySubflows(),
      durationMs: Date.now() - startedAt,
    });
    return { handoff: true };
  }

  if (intentResult.intent === 'main_menu') {
    await h.transitionState(activeConversation._id, activeConversation.phone, 'main_menu', emptySubflows());
    const result = await sendMainMenu(activeConversation, leadContext, inbound._id);
    logInboundResult({
      event: 'inbound_processed',
      conversation: activeConversation,
      botState,
      intent: intentResult.intent,
      contextPatch: emptySubflows(),
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  let replyText = null;
  let nextState = botState?.state || 'main_menu';
  let contextPatch = botState?.context || {};
  let upstreamStatus = null;
  let knowledgeAssistantResult = null;
  let unknownLlmResult = null;
  let unknownLlmUsed = false;

  switch (intentResult.intent) {
    case 'lead_lookup':
      replyText = await buildLeadLookupReply({ ...leadContext, links: facts.links });
      nextState = 'lead_lookup';
      break;
    case 'assigned_expert':
      replyText = leadContextService.buildAssignedExpertReply(leadContext);
      nextState = 'assigned_expert';
      break;
    case 'faq':
    case 'faq_query':
      await h.transitionState(activeConversation._id, activeConversation.phone, 'faq', contextPatch);
      replyText = 'Send a topic (e.g. "meeting link", "IIT session", "book demo") and I will search our FAQs.';
      if (intentResult.intent === 'faq_query' && inbound.text) {
        const staticHits = searchStaticFaq(inbound.text);
        const blogHits = await searchBlog(inbound.text);
        replyText = await formatFaqAnswerAsync(staticHits, blogHits, inbound.text);
        nextState = 'faq_answer';
      }
      break;
    case 'counselling_support':
      replyText = await buildCounsellingSupportReply(leadContext);
      nextState = 'counselling_support';
      break;
    case 'demo_support':
      replyText = await buildDemoSupportReply(leadContext);
      nextState = 'demo_support';
      break;
    case 'rank_predictor':
    case 'rank_predictor_continue': {
      await h.transitionState(activeConversation._id, activeConversation.phone, 'rank_predictor', contextPatch);
      const rankInboundText = multilingualInbound?.englishMessage || inbound.text;
      const r = handleRankPredictorMessage(rankInboundText, contextPatch.rank || {});
      replyText = r.reply;
      contextPatch = { ...contextPatch, rank: r.context, knowledgeAssistantActive: false };
      nextState = 'rank_predictor';
      if (contextPatch.rank?.step === 'done') {
        nextState = 'main_menu';
      }
      break;
    }
    case 'college_predictor':
    case 'college_predictor_continue': {
      if (!isCollegePredictorEnabled()) {
        replyText = COLLEGE_PREDICTOR_MAINTENANCE_REPLY;
        contextPatch = emptySubflows();
        nextState = 'main_menu';
        break;
      }
      const isNewEntry = intentResult.intent === 'college_predictor';
      await h.transitionState(
        activeConversation._id,
        activeConversation.phone,
        'college_predictor',
        contextPatch
      );
      const c = await handleCollegePredictorMessage(
        inbound.text,
        contextPatch.college || {},
        { isNewEntry }
      );
      replyText = c.reply;
      if (c.clearState) {
        contextPatch = { college: {} };
        nextState = 'main_menu';
      } else {
        contextPatch = { college: c.context };
        nextState = 'college_predictor';
      }
      break;
    }
    case 'greeting': {
      replyText = resolveGreetingReply(
        multilingualInbound?.language || multilingualInbound?.resolvedLanguage || 'en'
      );
      nextState = 'idle';
      contextPatch = { ...contextPatch, knowledgeAssistantActive: false };
      break;
    }
    case 'knowledge_assistant': {
      const assistantInboundText = multilingualInbound?.englishMessage || inbound.text;
      knowledgeAssistantResult = await answerWithTimeout({
        inboundText: assistantInboundText,
        conversationId: activeConversation._id,
        leadContext,
        languageMetadata: multilingualInbound
          ? {
              originalMessage: multilingualInbound.originalMessage,
              detectedLanguage: multilingualInbound.detectedLanguage,
              resolvedLanguage: multilingualInbound.resolvedLanguage,
              translatedQuery: assistantInboundText,
              translationApplied: multilingualInbound.translationApplied,
            }
          : null,
      });
      if (knowledgeAssistantResult?.text) {
        replyText = knowledgeAssistantResult.text;
      } else {
        console.warn('[chatbot] knowledge_assistant_fallback using orchestrator reply');
        replyText = KNOWLEDGE_ASSISTANT_FALLBACK_REPLY;
      }
      nextState = 'idle';
      break;
    }
    default: {
      const assistantInboundText = multilingualInbound?.englishMessage || inbound.text;
      const languageMetadata = multilingualInbound
        ? {
            originalMessage: multilingualInbound.originalMessage,
            detectedLanguage: multilingualInbound.detectedLanguage,
            resolvedLanguage: multilingualInbound.resolvedLanguage,
            translatedQuery: assistantInboundText,
            translationApplied: multilingualInbound.translationApplied,
          }
        : null;
      if (
        String(process.env.CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED || '').trim() === '1' ||
        String(process.env.CHATBOT_LLM_ENABLED || '').trim() === '1'
      ) {
        const llm = await tryLlmReply({
          inboundText: assistantInboundText,
          conversationId: activeConversation._id,
          facts,
          leadContext,
          languageMetadata,
        });
        if (llm && llm.text) {
          replyText = llm.text;
          unknownLlmUsed = true;
          unknownLlmResult = llm;
          break;
        }
      }
      if (intentResult.confidence === 'low') {
        replyText = KNOWLEDGE_ASSISTANT_FALLBACK_REPLY;
      } else {
        replyText = await buildLeadLookupReply(leadContext);
      }
      nextState = 'idle';
    }
  }

  if (intentResult.intent === 'knowledge_assistant') {
    contextPatch = {
      ...contextPatch,
      knowledgeAssistantActive: Boolean(
        knowledgeAssistantResult?.model && knowledgeAssistantResult?.text
      ),
    };
  } else {
    contextPatch = { ...contextPatch, knowledgeAssistantActive: false };
  }

  await h.transitionState(activeConversation._id, activeConversation.phone, nextState, contextPatch);

  if (!replyText) {
    replyText = listExamsMessage();
  }

  const assistantResult = knowledgeAssistantResult || unknownLlmResult;
  const knowledgeAssistantResponse =
    assistantResult?.languageLog?.englishResponse ||
    (assistantResult?.text ? String(assistantResult.text) : null);

  let outboundTrace = {
    shouldTranslateOutbound: false,
    outboundTranslationExecuted: false,
    translateFromEnglishExecuted: false,
    outboundTranslationLanguage: multilingualInbound?.language || null,
    outboundTranslationPassThrough: false,
    knowledgeAssistantResponse,
  };

  if (multilingualInbound && replyText) {
    replyText = formatForWhatsApp(replyText);

    const shouldTranslateOutbound =
      multilingualInbound.language !== 'en' &&
      (intentResult.intent === 'knowledge_assistant' ||
        intentResult.intent === 'rank_predictor' ||
        intentResult.intent === 'rank_predictor_continue' ||
        (intentResult.intent === 'unknown' && unknownLlmUsed));

    outboundTrace.shouldTranslateOutbound = shouldTranslateOutbound;
    outboundTrace.outboundTranslationLanguage = multilingualInbound.language;

    if (shouldTranslateOutbound) {
      try {
        replyText = await finalizeMultilingualOutbound({
          englishResponse: replyText,
          language: multilingualInbound.language,
          originalMessage: multilingualInbound.originalMessage,
          guardrailModified: Boolean(assistantResult?.guardrailModified),
          outboundTrace,
        });
      } catch (err) {
        console.warn('[chatbot] finalizeMultilingualOutbound failed', err.message);
      }
      replyText = formatForWhatsApp(replyText);
      if (knowledgeAssistantResult?.languageLog) {
        knowledgeAssistantResult.languageLog.finalResponse = replyText;
      }
      if (unknownLlmResult?.languageLog) {
        unknownLlmResult.languageLog.finalResponse = replyText;
      }
    } else if (intentResult.intent !== 'greeting') {
      const localized = localizeKnownFallback(replyText, multilingualInbound.language);
      if (localized !== replyText) {
        replyText = localized;
      }
    }
  } else if (replyText) {
    replyText = formatForWhatsApp(replyText);
  }

  const result = await h.outbound.sendBotTextReply({
    conversationId: activeConversation._id,
    phone10: activeConversation.phone,
    text: replyText,
    inReplyToInboundId: inbound._id,
  });

  logInboundResult({
    event: 'inbound_processed',
    conversation: activeConversation,
    botState,
    intent: intentResult.intent,
    contextPatch,
    durationMs: Date.now() - startedAt,
    upstreamStatus,
    multilingual: multilingualInbound
      ? {
          originalMessage: multilingualInbound.originalMessage,
          detectedLanguage: multilingualInbound.detectedLanguage,
          resolvedLanguage: multilingualInbound.resolvedLanguage,
          detectionSource: multilingualInbound.detectionSource,
          englishMessage: multilingualInbound.englishMessage,
          translatedQuery: multilingualInbound.englishMessage,
          translationApplied: multilingualInbound.translationApplied,
          outboundLanguage: multilingualInbound.language,
          knowledgeAssistantResponse: outboundTrace.knowledgeAssistantResponse,
          shouldTranslateOutbound: outboundTrace.shouldTranslateOutbound,
          outboundTranslationExecuted: outboundTrace.outboundTranslationExecuted,
          translateFromEnglishExecuted: outboundTrace.translateFromEnglishExecuted,
          outboundTranslationLanguage: outboundTrace.outboundTranslationLanguage,
          outboundTranslationPassThrough: outboundTrace.outboundTranslationPassThrough,
          translatedResponsePreview: outboundTrace.translatedResponsePreview || null,
          finalResponsePreview: previewLogText(replyText),
          retrievedChunks: assistantResult?.languageLog?.resultIds || [],
          guardrailDecision: assistantResult
            ? {
                modified: Boolean(assistantResult.guardrailModified),
                reason: assistantResult.guardrailReason || null,
              }
            : null,
          guardrailModified: Boolean(assistantResult?.guardrailModified),
          finalResponse: replyText,
        }
      : null,
  });

  return result;
}

module.exports = {
  processInbound,
  sendMainMenu,
  buildMainMenuText,
  buildMainMenuButtons,
  buildMainMenuListSections,
  mapMenuIdToIntent,
  setChatbotOrchestratorTestHooks,
};
