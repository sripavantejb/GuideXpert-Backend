'use strict';

const { resolveActiveGuidedFlow, getGuidedFlowByIntent } = require('./guidedFlowRegistry');
const {
  logCareerDropoff,
  logCareerInterruption,
} = require('../careerCounselling/careerCounsellingAnalytics');
const { GLOBAL_KEYWORDS } = require('../../../constants/chatbotStates');
const { matchesAny, matchesMenuCommands } = require('../intentTextUtils');
const { isGuidedFlowInterrupt } = require('./guidedFlowInterruptPolicy');
const { processGuidedFlowTurn } = require('./guidedFlowProcessors');

function logCareerJourneyInterrupt(flow, botState, routingText) {
  if (flow?.id !== 'career_counselling_journey') return;
  const cc = botState?.context?.careerCounselling || {};
  const t = String(routingText || '').trim().toLowerCase();
  const isAgent = matchesAny(t, GLOBAL_KEYWORDS.agent);
  const isMenu = matchesMenuCommands(t);
  const isCancel = matchesAny(t, GLOBAL_KEYWORDS.cancel) || matchesAny(t, GLOBAL_KEYWORDS.stop);

  if (isAgent) {
    logCareerInterruption({ phase: cc.phase, step: cc.step, kind: 'agent' });
  }
  if (isMenu || isCancel) {
    logCareerInterruption({ phase: cc.phase, step: cc.step, kind: isMenu ? 'menu' : 'cancel' });
    logCareerDropoff({ phase: cc.phase, step: cc.step, reason: isMenu ? 'menu' : 'cancel' });
  }
}

/**
 * Execute one turn of an active guided workflow and persist state transitions.
 * Called before intent classification and scope firewall when a guided flow is active.
 */
async function executeActiveGuidedFlowTurn({
  flow,
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
  leadContext = null,
}) {
  let contextPatch = botState?.context || {};
  const inboundText =
    (inbound?.messageType === 'list_reply' || inbound?.messageType === 'button_reply') &&
    (inbound?.interactivePayload?.postbackText ||
      inbound?.interactivePayload?.id ||
      inbound?.interactivePayload?.reply?.id)
      ? String(
          inbound.interactivePayload.postbackText ||
            inbound.interactivePayload.id ||
            inbound.interactivePayload.reply.id
        ).trim()
      : multilingualInbound?.englishMessage || String(inbound.text || '').trim();

  await transitionState(
    activeConversation._id,
    activeConversation.phone,
    flow.botState,
    contextPatch
  );

  const turn = await processGuidedFlowTurn({
    flow,
    inboundText,
    inbound,
    contextPatch,
    isNewEntry: false,
    resolvedLanguage: resolvedLanguageFrom(multilingualInbound),
    intent: flow.continueIntent,
    leadContext,
    phone: activeConversation?.phone || null,
  });

  if (turn.predictionIdempotency && turn.persistIdempotencyBeforeComplete) {
    await transitionState(activeConversation._id, activeConversation.phone, flow.botState, {
      predictionIdempotency: turn.predictionIdempotency,
      college: turn.clearCollegeOnIdempotencyPersist ? {} : contextPatch.college || {},
    });
  }

  await transitionState(
    activeConversation._id,
    activeConversation.phone,
    turn.nextState,
    turn.contextPatch
  );

  let replyText = turn.replyText;
  const flowV2Interactive = flow?.id === 'career_counselling_flow_v2' ? turn.interactive : null;
  // Master Flow v2 is English-only: never translate Rithika copy even if
  // inbound language detection resolved to Telugu/Hindi/etc.
  const flowV2EnglishOnly = flow?.id === 'career_counselling_flow_v2';
  const outboundLanguageInbound = flowV2EnglishOnly
    ? {
        ...(multilingualInbound || {}),
        resolvedLanguage: 'en',
        language: 'en',
      }
    : multilingualInbound;
  const outboundLocalizationTier = flowV2EnglishOnly
    ? 'static'
    : turn.localizationTier || flow.localizationTier || 'translate';
  const outboundPreLocalized = flowV2EnglishOnly ? true : Boolean(turn.preLocalized);
  if (
    !replyText &&
    !flowV2Interactive &&
    (!Array.isArray(turn.replyParts) || turn.replyParts.length === 0)
  ) {
    replyText =
      'Share what matters most in a college — placements, coding culture, fees, or say "I don\'t know".';
  }
  const replyParts =
    (flow?.id === 'career_counselling_v2' || flow?.id === 'career_counselling_flow_v2') &&
    Array.isArray(turn.replyParts) &&
    turn.replyParts.length > 0
      ? turn.replyParts
      : null;

  let result = null;
  if (replyParts && replyParts.length) {
    for (const part of replyParts) {
      let partText = part;
      if (partText) {
        partText = await deliverOutboundReply({
          replyText: partText,
          multilingualInbound: outboundLanguageInbound,
          intent: turn.intent,
          localizationTier: outboundLocalizationTier,
          preLocalized: outboundPreLocalized,
        });
      }
      result = await h.outbound.sendBotTextReply({
        conversationId: activeConversation._id,
        phone10: activeConversation.phone,
        text: partText,
        inReplyToInboundId: inbound._id,
      });
    }
    replyText = replyParts.join('\n\n');
  }

  if (flowV2Interactive && flowV2Interactive.type === 'list') {
    const body = await deliverOutboundReply({
      replyText: flowV2Interactive.body,
      multilingualInbound: outboundLanguageInbound,
      intent: turn.intent,
      localizationTier: outboundLocalizationTier,
      preLocalized: outboundPreLocalized,
    });
    result = await h.outbound.sendBotListReply({
      conversationId: activeConversation._id,
      phone10: activeConversation.phone,
      body,
      buttonText: flowV2Interactive.buttonText || 'Select',
      sections: flowV2Interactive.sections || [],
      title: flowV2Interactive.title,
      inReplyToInboundId: inbound._id,
    });
    replyText = body;
  } else if (flowV2Interactive && flowV2Interactive.type === 'button') {
    const body = await deliverOutboundReply({
      replyText: flowV2Interactive.body,
      multilingualInbound: outboundLanguageInbound,
      intent: turn.intent,
      localizationTier: outboundLocalizationTier,
      preLocalized: outboundPreLocalized,
    });
    result = await h.outbound.sendBotButtonReply({
      conversationId: activeConversation._id,
      phone10: activeConversation.phone,
      body,
      buttons: flowV2Interactive.buttons || [],
      inReplyToInboundId: inbound._id,
    });
    replyText = body;
  } else if (!replyParts || !replyParts.length) {
    if (replyText) {
      replyText = await deliverOutboundReply({
        replyText,
        multilingualInbound: outboundLanguageInbound,
        intent: turn.intent,
        localizationTier: outboundLocalizationTier,
        preLocalized: outboundPreLocalized,
      });
    }

    result = await h.outbound.sendBotTextReply({
      conversationId: activeConversation._id,
      phone10: activeConversation.phone,
      text: replyText,
      inReplyToInboundId: inbound._id,
    });
  }

  if (turn.pendingSideEffect && typeof turn.pendingSideEffect.execute === 'function') {
    try {
      await turn.pendingSideEffect.execute();
    } catch (err) {
      console.warn('[flowV2] pendingSideEffect failed', err?.message || err);
    }
  }

  logInboundResult({
    event: 'inbound_processed',
    conversation: activeConversation,
    botState,
    intent: turn.intent,
    contextPatch: turn.contextPatch,
    durationMs: Date.now() - startedAt,
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
          outboundLanguage: multilingualInbound.language,
          finalResponseLanguage: resolvedLanguageFrom(multilingualInbound),
          finalResponse: replyText,
        }
      : null,
  });

  return result;
}

