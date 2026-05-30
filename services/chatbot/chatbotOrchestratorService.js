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
const { buildWelcomeMenuText } = require('./welcomeMessageService');
const { emptySubflows } = require('./botSubflowContext');
const { maskPhoneTail } = require('../../utils/chatbotPhone');
const { logChatbotEvent, extractPredictorExam } = require('./chatbotStructuredLog');

const ORCHESTRATOR_FALLBACK_REPLY =
  'Sorry, something went wrong on our side. Please try again in a moment or reply MENU for options.';

const HANDOFF_WAIT_REPLY =
  'Our counsellor team is handling your chat. Please wait for their reply here.\n\nReply MENU to return to the assistant.';

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

function logMenuDeliveryFallback({
  conversation,
  leadContext,
  attemptedType,
  fallbackType,
  errMessage,
}) {
  logChatbotEvent('menu_delivery_fallback', {
    conversationId: conversation._id,
    phone10: conversation.phone,
    productLine: leadContext?.productLine || conversation.productLine || null,
    attemptedType,
    fallbackType,
    errMessage: errMessage || null,
  });
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

function useButtonMenu() {
  return String(process.env.CHATBOT_USE_BUTTON_MENU || '').trim() === '1';
}

/** Opt-in IIT interactive list menu (disabled by default while verifying list send issues). */
function useIitListMenu() {
  return String(process.env.CHATBOT_USE_IIT_LIST_MENU || '').trim() === '1';
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
  const line = leadContext?.productLine || conversation.productLine || 'unknown';
  const baseArgs = {
    conversationId: conversation._id,
    phone10: conversation.phone,
    inReplyToInboundId,
  };

  if (useButtonMenu() && line === 'iit_counselling' && useIitListMenu()) {
    const listResult = await h.outbound.sendBotListReply({
      ...baseArgs,
      body,
      buttonText: 'Choose option',
      sections: buildMainMenuListSections(),
    });
    if (outboundSucceeded(listResult)) {
      return listResult;
    }
    logMenuDeliveryFallback({
      conversation,
      leadContext,
      attemptedType: 'interactive_list',
      fallbackType: 'interactive_button',
      errMessage: listResult?.error,
    });

    const buttonResult = await h.outbound.sendBotButtonReply({
      ...baseArgs,
      body,
      buttons: buildMainMenuButtons(leadContext),
    });
    if (outboundSucceeded(buttonResult)) {
      return buttonResult;
    }
    logMenuDeliveryFallback({
      conversation,
      leadContext,
      attemptedType: 'interactive_button',
      fallbackType: 'text',
      errMessage: buttonResult?.error,
    });

    return h.outbound.sendBotTextReply({
      ...baseArgs,
      text: body,
    });
  }

  if (useButtonMenu()) {
    const buttonResult = await h.outbound.sendBotButtonReply({
      ...baseArgs,
      body,
      buttons: buildMainMenuButtons(leadContext),
    });
    if (outboundSucceeded(buttonResult)) {
      return buttonResult;
    }
    logMenuDeliveryFallback({
      conversation,
      leadContext,
      attemptedType: 'interactive_button',
      fallbackType: 'text',
      errMessage: buttonResult?.error,
    });

    return h.outbound.sendBotTextReply({
      ...baseArgs,
      text: body,
    });
  }

  return h.outbound.sendBotTextReply({
    ...baseArgs,
    text: body,
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
  const facts = await h.retrieveFacts(leadLinks, leadContext);
  const botState = await h.getBotState(activeConversation._id);

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
    intentResult = classifyIntent(inbound.text, botState, activeConversation.productLine);
  }

  await h.updateConversationIntent(activeConversation._id, intentResult.intent);

  if (intentResult.intent === 'opt_out') {
    await h.transitionState(activeConversation._id, activeConversation.phone, 'idle', { optedOut: true });
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

  if (intentResult.intent === 'main_menu' || botState?.state === 'greeting') {
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
      const r = handleRankPredictorMessage(inbound.text, contextPatch.rank || {});
      replyText = r.reply;
      contextPatch = { rank: r.context };
      nextState = 'rank_predictor';
      if (contextPatch.rank?.step === 'done') {
        nextState = 'main_menu';
      }
      break;
    }
    case 'college_predictor':
    case 'college_predictor_continue': {
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
    default: {
      if (String(process.env.CHATBOT_LLM_ENABLED || '').trim() === '1') {
        const llm = await tryLlmReply({ inboundText: inbound.text, facts, leadContext });
        if (llm && llm.text) {
          replyText = llm.text;
          break;
        }
      }
      if (intentResult.confidence === 'low') {
        replyText =
          'I am not sure I understood. Reply MENU for options or AGENT to speak with our team.';
      } else {
        replyText = await buildLeadLookupReply(leadContext);
      }
      nextState = 'idle';
    }
  }

  await h.transitionState(activeConversation._id, activeConversation.phone, nextState, contextPatch);

  if (!replyText) {
    replyText = listExamsMessage();
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
