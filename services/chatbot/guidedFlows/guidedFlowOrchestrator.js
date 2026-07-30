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

function compactWhatsAppSpacing(text) {
  if (text == null) return text;
  return String(text).replace(/\n[ \t]*\n+/g, '\n').trim();
}

function mediaFollowupDelayMs() {
  if (process.env.NODE_ENV === 'test') return 0;
  const configured = Number.parseInt(process.env.WA_MEDIA_FOLLOWUP_DELAY_MS || '', 10);
  return Number.isFinite(configured) ? Math.max(0, Math.min(configured, 5000)) : 2000;
}

async function waitForMediaOrdering() {
  const delayMs = mediaFollowupDelayMs();
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

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
  let inboundText =
    multilingualInbound?.englishMessage || String(inbound.text || '').trim();
  if (inbound?.messageType === 'list_reply' || inbound?.messageType === 'button_reply') {
    const payload = inbound.interactivePayload || {};
    const id = String(payload.id || payload.reply?.id || '').trim();
    const postback = String(payload.postbackText || '').trim();
    const title = String(payload.title || payload.reply?.title || '').trim();
    // Prefer stable flowv2_* ids over display titles / curly-apostrophe labels.
    if (/^flowv2_/i.test(id)) inboundText = id;
    else if (/^flowv2_/i.test(postback)) inboundText = postback;
    else inboundText = postback || id || title || inboundText;
  }

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
  const flowEnglishInteractive =
    flow?.id === 'career_counselling_flow_v2' || flow?.id === 'career_counselling_flow_v3'
      ? turn.interactive
      : null;
  // Master Flow v2/v3 are English-only: never translate Rithika copy even if
  // inbound language detection resolved to Telugu/Hindi/etc.
  const flowEnglishOnly =
    flow?.id === 'career_counselling_flow_v2' || flow?.id === 'career_counselling_flow_v3';
  const compactFlowText = (text) => (flowEnglishOnly ? compactWhatsAppSpacing(text) : text);
  const outboundLanguageInbound = flowEnglishOnly
    ? {
        ...(multilingualInbound || {}),
        resolvedLanguage: 'en',
        language: 'en',
      }
    : multilingualInbound;
  const outboundLocalizationTier = flowEnglishOnly
    ? 'static'
    : turn.localizationTier || flow.localizationTier || 'translate';
  const outboundPreLocalized = flowEnglishOnly ? true : Boolean(turn.preLocalized);
  const flowMedia =
    turn.replyMedia && turn.replyMedia.type === 'image' && turn.replyMedia.url
      ? turn.replyMedia
      : null;
  if (
    !turn.silent &&
    !replyText &&
    !flowEnglishInteractive &&
    !flowMedia &&
    (!Array.isArray(turn.replyParts) || turn.replyParts.length === 0)
  ) {
    replyText =
      'Share what matters most in a college — placements, coding culture, fees, or say "I don\'t know".';
  }
  const replyParts =
    (flow?.id === 'career_counselling_v2' ||
      flow?.id === 'career_counselling_flow_v2' ||
      flow?.id === 'career_counselling_flow_v3') &&
    Array.isArray(turn.replyParts) &&
    turn.replyParts.length > 0
      ? turn.replyParts
      : null;

  let nextPartIndex = 0;
  const partSendResults = [];
  let result = null;

  function recordPartResult(sendResult) {
    if (sendResult) partSendResults.push(sendResult);
    return sendResult;
  }

  if (turn.silent) {
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
            finalResponse: null,
          }
        : null,
    });
    return { success: true, silent: true, envelopePartCount: 0, sentPartCount: 0, newlySent: 0 };
  }

  if (replyParts && replyParts.length) {
    for (const part of replyParts) {
      let partText = part;
      if (partText) {
        partText = compactFlowText(
          await deliverOutboundReply({
            replyText: partText,
            multilingualInbound: outboundLanguageInbound,
            intent: turn.intent,
            localizationTier: outboundLocalizationTier,
            preLocalized: outboundPreLocalized,
          })
        );
      }
      const partIndex = nextPartIndex++;
      result = recordPartResult(
        await h.outbound.sendBotTextReply({
          conversationId: activeConversation._id,
          phone10: activeConversation.phone,
          text: partText,
          inReplyToInboundId: inbound._id,
          partIndex,
        })
      );
    }
    replyText = replyParts.join('\n\n');
  }

  let mediaCaption = null;
  if (flowMedia && typeof h.outbound.sendBotImageReply !== 'function') {
    console.warn('[flowV2] image reply skipped — outbound.sendBotImageReply unavailable');
  } else if (flowMedia) {
    const caption = flowMedia.caption
      ? compactFlowText(
          await deliverOutboundReply({
            replyText: flowMedia.caption,
            multilingualInbound: outboundLanguageInbound,
            intent: turn.intent,
            localizationTier: outboundLocalizationTier,
            preLocalized: outboundPreLocalized,
          })
        )
      : null;
    const partIndex = nextPartIndex++;
    result = recordPartResult(
      await h.outbound.sendBotImageReply({
        conversationId: activeConversation._id,
        phone10: activeConversation.phone,
        url: flowMedia.url,
        caption,
        inReplyToInboundId: inbound._id,
        partIndex,
      })
    );
    mediaCaption = caption;
    // Gupshup acknowledges media before WhatsApp finishes processing it.
    // Without a small gap, the following quick-reply can arrive first.
    if (result?.success && flowEnglishInteractive) {
      await waitForMediaOrdering();
    }
  }

  if (flowEnglishInteractive && flowEnglishInteractive.type === 'list') {
    const body = compactFlowText(
      await deliverOutboundReply({
        replyText: flowEnglishInteractive.body,
        multilingualInbound: outboundLanguageInbound,
        intent: turn.intent,
        localizationTier: outboundLocalizationTier,
        preLocalized: outboundPreLocalized,
      })
    );
    const partIndex = nextPartIndex++;
    result = recordPartResult(
      await h.outbound.sendBotListReply({
        conversationId: activeConversation._id,
        phone10: activeConversation.phone,
        body,
        buttonText: flowEnglishInteractive.buttonText || 'Select',
        sections: flowEnglishInteractive.sections || [],
        title: flowEnglishInteractive.title,
        inReplyToInboundId: inbound._id,
        partIndex,
      })
    );
    replyText = body;
  } else if (flowEnglishInteractive && flowEnglishInteractive.type === 'button') {
    const body = compactFlowText(
      await deliverOutboundReply({
        replyText: flowEnglishInteractive.body,
        multilingualInbound: outboundLanguageInbound,
        intent: turn.intent,
        localizationTier: outboundLocalizationTier,
        preLocalized: outboundPreLocalized,
      })
    );
    const partIndex = nextPartIndex++;
    result = recordPartResult(
      await h.outbound.sendBotButtonReply({
        conversationId: activeConversation._id,
        phone10: activeConversation.phone,
        body,
        buttons: flowEnglishInteractive.buttons || [],
        inReplyToInboundId: inbound._id,
        partIndex,
      })
    );
    replyText = body;
  } else if (replyText && (!replyParts || !replyParts.length)) {
    replyText = compactFlowText(
      await deliverOutboundReply({
        replyText,
        multilingualInbound: outboundLanguageInbound,
        intent: turn.intent,
        localizationTier: outboundLocalizationTier,
        preLocalized: outboundPreLocalized,
      })
    );

    const partIndex = nextPartIndex++;
    result = recordPartResult(
      await h.outbound.sendBotTextReply({
        conversationId: activeConversation._id,
        phone10: activeConversation.phone,
        text: replyText,
        inReplyToInboundId: inbound._id,
        partIndex,
      })
    );
  }

  if (!replyText && mediaCaption) {
    replyText = mediaCaption;
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

  const envelopePartCount = partSendResults.length;
  if (envelopePartCount === 0) {
    return result;
  }

  const sentPartCount = partSendResults.filter((r) => r && r.success).length;
  const newlySent = partSendResults.filter((r) => r && r.success && !r.duplicatePrevented).length;
  // A successful final part must not hide a middle failure.
  const allPartsOk = partSendResults.every((r) => r && r.success);

  return {
    ...(result && typeof result === 'object' ? result : {}),
    success: allPartsOk,
    envelopePartCount,
    sentPartCount,
    newlySent,
    partResults: partSendResults,
  };
}

