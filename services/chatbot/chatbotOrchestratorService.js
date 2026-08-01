const WhatsAppConversation = require('../../models/WhatsAppConversation');
const {
  classifyIntent,
  isCounsellorProgramQuestion,
  shouldBypassScopeFirewall,
} = require('./intentClassifierService');
const { tryRouteActiveGuidedFlow, applyGuidedFlowSwitchTurn, executeActiveGuidedFlowTurn } = require('./guidedFlows/guidedFlowOrchestrator');
const { getGuidedFlowByIntent } = require('./guidedFlows/guidedFlowRegistry');
const { isSupportedLanguage, normalizeLanguageCode } = require('../../constants/languageConstants');
const botStateService = require('./botStateService');
const { OptimisticLockFailedError } = botStateService;
const leadContextService = require('./leadContextService');
const { retrieveFacts } = require('./knowledgeRetrievalService');
const { buildDemoSupportReply } = require('./demoSupportService');
const { listExamsMessage } = require('./rankPredictorChatService');
const handoffService = require('./handoffService');
const whatsappOutbound = require('./whatsappOutboundService');
const { tryLlmReply } = require('./llmReplyService');
const { isLeadEventExtractionEnabled } = require('./leadEventExtraction/leadEventExtractionFlags');
const { extractAndPersist } = require('./leadEventExtraction/leadEventExtractionService');
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
  isScopeFirewallEnabled,
  isScopeFirewallShadowMode,
} = require('./scopeFirewall/scopeFirewallFlags');
const { getLlmInboundText } = require('./scopeFirewall/scopeFirewallService');
const {
  evaluateInboundScope,
  buildScopeLogFields,
} = require('./scopeFirewall/scopeIntentGate');
const {
  resolveScopeFirewallReply,
  resolvePolicyRefusal,
  buildPartialScopeReply,
} = require('../../constants/scopeFirewallReplies');

function resolvedLanguageFrom(multilingualInbound, fallback = 'en') {
  return multilingualInbound?.resolvedLanguage || multilingualInbound?.language || fallback;
}