/**
 * Returns guided flow result when an active flow should handle this inbound, or null to continue
 * normal orchestrator routing (interrupts, idle states, etc.).
 */
async function tryRouteActiveGuidedFlow(params) {
  const { botState, inbound, multilingualInbound } = params;
  const flow = resolveActiveGuidedFlow(botState);
  if (!flow) return null;

  const routingText = multilingualInbound?.englishMessage || String(inbound.text || '').trim();
  if (isGuidedFlowInterrupt(routingText, inbound.text)) {
    logCareerJourneyInterrupt(flow, botState, routingText);
    return null;
  }

  return executeActiveGuidedFlowTurn({ ...params, flow });
}

/**
 * Run a guided flow turn from intent-classifier switch routing (new entry or continue after interrupt).
 */
async function applyGuidedFlowSwitchTurn({
  flow,
  intentResult,
  activeConversation,
  inbound,
  contextPatch,
  routingInboundText,
  multilingualInbound,
  transitionState,
  resolvedLanguageFrom,
  leadContext = null,
}) {
  await transitionState(
    activeConversation._id,
    activeConversation.phone,
    flow.botState,
    contextPatch
  );

  const turn = await processGuidedFlowTurn({
    flow,
    inboundText: routingInboundText,
    inbound,
    contextPatch,
    isNewEntry: flow.entryIntents.includes(intentResult.intent),
    resolvedLanguage: resolvedLanguageFrom(multilingualInbound),
    intent: intentResult.intent,
    leadContext,
    phone: activeConversation?.phone || null,
  });

  if (turn.predictionIdempotency && turn.persistIdempotencyBeforeComplete) {
    await transitionState(activeConversation._id, activeConversation.phone, flow.botState, {
      predictionIdempotency: turn.predictionIdempotency,
      college: turn.clearCollegeOnIdempotencyPersist ? {} : contextPatch.college || {},
    });
  }

  return {
    replyText: turn.replyText,
    nextState: turn.nextState,
    contextPatch: turn.contextPatch,
    intent: turn.intent || intentResult.intent,
  };
}

module.exports = {
  executeActiveGuidedFlowTurn,
  tryRouteActiveGuidedFlow,
  applyGuidedFlowSwitchTurn,
  getGuidedFlowByIntent,
};