/**
 * Returns guided flow result when an active flow should handle this inbound, or null to continue
 * normal orchestrator routing (interrupts, idle states, etc.).
 */
async function tryRouteActiveGuidedFlow(params) {
  const { botState, inbound, multilingualInbound, activeConversation } = params;
  const flow = resolveActiveGuidedFlow(botState);
  if (!flow) return null;

  const routingText = multilingualInbound?.englishMessage || String(inbound.text || '').trim();
  if (isGuidedFlowInterrupt(routingText, inbound.text)) {
    logCareerJourneyInterrupt(flow, botState, routingText);
    return null;
  }

  // Live V3 canary: do not sticky-route mid-conversation V2. Falling through lets
  // the orchestrator remap career_counselling_flow_v2(_continue) → V3. Without this,
  // phones already in V2 never reach resolveFlowV3Routing (canary looks "dead").
  if (flow.id === 'career_counselling_flow_v2') {
    try {
      const { resolveFlowV3Routing } = require('../flowV3LLM/flowV3Rollout');
      const routing = resolveFlowV3Routing({
        phone: activeConversation?.phone,
        pinnedEngine: botState?.context?.flowV3?.engine || null,
        pinnedMode: botState?.context?.flowV3?.mode || null,
      });
      if (routing.useV3 && routing.mode === 'live') {
        return null;
      }
    } catch (err) {
      console.warn('[flowV3] sticky V2 yield check failed', err?.message || err);
    }
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
  compactWhatsAppSpacing,
  executeActiveGuidedFlowTurn,
  tryRouteActiveGuidedFlow,
  applyGuidedFlowSwitchTurn,
  getGuidedFlowByIntent,
};