function localizationTierForIntent(intent) {
  switch (intent) {
    case 'greeting':
    case 'main_menu':
    case 'counselling_support':
    case 'college_predictor':
    case 'career_counselling_journey':
    case 'career_counselling_flow_v2':
    case 'career_counselling_flow_v3':
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

/** WhatsApp college predictor is always enabled (no env flag). */
function isCollegePredictorEnabled() {
  return true;
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
  resetToMainMenu: (...args) => botStateService.resetToMainMenu(...args),
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
  // Legacy IIT/GX/organic numbered menus are retired. Interactive taps
  // either hand off to a human or re-enter Master Flow v2.
  if (
    id === 'menu_6' ||
    id === 'menu_agent' ||
    (id === 'menu_5' && String(productLine || '') !== 'iit_counselling')
  ) {
    return 'human_handoff';
  }
  return 'career_counselling_flow_v2';
}

async function sendMainMenu(conversation, leadContext, inReplyToInboundId, multilingualInbound = null) {
  // RETIRED: legacy IIT/GX/organic numbered welcome narratives are no longer
  // sent. Callers that still invoke sendMainMenu get a short bridge into
  // Master Flow v2 rather than the old product-line menus.
  const h = hooks();
  const body =
    "I'm Rithika from GuideXpert — I'll help you figure out the right path after Class 12. Tell me your name to begin, or just share what you need help with.";
  logChatbotEvent('main_menu_sent', {
    conversationId: conversation._id,
    phone10: conversation.phone,
    productLine: leadContext?.productLine || conversation.productLine || null,
    textLength: String(body || '').length,
    retiredLegacyMenu: true,
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
    const result = await botStateService.runWithOptimisticLockRetry({
      conversationId: conversation._id,
      phone10: conversation.phone,
      operation: async (attempt) => {
        const core = await processInboundCore({
          conversation,
          inbound,
          leadLinks,
          startedAt,
          optimisticRetryAttempt: attempt,
        });
        return { ...core, ...summarizeProcessResult(core) };
      },
    });
    return result;
  } catch (err) {
    if (err instanceof OptimisticLockFailedError) {
      logInboundResult({
        event: 'inbound_failed',
        conversation,
        botState: null,
        intent: null,
        contextPatch: {},
        durationMs: Date.now() - startedAt,
        errMessage: 'optimistic_lock_failed',
      });
      console.error('[chatbot] optimistic lock failed after retries', {
        phone_tail: maskPhoneTail(conversation.phone),
        conversation_id: String(conversation._id),
        previous_version: err.meta?.previousVersion ?? null,
        current_version: err.meta?.currentVersion ?? null,
      });
      try {
        const fallbackText = resolveSystemReply('orchestratorFallback', 'en');
        const result = await h.outbound.sendBotTextReply({
          conversationId: conversation._id,
          phone10: conversation.phone,
          text: fallbackText,
          inReplyToInboundId: inbound._id,
        });
        return {
          ...result,
          ...summarizeProcessResult(result),
          optimisticLockFailed: true,
        };
      } catch (sendErr) {
        console.error('[chatbot] optimistic lock fallback reply failed', sendErr.message);
        throw err;
      }
    }
    logInboundResult({
      event: 'inbound_failed',
      conversation,
      botState: null,
      intent: null,
      contextPatch: {},
      durationMs: Date.now() - startedAt,
      errMessage: err.message,
      errorKind: err.predictionErrorKind || err.code || err.name || 'orchestrator_error',
    });
    console.error('[chatbot] processInbound failed', {
      phone_tail: maskPhoneTail(conversation.phone),
      conversation_id: String(conversation._id),
      err_message: err.message,
      error_kind: err.predictionErrorKind || err.code || err.name || 'orchestrator_error',
      stack: err.stack ? String(err.stack).split('\n').slice(0, 5).join(' | ') : null,
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

async function processInboundCore({
  conversation,
  inbound,
  leadLinks,
  startedAt,
  optimisticRetryAttempt = 1,
}) {
  const h = hooks();
  const transitionState = (conversationId, phone10, nextState, contextPatch = {}, opts = {}) =>
    h.transitionState(conversationId, phone10, nextState, contextPatch, {
      ...opts,
      retryAttempt: optimisticRetryAttempt,
    });
  const resetToMainMenu = (conversationId, phone10, opts = {}) =>
    h.resetToMainMenu(conversationId, phone10, {
      ...opts,
      retryAttempt: optimisticRetryAttempt,
    });
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
    if (menuIntent.intent === 'main_menu' || menuIntent.intent === 'career_counselling_flow_v2') {
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
  let botState = await h.getBotState(activeConversation._id);
  if (botStateService.isStateExpired(botState)) {
    // A permanent crisis lock outlives the 30-minute subflow expiry: without
    // this the expired turn routes as if the student was never locked.
    const preservedCrisis = botStateService.preserveCrisisLock(botState);
    await resetToMainMenu(activeConversation._id, activeConversation.phone);
    botState = { state: 'main_menu', context: { ...emptySubflows(), ...preservedCrisis } };
  }

  const collegeRoutingText =
    multilingualInbound?.englishMessage || String(inbound.text || '').trim();

  const guidedResult = await tryRouteActiveGuidedFlow({
    activeConversation,
    inbound,
    botState,
    multilingualInbound,
    startedAt,
    transitionState,
    deliverOutboundReply,
    logInboundResult,
    h,
    resolvedLanguageFrom,
    leadContext,
  });
  if (guidedResult) {
    return guidedResult;
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
    await transitionState(activeConversation._id, activeConversation.phone, 'idle', {
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
    // Legacy numbered menus are retired. MENU / cancel re-enter Master Flow v2.
    intentResult = {
      intent: 'career_counselling_flow_v2',
      confidence: 'high',
      intentReason: 'main_menu_redirect_flow_v2',
    };
  }

  // Master Flow v2 — sole live WhatsApp counselling experience (V3 enters via canary/pin only).
  if (
    intentResult.intent === 'career_counselling_flow_v2' ||
    intentResult.intent === 'career_counselling_flow_v2_continue' ||
    intentResult.intent === 'career_counselling_flow_v3' ||
    intentResult.intent === 'career_counselling_flow_v3_continue'
  ) {
    const { resolveFlowV3Routing } = require('./flowV3LLM/flowV3Rollout');
    const priorContext = botState?.context || {};
    const routing = resolveFlowV3Routing({
      phone: activeConversation.phone,
      pinnedEngine: priorContext.flowV3?.engine || null,
      pinnedMode: priorContext.flowV3?.mode || null,
    });

    const useLiveV3 =
      routing.useV3 &&
      routing.mode === 'live' &&
      (intentResult.intent === 'career_counselling_flow_v2' ||
        intentResult.intent === 'career_counselling_flow_v2_continue' ||
        intentResult.intent === 'career_counselling_flow_v3' ||
        intentResult.intent === 'career_counselling_flow_v3_continue');

    const flowIntent = useLiveV3
      ? intentResult.intent.includes('continue')
        ? 'career_counselling_flow_v3_continue'
        : 'career_counselling_flow_v3'
      : intentResult.intent === 'career_counselling_flow_v3' ||
          intentResult.intent === 'career_counselling_flow_v3_continue'
        ? // Kill switch / canary miss: never start dark V3 from a stray intent.
          priorContext.flowV3?.engine === 'flow_v3'
            ? intentResult.intent
            : 'career_counselling_flow_v2'
        : intentResult.intent;

    const flow = getGuidedFlowByIntent(flowIntent);
    if (flow) {
      const restart =
        intentResult.intentReason === 'menu_to_flow_v2' ||
        intentResult.intentReason === 'main_menu_redirect_flow_v2' ||
        intentResult.intentReason === 'migrate_legacy_guided_flow';
      const seededContext =
        flow.id === 'career_counselling_flow_v3'
          ? {
              ...emptySubflows(),
              flowV3: {
                engine: 'flow_v3',
                mode: 'live',
                promptVersion: priorContext.flowV3?.promptVersion || null,
                profile: priorContext.flowV3?.profile || null,
                slotMeta: priorContext.flowV3?.slotMeta || null,
                history: priorContext.flowV3?.history || [],
              },
            }
          : {
              ...emptySubflows(),
              flowV2: restart
                ? { stage: null, profile: priorContext.flowV2?.profile || null }
                : priorContext.flowV2 || { stage: null, profile: null },
              ...(priorContext.flowV3 ? { flowV3: priorContext.flowV3 } : {}),
            };
      await transitionState(
        activeConversation._id,
        activeConversation.phone,
        flow.botState,
        seededContext
      );
      return executeActiveGuidedFlowTurn({
        flow,
        activeConversation,
        inbound,
        botState: { state: flow.botState, context: seededContext },
        multilingualInbound,
        startedAt,
        transitionState,
        deliverOutboundReply,
        logInboundResult,
        h,
        resolvedLanguageFrom,
        leadContext,
      });
    }
  }

  // Scope Firewall: runs after control-intent early returns and before assistant
  // routing. Every message (including sticky KA sessions) is re-checked so
  // out-of-domain topics never reach any LLM path.
  let scopePartialContext = null;
  let routingInboundText =
    multilingualInbound?.englishMessage || String(inbound.text || '').trim();

  if (isScopeFirewallEnabled() && !shouldBypassScopeFirewall(botState, intentResult.intent)) {
    const inboundText = String(inbound.text || '');
    const scope = await evaluateInboundScope({
      originalText: inbound.text,
      englishMessage: multilingualInbound?.englishMessage || inbound.text,
      intent: intentResult.intent,
      botState,
    });

    const scopeLogFields = buildScopeLogFields(scope, {
      conversationId: activeConversation._id,
      intent: intentResult.intent,
      botState: botState?.state || null,
      inboundMessageLength: inboundText.length,
      scopeBlockedSegmentCount: scope.blockedSegments?.length || 0,
    });

    if (scope.classifierUsed) {
      logChatbotEvent('scope_classifier_used', scopeLogFields);
      if (scope.reason === 'classifier_low_confidence' || scope.reason === 'classifier_error') {
        logChatbotEvent('scope_classifier_low_confidence', scopeLogFields);
      } else if (!scope.allowed && !scope.partialAllowed) {
        logChatbotEvent('scope_classifier_blocked', scopeLogFields);
      } else {
        logChatbotEvent('scope_classifier_allowed', scopeLogFields);
      }
    }

    if (scope.classifierBlock && !scope.allowed && !scope.partialAllowed) {
      const refusalText = scope.policyBlock
        ? resolvePolicyRefusal(scope.category, resolvedLanguageFrom(multilingualInbound))
        : resolveScopeFirewallReply(resolvedLanguageFrom(multilingualInbound));
      logChatbotEvent('scope_blocked', {
        ...scopeLogFields,
        scopeReason: scope.reason,
      });
      const policyText = await deliverOutboundReply({
        replyText: refusalText,
        multilingualInbound,
        intent: intentResult.intent,
        localizationTier: 'static',
        preLocalized: true,
      });
      const result = await h.outbound.sendBotTextReply({
        conversationId: activeConversation._id,
        phone10: activeConversation.phone,
        text: policyText,
        inReplyToInboundId: inbound._id,
      });
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

    if (scope.policyBlock && !scope.partialAllowed) {
      const policyEvent = isScopeFirewallShadowMode() ? 'scope_blocked_shadow' : 'scope_blocked';
      logChatbotEvent(policyEvent, { ...scopeLogFields, scopeReason: 'policy_deny' });
      const policyText = await deliverOutboundReply({
        replyText: resolvePolicyRefusal(scope.category, resolvedLanguageFrom(multilingualInbound)),
        multilingualInbound,
        intent: intentResult.intent,
        localizationTier: 'static',
        preLocalized: true,
      });
      const result = await h.outbound.sendBotTextReply({
        conversationId: activeConversation._id,
        phone10: activeConversation.phone,
        text: policyText,
        inReplyToInboundId: inbound._id,
      });
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

    if (scope.partialAllowed) {
      scopePartialContext = scope;
      routingInboundText = getLlmInboundText(scope, routingInboundText);
      if (multilingualInbound) {
        multilingualInbound.englishMessage = routingInboundText;
      }
      intentResult = classifyIntent(
        routingInboundText,
        botState,
        activeConversation.productLine,
        routingInboundText
      );
      await h.updateConversationIntent(activeConversation._id, intentResult.intent);
      logChatbotEvent('scope_mixed_partial', scopeLogFields);
      logChatbotEvent('scope_blocked_shadow', {
        ...scopeLogFields,
        scopeReason: 'mixed_query_blocked_segments',
      });
    } else if (!scope.allowed) {
      if (isScopeFirewallShadowMode()) {
        logChatbotEvent('scope_blocked_shadow', scopeLogFields);
      } else {
        logChatbotEvent('scope_blocked', scopeLogFields);
        const refusalText = await deliverOutboundReply({
          replyText: resolveScopeFirewallReply(resolvedLanguageFrom(multilingualInbound)),
          multilingualInbound,
          intent: intentResult.intent,
          localizationTier: 'static',
          preLocalized: true,
        });
        const result = await h.outbound.sendBotTextReply({
          conversationId: activeConversation._id,
          phone10: activeConversation.phone,
          text: refusalText,
          inReplyToInboundId: inbound._id,
        });
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
    } else {
      logChatbotEvent('scope_allowed', scopeLogFields);
    }
  }

  let replyText = null;
  let nextState = botState?.state || 'main_menu';
  let contextPatch = botState?.context || {};
  let upstreamStatus = null;
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
    case 'rank_predictor':
    case 'rank_predictor_continue':
    case 'college_predictor':
    case 'college_predictor_continue':
    case 'career_counselling_journey':
    case 'career_counselling_journey_continue':
    case 'career_counselling_flow_v2':
    case 'career_counselling_flow_v2_continue':
    case 'career_counselling_flow_v3':
    case 'career_counselling_flow_v3_continue': {
      const flow = getGuidedFlowByIntent(intentResult.intent);
      if (!flow) break;
      const applied = await applyGuidedFlowSwitchTurn({
        flow,
        intentResult,
        activeConversation,
        inbound,
        contextPatch,
        routingInboundText,
        multilingualInbound,
        transitionState,
        resolvedLanguageFrom,
        leadContext,
      });
      replyText = applied.replyText;
      nextState = applied.nextState;
      contextPatch = applied.contextPatch;
      break;
    }
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
        iitCounsellingExpertActive: false,
        iitCounsellingExpertSessionLanguage: null,
        iitCounsellingStrategyActive: false,
        iitCounsellingStrategySessionLanguage: null,
      };
      break;
    }
    default: {
      const assistantInboundText = routingInboundText;
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

  contextPatch = {
    ...contextPatch,
    knowledgeAssistantActive: false,
    counsellorProgramAssistantActive: false,
    counsellorProgramSessionLanguage: null,
    iitCounsellingExpertActive: false,
    iitCounsellingExpertSessionLanguage: null,
    iitCounsellingStrategyActive: false,
    iitCounsellingStrategySessionLanguage: null,
  };

  await transitionState(activeConversation._id, activeConversation.phone, nextState, contextPatch);

  if (!replyText) {
    replyText = listExamsMessage();
  }

  const assistantResult = unknownLlmResult;
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

  if (replyText && scopePartialContext?.partialAllowed) {
    replyText = buildPartialScopeReply({
      counsellingAnswer: replyText,
      blockedSegments: scopePartialContext.blockedSegments,
      resolvedLanguage: resolvedLanguageFrom(multilingualInbound),
    });
  }

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

  if (isLeadEventExtractionEnabled()) {
    extractAndPersist({
      conversation: activeConversation,
      inbound,
      outboundMessageId: result?.outboundId || null,
      intent: intentResult.intent,
      intentReason: intentResult.intentReason || null,
      userMessage: multilingualInbound?.originalMessage || inbound.text,
      assistantReply: replyText,
      leadContext,
      contextPatch,
      assistantResult,
    }).catch((err) => {
      console.warn('[chatbot] lead_event_extraction_failed', err.message);
    });
  }

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
