const WhatsAppConversation = require('../../models/WhatsAppConversation');
const { classifyIntent } = require('./intentClassifierService');
const { getBotState, transitionState, resetToMainMenu } = require('./botStateService');
const { buildLeadContext } = require('./leadContextService');
const { retrieveFacts } = require('./knowledgeRetrievalService');
const { searchStaticFaq, searchBlog, formatFaqAnswerAsync } = require('./faqService');
const { buildCounsellingSupportReply } = require('./counsellingSupportService');
const { buildDemoSupportReply } = require('./demoSupportService');
const { handleRankPredictorMessage, listExamsMessage } = require('./rankPredictorChatService');
const { handleCollegePredictorMessage } = require('./collegePredictorChatService');
const { createHandoff, isBotPausedForConversation } = require('./handoffService');
const whatsappOutbound = require('./whatsappOutboundService');
const { tryLlmReply } = require('./llmReplyService');
const { buildWelcomeMenuText } = require('./welcomeMessageService');

function useButtonMenu() {
  return String(process.env.CHATBOT_USE_BUTTON_MENU || '').trim() === '1';
}

function buildMainMenuText(leadContext) {
  return buildWelcomeMenuText(leadContext);
}

function buildMainMenuButtons(leadContext) {
  const line = leadContext?.productLine || 'unknown';
  if (line === 'iit_counselling') {
    return [
      { id: 'menu_1', title: 'My Details' },
      { id: 'menu_3', title: 'Rank Predictor' },
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

function mapButtonIdToIntent(buttonId, productLine = 'unknown') {
  const id = String(buttonId || '');
  const line = productLine || 'unknown';

  if (line === 'iit_counselling') {
    if (id === 'menu_1') return 'lead_lookup';
    if (id === 'menu_3') return 'rank_predictor';
    if (id === 'menu_agent' || id === 'menu_5') return 'human_handoff';
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
  const body = buildMainMenuText(leadContext);
  if (useButtonMenu()) {
    return whatsappOutbound.sendBotButtonReply({
      conversationId: conversation._id,
      phone10: conversation.phone,
      body,
      buttons: buildMainMenuButtons(leadContext),
      inReplyToInboundId,
    });
  }
  return whatsappOutbound.sendBotTextReply({
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

/**
 * Process one inbound message and send reply(ies).
 */
async function processInbound({ conversation, inbound, leadLinks }) {
  const paused = await isBotPausedForConversation(conversation);
  if (paused) {
    return { skipped: true, reason: 'handoff_active' };
  }

  const leadContext = await buildLeadContext(leadLinks);
  const facts = await retrieveFacts(leadLinks);
  const botState = await getBotState(conversation._id);

  let intentResult;
  if (inbound.messageType === 'button_reply' && inbound.interactivePayload) {
    const btnId =
      inbound.interactivePayload.id ||
      (inbound.interactivePayload.reply && inbound.interactivePayload.reply.id);
    intentResult = {
      intent: mapButtonIdToIntent(btnId, conversation.productLine),
      confidence: 'high',
    };
  } else {
    intentResult = classifyIntent(inbound.text, botState, conversation.productLine);
  }

  await WhatsAppConversation.updateOne(
    { _id: conversation._id },
    { $set: { lastIntent: intentResult.intent, updatedAt: new Date() } }
  );

  if (intentResult.intent === 'opt_out') {
    await transitionState(conversation._id, conversation.phone, 'idle', { optedOut: true });
    return whatsappOutbound.sendBotTextReply({
      conversationId: conversation._id,
      phone10: conversation.phone,
      text: 'You have been opted out of automated messages. Reply MENU anytime to start again.',
      inReplyToInboundId: inbound._id,
    });
  }

  if (intentResult.intent === 'human_handoff') {
    await createHandoff({
      conversation,
      leadContext,
      reason: 'user_requested',
      userLastMessage: inbound.text,
    });
    return { handoff: true };
  }

  if (intentResult.intent === 'main_menu' || botState?.state === 'greeting') {
    await transitionState(conversation._id, conversation.phone, 'main_menu');
    return sendMainMenu(conversation, leadContext, inbound._id);
  }

  let replyText = null;
  let nextState = botState?.state || 'main_menu';
  let contextPatch = botState?.context || {};

  switch (intentResult.intent) {
    case 'lead_lookup':
      replyText = await buildLeadLookupReply({ ...leadContext, links: facts.links });
      nextState = 'lead_lookup';
      break;
    case 'faq':
    case 'faq_query':
      await transitionState(conversation._id, conversation.phone, 'faq', contextPatch);
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
      await transitionState(conversation._id, conversation.phone, 'rank_predictor', contextPatch);
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
      await transitionState(conversation._id, conversation.phone, 'college_predictor', contextPatch);
      const c = handleCollegePredictorMessage(inbound.text, contextPatch.college || {});
      replyText = c.reply;
      contextPatch = { college: c.context };
      nextState = 'college_predictor';
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

  await transitionState(conversation._id, conversation.phone, nextState, contextPatch);

  if (!replyText) {
    replyText = listExamsMessage();
  }

  return whatsappOutbound.sendBotTextReply({
    conversationId: conversation._id,
    phone10: conversation.phone,
    text: replyText,
    inReplyToInboundId: inbound._id,
  });
}

module.exports = {
  processInbound,
  sendMainMenu,
  buildMainMenuText,
};
