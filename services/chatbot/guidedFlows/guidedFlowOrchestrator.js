'use strict';

const { resolveActiveGuidedFlow, getGuidedFlowByIntent } = require('./guidedFlowRegistry');
const {
  logCareerDropoff,
  logCareerInterruption,
} = require('../careerCounselling/careerCounsellingV2Analytics');
const { GLOBAL_KEYWORDS } = require('../../../constants/chatbotStates');
const { matchesAny, matchesMenuCommands } = require('../intentTextUtils');
const { isGuidedFlowInterrupt } = require('./guidedFlowInterruptPolicy');
const { processGuidedFlowTurn } = require('./guidedFlowProcessors');
const { isScopeFirewallEnabled } = require('../scopeFirewall/scopeFirewallFlags');
const { evaluateInboundScope, buildScopeLogFields } = require('../scopeFirewall/scopeIntentGate');
const {
  resolveScopeFirewallReply,
  resolvePolicyRefusal,
} = require('../../../constants/scopeFirewallReplies');
const {
  isObviousOutOfPredictorDomain,
  isPredictorInFlowMessage,
} = require('../whatsappCollegePredictor/collegePredictorSessionService');
const { logChatbotEvent } = require('../chatbotStructuredLog');

function logCareerJourneyInterrupt(flow, botState, routingText) {
  if (flow?.id !== 'career_counselling_v2') return;
  const cc = botState?.context?.careerCounselling || {};
  const t = String(routingText || '').trim().toLowerCase();
  const isAgent = matchesAny(t, GLOBAL_KEYWORDS.agent);
  const isMenu = matchesMenuCommands(t);
  const isCancel = matchesAny(t, GLOBAL_KEYWORDS.cancel) || matchesAny(t, GLOBAL_KEYWORDS.stop);

  if (isAgent) {
    logCareerInterruption({ stage: cc.stage, step: cc.step, kind: 'agent' });
  }
  if (isMenu || isCancel) {
    logCareerInterruption({ stage: cc.stage, step: cc.step, kind: isMenu ? 'menu' : 'cancel' });
    logCareerDropoff({ stage: cc.stage, step: cc.step, reason: isMenu ? 'menu' : 'cancel' });
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
    phone: activeConversation.phone,
    conversationId: activeConversation._id,
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
  const replyParts =
    flow?.id === 'career_counselling_v2' && Array.isArray(turn.replyParts) && turn.replyParts.length > 1
      ? turn.replyParts
      : null;

  let result = null;
  if (replyParts) {
    for (const part of replyParts) {
      let partText = part;
      if (partText) {
        partText = await deliverOutboundReply({
          replyText: partText,
          multilingualInbound,
          intent: turn.intent,
          localizationTier: turn.localizationTier || flow.localizationTier || 'translate',
          preLocalized: Boolean(turn.preLocalized),
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
  } else {
    if (replyText) {
      replyText = await deliverOutboundReply({
        replyText,
        multilingualInbound,
        intent: turn.intent,
        localizationTier: turn.localizationTier || flow.localizationTier || 'translate',
        preLocalized: Boolean(turn.preLocalized),
      });
    }

    result = await h.outbound.sendBotTextReply({
      conversationId: activeConversation._id,
      phone10: activeConversation.phone,
      text: replyText,
      inReplyToInboundId: inbound._id,
    });
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
 * Scope Firewall while College Predictor owns conversation.
 * Refuse OOS without clearing college slots / sticky results.
 */
async function refuseOutOfScopeInPredictor({
  activeConversation,
  inbound,
  botState,
  multilingualInbound,
  startedAt,
  deliverOutboundReply,
  logInboundResult,
  h,
  resolvedLanguageFrom,
  routingText,
}) {
  const scope = await evaluateInboundScope({
    originalText: inbound.text,
    englishMessage: routingText || inbound.text,
    intent: 'college_predictor_continue',
    botState,
  });

  const scopeLogFields = buildScopeLogFields(scope, {
    conversationId: activeConversation._id,
    intent: 'college_predictor_continue',
    botState: botState?.state || null,
    inboundMessageLength: String(inbound.text || '').length,
    scopeBlockedSegmentCount: scope.blockedSegments?.length || 0,
  });

  const refusalText = scope.policyBlock
    ? resolvePolicyRefusal(scope.category, resolvedLanguageFrom(multilingualInbound))
    : resolveScopeFirewallReply(resolvedLanguageFrom(multilingualInbound));

  logChatbotEvent('scope_blocked', {
    ...scopeLogFields,
    scopeReason: scope.reason || 'predictor_session_oos',
    predictorStatePreserved: true,
  });

  const outboundText = await deliverOutboundReply({
    replyText: refusalText,
    multilingualInbound,
    intent: 'college_predictor_continue',
    localizationTier: 'static',
    preLocalized: false,
  });
  const result = await h.outbound.sendBotTextReply({
    conversationId: activeConversation._id,
    phone10: activeConversation.phone,
    text: outboundText,
    inReplyToInboundId: inbound._id,
  });
  logInboundResult({
    event: 'inbound_processed',
    conversation: activeConversation,
    botState,
    intent: 'college_predictor_continue',
    contextPatch: botState?.context || {},
    durationMs: Date.now() - startedAt,
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

  // Section D V2: Scope Firewall still runs inside College Predictor ownership.
  if (flow.id === 'college_predictor' && isScopeFirewallEnabled()) {
    const collegeCtx = botState?.context?.college || {};
    const oos =
      isObviousOutOfPredictorDomain(routingText, inbound.text) &&
      !isPredictorInFlowMessage(routingText, collegeCtx);
    if (oos) {
      return refuseOutOfScopeInPredictor({
        ...params,
        routingText,
      });
    }
  }

  return executeActiveGuidedFlowTurn({ ...params, flow });
}

/**
 * Run a guided flow turn from intent-classifier switch routing (new entry or after interrupt).
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
    phone: activeConversation.phone,
    conversationId: activeConversation._id,
    preferredCollege: intentResult.preferredCollege || null,
  });

  if (turn.predictionIdempotency && turn.persistIdempotencyBeforeComplete) {
    await transitionState(activeConversation._id, activeConversation.phone, flow.botState, {
      predictionIdempotency: turn.predictionIdempotency,
      college: turn.clearCollegeOnIdempotencyPersist ? {} : contextPatch.college || {},
    });
  }

  return {
    replyText: turn.replyText,
    replyParts: turn.replyParts || null,
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
