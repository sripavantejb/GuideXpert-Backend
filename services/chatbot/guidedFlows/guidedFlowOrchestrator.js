'use strict';

const { resolveActiveGuidedFlow, getGuidedFlowByIntent } = require('./guidedFlowRegistry');
const { isGuidedFlowInterrupt } = require('./guidedFlowInterruptPolicy');
const { processGuidedFlowTurn } = require('./guidedFlowProcessors');

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
}) {
  let contextPatch = botState?.context || {};
  const inboundText = multilingualInbound?.englishMessage || String(inbound.text || '').trim();

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
  if (replyText) {
    replyText = await deliverOutboundReply({
      replyText,
      multilingualInbound,
      intent: turn.intent,
      localizationTier: turn.localizationTier || flow.localizationTier || 'translate',
      preLocalized: Boolean(turn.preLocalized),
    });
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
