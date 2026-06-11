const WhatsAppConversation = require('../../models/WhatsAppConversation');
const { classifyIntent } = require('./intentClassifierService');
const botStateService = require('./botStateService');
const leadContextService = require('./leadContextService');
const { retrieveFacts } = require('./knowledgeRetrievalService');
const { searchStaticFaq, searchBlog, formatFaqAnswerAsync } = require('./faqService');
const { buildDemoSupportReply } = require('./demoSupportService');
const { handleRankPredictorMessage, listExamsMessage } = require('./rankPredictorChatService');
const { handleCollegePredictorMessage } = require('./collegePredictorChatService');
const handoffService = require('./handoffService');
const whatsappOutbound = require('./whatsappOutboundService');
const { tryLlmReply } = require('./llmReplyService');
const { answerWithTimeout } = require('./knowledgeAssistantService');
const {
  answerWithTimeout: answerCounsellorProgramWithTimeout,
} = require('./counsellorProgram/counsellorProgramAssistantService');
const { isCounsellorProgramAssistantEnabled } = require('./counsellorProgram/counsellorProgramFlags');
const {
  CPA_EMPTY_FALLBACK: COUNSELLOR_PROGRAM_FALLBACK,
} = require('./counsellorProgram/counsellorProgramGuardrailService');
const { buildWelcomeMenuText } = require('./welcomeMessageService');
const { getDemoMeetingLink } = require('../../utils/slotNotificationFormatters');
const { emptySubflows } = require('./botSubflowContext');
const { maskPhoneTail } = require('../../utils/chatbotPhone');
const { logChatbotEvent, extractPredictorExam } = require('./chatbotStructuredLog');
const {
  isMultilingualEnabled,
  prepareMultilingualInbound,
  applyMultilingualOutbound,
} = require('../../middleware/multilingualMiddleware');
const {
  seedPreferredLanguageFromLead,
  resolveSessionAwareLanguage,
  updatePreferredLanguage,
} = require('./conversationLanguageService');
const { incrementLanguageRequest } = require('../analytics/languageRequestAnalyticsService');
const { resolveGreetingReply } = require('../../constants/greetingReplies');
const { buildLocalizedWelcomeMenu } = require('../../constants/localizedMenuReplies');
const { buildLocalizedCounsellingSupportReply } = require('../../constants/localizedCounsellingReplies');
const {
  resolveSystemReply,
  resolveKnowledgeAssistantFallback,
} = require('../../constants/localizedSystemReplies');
const {
  resolveCollegePredictorMaintenanceReply,
  resolveCollegePredictorRankQueryUnavailableReply,
} = require('../../constants/collegePredictorUnavailableReplies');
const { isRankBranchCollegePredictorQuery, normalizeText } = require('./intentClassifierService');

function resolvedLanguageFrom(multilingualInbound, fallback = 'en') {
  return multilingualInbound?.resolvedLanguage || multilingualInbound?.language || fallback;
}

function localizationTierForIntent(intent) {
  switch (intent) {
    case 'greeting':
    case 'main_menu':
    case 'counselling_support':
    case 'college_predictor':
    case 'faq':
      return 'static';
    default:
      return 'translate';
  }
}

async function deliverOutboundReply({
  replyText,
  multilingualInbound,
  intent,
  localizationTier,
  preLocalized = false,
  guardrailModified = false,
  outboundTrace = {},
}) {
  const inbound = multilingualInbound || { resolvedLanguage: 'en', language: 'en', originalMessage: '' };
  const result = await applyMultilingualOutbound({
    replyText,
    resolvedLanguage: resolvedLanguageFrom(inbound),
    originalMessage: inbound.originalMessage || '',
    outboundTrace,
    localizationTier: localizationTier || localizationTierForIntent(intent),
    preLocalized,
    guardrailModified,
  });

  if (
    result.verification?.pass === false &&
    Number(inbound.confidence || 0) >= 0.75 &&
    resolvedLanguageFrom(inbound) !== 'en'
  ) {
    logChatbotEvent('language_mismatch', {
      conversationId: inbound.conversationId || null,
      intent,
      resolvedLanguage: resolvedLanguageFrom(inbound),
      verifiedResponseLanguage: result.verification?.detected || null,
      reason: result.verification?.reason || null,
    });
  }

  return result.text;
}

function previewLogText(text, max = 200) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

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

async function sendMainMenu(conversation, leadContext, inReplyToInboundId, multilingualInbound = null) {
  const h = hooks();
  const lang = resolvedLanguageFrom(multilingualInbound);
  let body = buildLocalizedWelcomeMenu(lang, leadContext);
  let tier = 'static';
  let preLocalized = Boolean(body);
  if (!body) {
    body = buildMainMenuText(leadContext);
    tier = 'translate';
    preLocalized = false;
  }

  const outboundTrace = {};
  body = await deliverOutboundReply({
    replyText: body,
    multilingualInbound,
    intent: 'main_menu',
    localizationTier: tier,
    preLocalized,
    outboundTrace,
  });

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
      const fallbackText = resolveSystemReply('orchestratorFallback', 'en');
      const result = await h.outbound.sendBotTextReply({
        conversationId: conversation._id,
        phone10: conversation.phone,
        text: fallbackText,
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
  const leadContext = await h.buildLeadContext(leadLinks);
  await seedPreferredLanguageFromLead(activeConversation._id, leadContext);

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

  const paused = await h.isBotPausedForConversation(activeConversation);
  if (paused) {
    const menuIntent = classifyIntent(
      inbound.text,
      null,
      activeConversation.productLine,
      inbound.text
    );
    if (menuIntent.intent === 'main_menu') {
      await h.cancelActiveHandoffForUser(activeConversation);
      activeConversation =
        (await WhatsAppConversation.findById(activeConversation._id).lean()) ||
        activeConversation;
    } else {
      const handoffText = await deliverOutboundReply({
        replyText: resolveSystemReply('handoffWait', resolvedLanguageFrom(multilingualInbound)),
        multilingualInbound,
        intent: 'human_handoff',
        localizationTier: 'static',
        preLocalized: true,
      });
      const result = await h.outbound.sendBotTextReply({
        conversationId: activeConversation._id,
        phone10: activeConversation.phone,
        text: handoffText,
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

  const facts = await h.retrieveFacts(leadLinks, leadContext);
  const botState = await h.getBotState(activeConversation._id);

  if (
    multilingualInbound &&
    botState?.context?.counsellorProgramAssistantActive &&
    botState.context.counsellorProgramSessionLanguage
  ) {
    const sessionResolved = resolveSessionAwareLanguage({
      conversation: activeConversation,
      leadContext,
      detected: {
        language: multilingualInbound.detectedLanguage,
        confidence: multilingualInbound.confidence,
      },
      message: inbound.text,
      sessionLanguage: botState.context.counsellorProgramSessionLanguage,
    });
    multilingualInbound.resolvedLanguage = sessionResolved.language;
    multilingualInbound.language = sessionResolved.language;
    multilingualInbound.resolutionReason = sessionResolved.resolutionReason;
    multilingualInbound.resolutionSource = sessionResolved.source;
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
    intentResult = classifyIntent(
      intentText,
      botState,
      activeConversation.productLine,
      inbound.text
    );
  }

  await h.updateConversationIntent(activeConversation._id, intentResult.intent);

  if (String(process.env.CHATBOT_INTENT_DEBUG || '').trim() === '1') {
    console.log(
      '[INTENT_DEBUG]',
      JSON.stringify({
        stage: 'orchestrator_after_classify',
        message: inbound.text,
        intent: intentResult.intent,
        reason: intentResult.intentReason || null,
        englishMessage: multilingualInbound?.englishMessage || null,
        resolvedLanguage: multilingualInbound?.resolvedLanguage || null,
      })
    );
  }

  if (intentResult.intent === 'opt_out') {
    await h.transitionState(activeConversation._id, activeConversation.phone, 'idle', {
      optedOut: true,
      knowledgeAssistantActive: false,
    });
    const optOutText = await deliverOutboundReply({
      replyText: resolveSystemReply('optOut', resolvedLanguageFrom(multilingualInbound)),
      multilingualInbound,
      intent: 'opt_out',
      localizationTier: 'static',
      preLocalized: true,
    });
    const result = await h.outbound.sendBotTextReply({
      conversationId: activeConversation._id,
      phone10: activeConversation.phone,
      text: optOutText,
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
    const result = await sendMainMenu(activeConversation, leadContext, inbound._id, multilingualInbound);
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
  let counsellorProgramResult = null;
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
      replyText = resolveSystemReply('faqPrompt', resolvedLanguageFrom(multilingualInbound));
      if (intentResult.intent === 'faq_query' && inbound.text) {
        const staticHits = searchStaticFaq(inbound.text);
        const blogHits = await searchBlog(inbound.text);
        replyText = await formatFaqAnswerAsync(staticHits, blogHits, inbound.text);
        nextState = 'faq_answer';
      }
      break;
    case 'counselling_support':
      replyText = buildLocalizedCounsellingSupportReply(
        resolvedLanguageFrom(multilingualInbound),
        leadContext,
        { meetingLink: getDemoMeetingLink() }
      );
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
      contextPatch = {
        ...contextPatch,
        rank: r.context,
        knowledgeAssistantActive: false,
        counsellorProgramAssistantActive: false,
      };
      nextState = 'rank_predictor';
      if (contextPatch.rank?.step === 'done') {
        nextState = 'main_menu';
      }
      break;
    }
    case 'college_predictor':
    case 'college_predictor_continue': {
      if (!isCollegePredictorEnabled()) {
        const resolvedLang =
          multilingualInbound?.language || multilingualInbound?.resolvedLanguage || 'en';
        const rankBranchCheckText = normalizeText(
          multilingualInbound?.englishMessage || inbound.text
        );
        replyText = isRankBranchCollegePredictorQuery(rankBranchCheckText, inbound.text)
          ? resolveCollegePredictorRankQueryUnavailableReply(resolvedLang)
          : resolveCollegePredictorMaintenanceReply(resolvedLang);
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
      if (String(process.env.CHATBOT_INTENT_DEBUG || '').trim() === '1') {
        console.log(
          '[INTENT_DEBUG]',
          JSON.stringify({
            stage: 'orchestrator_branch',
            branch: 'greeting',
            handler: 'static resolveGreetingReply',
            knowledgeAssistantUsed: false,
            resolvedLanguage: resolvedLanguageFrom(multilingualInbound),
          })
        );
      }
      replyText = resolveGreetingReply(resolvedLanguageFrom(multilingualInbound));
      nextState = 'idle';
      contextPatch = {
        ...contextPatch,
        knowledgeAssistantActive: false,
        counsellorProgramAssistantActive: false,
      };
      break;
    }
    case 'counsellor_program_assistant': {
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

      if (!isCounsellorProgramAssistantEnabled()) {
        knowledgeAssistantResult = await answerWithTimeout({
          inboundText: assistantInboundText,
          conversationId: activeConversation._id,
          leadContext,
          languageMetadata,
        });
        replyText = knowledgeAssistantResult?.text
          ? knowledgeAssistantResult.text
          : resolveKnowledgeAssistantFallback(resolvedLanguageFrom(multilingualInbound));
        nextState = 'idle';
        break;
      }

      counsellorProgramResult = await answerCounsellorProgramWithTimeout({
        inboundText: assistantInboundText,
        conversationId: activeConversation._id,
        leadContext,
        languageMetadata,
      });
      replyText = counsellorProgramResult?.text || COUNSELLOR_PROGRAM_FALLBACK;
      nextState = 'idle';
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
        replyText = resolveKnowledgeAssistantFallback(resolvedLanguageFrom(multilingualInbound));
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
        replyText = resolveKnowledgeAssistantFallback(resolvedLanguageFrom(multilingualInbound));
      } else {
        replyText = await buildLeadLookupReply(leadContext);
      }
      nextState = 'idle';
    }
  }

  if (intentResult.intent === 'counsellor_program_assistant') {
    const kaFallbackActive =
      !isCounsellorProgramAssistantEnabled() &&
      Boolean(knowledgeAssistantResult?.model && knowledgeAssistantResult?.text);
    const cpaReplyOk = Boolean(counsellorProgramResult?.model && counsellorProgramResult?.text);
    const hadCpaSession = Boolean(botState?.context?.counsellorProgramAssistantActive);
    const cpaActive =
      isCounsellorProgramAssistantEnabled() && (cpaReplyOk || hadCpaSession);
    const sessionLanguage = resolvedLanguageFrom(multilingualInbound);
    const persistedSessionLanguage =
      sessionLanguage ||
      botState?.context?.counsellorProgramSessionLanguage ||
      contextPatch.counsellorProgramSessionLanguage ||
      null;

    if (cpaActive && persistedSessionLanguage && persistedSessionLanguage !== 'en') {
      updatePreferredLanguage(activeConversation._id, persistedSessionLanguage).catch(() => {});
    }

    contextPatch = {
      ...contextPatch,
      counsellorProgramAssistantActive: cpaActive,
      knowledgeAssistantActive: kaFallbackActive,
      counsellorProgramSessionLanguage: cpaActive ? persistedSessionLanguage : null,
    };
  } else if (intentResult.intent === 'knowledge_assistant') {
    contextPatch = {
      ...contextPatch,
      knowledgeAssistantActive: Boolean(
        knowledgeAssistantResult?.model && knowledgeAssistantResult?.text
      ),
      counsellorProgramAssistantActive: false,
    };
  } else {
    contextPatch = {
      ...contextPatch,
      knowledgeAssistantActive: false,
      counsellorProgramAssistantActive: false,
    };
  }

  await h.transitionState(activeConversation._id, activeConversation.phone, nextState, contextPatch);

  if (!replyText) {
    replyText = listExamsMessage();
  }

  const assistantResult = counsellorProgramResult || knowledgeAssistantResult || unknownLlmResult;
  const knowledgeAssistantResponse =
    assistantResult?.languageLog?.englishResponse ||
    (assistantResult?.text ? String(assistantResult.text) : null);

  let outboundTrace = {
    shouldTranslateOutbound: false,
    outboundTranslationExecuted: false,
    translateFromEnglishExecuted: false,
    outboundTranslationLanguage: resolvedLanguageFrom(multilingualInbound),
    outboundTranslationPassThrough: false,
    knowledgeAssistantResponse,
    verifiedResponseLanguage: null,
    languageMismatch: false,
  };

  const tier = localizationTierForIntent(intentResult.intent);
  const preLocalized =
    tier === 'static' &&
    (intentResult.intent === 'greeting' ||
      intentResult.intent === 'counselling_support' ||
      intentResult.intent === 'faq' ||
      (intentResult.intent === 'college_predictor' && !isCollegePredictorEnabled()));

  if (replyText) {
    replyText = await deliverOutboundReply({
      replyText,
      multilingualInbound,
      intent: intentResult.intent,
      localizationTier: tier,
      preLocalized,
      guardrailModified: Boolean(assistantResult?.guardrailModified),
      outboundTrace,
    });

    if (counsellorProgramResult?.languageLog) {
      counsellorProgramResult.languageLog.finalResponse = replyText;
    }
    if (knowledgeAssistantResult?.languageLog) {
      knowledgeAssistantResult.languageLog.finalResponse = replyText;
    }
    if (unknownLlmResult?.languageLog) {
      unknownLlmResult.languageLog.finalResponse = replyText;
    }
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
          confidence: multilingualInbound.confidence,
          preferredLanguage: multilingualInbound.preferredLanguage,
          resolvedLanguage: multilingualInbound.resolvedLanguage,
          resolutionReason: multilingualInbound.resolutionReason,
          detectionSource: multilingualInbound.detectionSource,
          englishMessage: multilingualInbound.englishMessage,
          translatedQuery: multilingualInbound.englishMessage,
          translationApplied: multilingualInbound.translationApplied,
          intentReason: intentResult.intentReason || null,
          outboundLanguage: multilingualInbound.language,
          finalResponseLanguage: resolvedLanguageFrom(multilingualInbound),
          verifiedResponseLanguage: outboundTrace.verifiedResponseLanguage,
          languageMismatch: outboundTrace.languageMismatch,
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
