'use strict';

const { emptySubflows } = require('../botSubflowContext');
const { handleCollegePredictorMessage } = require('../collegePredictorChatService');
const { handleRankPredictorMessage } = require('../rankPredictorChatService');
const {
  handleCareerCounsellingMessage,
} = require('../careerCounselling/careerCounsellingJourneyService');
const { isCareerCounsellingJourneyEnabled } = require('../../../constants/careerCounsellingJourney');
const faqService = require('../faqService');
const { resolveSystemReply } = require('../../../constants/localizedSystemReplies');
const {
  resolveCollegePredictorRankQueryUnavailableReply,
  resolveCollegePredictorMaintenanceReply,
} = require('../../../constants/collegePredictorUnavailableReplies');
const {
  isRankBranchCollegePredictorQuery,
} = require('../intentClassifierService');
const { normalizeText } = require('../intentTextUtils');

/** Clears sticky assistant session flags while preserving guided subflow context. */
function clearAssistantSessionFlags(contextPatch) {
  return {
    ...contextPatch,
    knowledgeAssistantActive: false,
    counsellorProgramAssistantActive: false,
    counsellorProgramSessionLanguage: null,
    iitCounsellingExpertActive: false,
    iitCounsellingExpertSessionLanguage: null,
    iitCounsellingStrategyActive: false,
    iitCounsellingStrategySessionLanguage: null,
  };
}

function isCollegePredictorEnabled() {
  return true;
}

async function processCollegePredictorTurn({
  flow,
  inboundText,
  inbound,
  contextPatch,
  isNewEntry = false,
}) {
  const c = await handleCollegePredictorMessage(inboundText, contextPatch.college || {}, {
    isNewEntry,
    inboundId: inbound._id,
    predictionIdempotency: contextPatch.predictionIdempotency || null,
  });

  let nextState = flow.botState;
  let nextContext = clearAssistantSessionFlags({ ...contextPatch });

  if (c.predictionIdempotency) {
    nextContext.predictionIdempotency = c.predictionIdempotency;
    if (c.clearState) {
      nextContext.college = {};
    }
  }

  if (c.clearState) {
    nextContext = clearAssistantSessionFlags({
      college: {},
      predictionIdempotency: null,
    });
    nextState = flow.completeBotState;
  } else {
    nextContext.college = c.context;
    if (c.predictionIdempotency) {
      nextContext.predictionIdempotency = c.predictionIdempotency;
    }
  }

  return {
    replyText: c.reply,
    nextState,
    contextPatch: nextContext,
    intent: isNewEntry ? 'college_predictor' : flow.continueIntent,
    predictionIdempotency: c.predictionIdempotency || null,
    persistIdempotencyBeforeComplete: Boolean(c.predictionIdempotency),
    clearCollegeOnIdempotencyPersist: Boolean(c.clearState),
  };
}

function processRankPredictorTurn({ flow, inboundText, contextPatch }) {
  const r = handleRankPredictorMessage(inboundText, contextPatch.rank || {});
  let nextState = flow.botState;
  const nextContext = clearAssistantSessionFlags({
    ...contextPatch,
    rank: r.context,
  });

  if (r.context?.step === 'done') {
    nextState = flow.completeBotState;
  }

  return {
    replyText: r.reply,
    nextState,
    contextPatch: nextContext,
    intent: flow.continueIntent,
  };
}

function processCareerCounsellingTurn({
  flow,
  inboundText,
  contextPatch,
  isNewEntry = false,
  analytics = {},
}) {
  if (!isCareerCounsellingJourneyEnabled()) {
    return {
      replyText:
        'Career counselling guidance is temporarily unavailable. Please try again later or type MENU.',
      nextState: 'main_menu',
      contextPatch: emptySubflows(),
      intent: 'career_counselling_journey',
      preLocalized: true,
      localizationTier: 'static',
    };
  }

  const result = handleCareerCounsellingMessage(
    inboundText,
    contextPatch.careerCounselling || {},
    { isNewEntry, analytics }
  );

  const nextContext = clearAssistantSessionFlags({
    ...contextPatch,
    careerCounselling: result.context,
  });

  return {
    replyText: result.reply,
    nextState: flow.botState,
    contextPatch: nextContext,
    intent: isNewEntry ? 'career_counselling_journey' : flow.continueIntent,
  };
}

async function processFaqTurn({
  flow,
  inboundText,
  inbound,
  contextPatch,
  resolvedLanguage,
  intent,
  isNewEntry = false,
}) {
  let replyText = resolveSystemReply('faqPrompt', resolvedLanguage);
  let nextState = flow.botState;

  const shouldSearch =
    (intent === 'faq_query' && (inbound.text || inboundText)) ||
    (!isNewEntry && intent === flow.continueIntent && (inbound.text || inboundText));

  if (shouldSearch) {
    const staticHits = faqService.searchStaticFaq(inbound.text || inboundText);
    const blogHits = await faqService.searchBlog(inbound.text || inboundText);
    replyText = await faqService.formatFaqAnswerAsync(staticHits, blogHits, inbound.text || inboundText);
    nextState = flow.completeBotState;
  }

  return {
    replyText,
    nextState,
    contextPatch: clearAssistantSessionFlags({ ...contextPatch }),
    intent: intent || flow.continueIntent,
    preLocalized: true,
    localizationTier: 'static',
  };
}

async function processCareerCounsellingFlowV2Turn({
  inboundText,
  inbound,
  contextPatch,
  isNewEntry = false,
  leadContext = null,
  phone = null,
}) {
  const { processFlowV2Turn } = require('../flowV2/flowV2Dispatcher');
  const flowV2 = contextPatch.flowV2 || { stage: null, profile: null };
  const ctx = {
    conversationId: inbound?.conversationId || null,
    phone: phone || null,
    leadContext: leadContext || null,
    flowV2: {
      ...flowV2,
      inboundId: inbound?._id ? String(inbound._id) : null,
      predictionIdempotency: flowV2.predictionIdempotency || contextPatch.predictionIdempotency || null,
    },
  };

  if (isNewEntry && !ctx.flowV2.stage) {
    ctx.flowV2.stage = null;
  }

  const result = await processFlowV2Turn(ctx, inboundText, {
    messageType: inbound?.messageType || 'text',
  });

  const nextFlowV2 = {
    ...flowV2,
    ...(result.contextPatch || {}),
    profile: (result.contextPatch && result.contextPatch.profile) || flowV2.profile || null,
    stage:
      result.contextPatch && Object.prototype.hasOwnProperty.call(result.contextPatch, 'stage')
        ? result.contextPatch.stage
        : flowV2.stage,
  };

  // Shadow mode: V2 still owns the student reply; V3 logs would-be envelope only.
  maybeRunFlowV3Shadow({
    phone,
    inboundText,
    inbound,
    conversationId: inbound?.conversationId || null,
    contextPatch,
  });

  return {
    replyText: result.replyText,
    replyParts: result.replyParts,
    replyMedia: result.replyMedia || null,
    interactive: result.interactive || null,
    nextState: result.nextState || 'career_counselling_flow_v2',
    contextPatch: clearAssistantSessionFlags({
      ...contextPatch,
      flowV2: nextFlowV2,
      ...(result.contextPatch?.predictionIdempotency
        ? { predictionIdempotency: result.contextPatch.predictionIdempotency }
        : {}),
      // Pin V2 when live canary is on but this phone missed — raising % later
      // must not migrate mid-conversation.
      ...(shouldPinFlowV2(contextPatch, phone)
        ? { flowV3: { engine: 'flow_v2', mode: null } }
        : {}),
    }),
    intent: result.intent || 'career_counselling_flow_v2',
    pendingSideEffect: result.pendingSideEffect || null,
    // Master Flow v2 is English-only — never translate Rithika copy.
    localizationTier: 'static',
    preLocalized: true,
  };
}

function shouldPinFlowV2(contextPatch, phone) {
  const { resolveFlowV3Routing, isFlowV3Enabled, getFlowV3Mode } = require('../flowV3LLM/flowV3Rollout');
  if (!isFlowV3Enabled() || getFlowV3Mode() !== 'live') return false;
  if (contextPatch?.flowV3?.engine) return false;
  const routing = resolveFlowV3Routing({ phone });
  return !routing.useV3;
}

function maybeRunFlowV3Shadow({ phone, inboundText, inbound, conversationId, contextPatch }) {
  try {
    const { resolveFlowV3Routing } = require('../flowV3LLM/flowV3Rollout');
    const routing = resolveFlowV3Routing({
      phone,
      pinnedEngine: contextPatch?.flowV3?.engine || null,
      pinnedMode: contextPatch?.flowV3?.mode || null,
    });
    if (!routing.useV3 || routing.mode !== 'shadow') return;
    const { processFlowV3Turn } = require('../flowV3LLM/flowV3Dispatcher');
    const { resolveWaitUntil } = require('../flowV3LLM/log/flushTurnLog');
    // F-9/F-3: a bare floating promise dies with the serverless freeze —
    // register the shadow turn with waitUntil so it actually completes.
    // Failures are logged visibly either way.
    const shadowTurn = processFlowV3Turn({
      text: inboundText,
      phone,
      conversationId: conversationId || inbound?.conversationId || null,
      inboundId: inbound?._id ? String(inbound._id) : null,
      profile: contextPatch?.flowV3?.profile || {},
      slotMeta: contextPatch?.flowV3?.slotMeta || {},
      promptVersion: contextPatch?.flowV3?.promptVersion || null,
      mode: 'shadow',
      history: contextPatch?.flowV3?.history || [],
    }).catch((err) => {
      console.error('[flowV3] SHADOW_TURN_FAILED', { error: err?.message || String(err) });
    });
    const waitUntil = resolveWaitUntil();
    if (typeof waitUntil === 'function') {
      try {
        waitUntil(shadowTurn);
      } catch {
        // outside a request context waitUntil can refuse — the catch above
        // still surfaces failures; shadow output is advisory by design.
      }
    }
  } catch (err) {
    console.warn('[flowV3] shadow wiring failed', err?.message || err);
  }
}

async function processCareerCounsellingFlowV3Turn({
  inboundText,
  inbound,
  contextPatch,
  isNewEntry = false,
  leadContext = null,
  phone = null,
}) {
  const { processFlowV3Turn } = require('../flowV3LLM/flowV3Dispatcher');
  const { resolvePinnedVersion } = require('../flowV3LLM/llm/promptLoader');
  let profile = contextPatch?.flowV3?.profile || {};
  let slotMeta = contextPatch?.flowV3?.slotMeta || {};
  let casVersion = contextPatch?.flowV3?.casVersion ?? null;

  if (phone) {
    try {
      const { loadLeadProfile, ensureLeadProfile } = require('../flowV3LLM/profile');
      let loaded = await loadLeadProfile(phone);
      if (!loaded) {
        // Create-if-missing regardless of isNewEntry: conversations upgraded
        // from V2 mid-flight enter with isNewEntry=false, and without a durable
        // doc every extractor CAS write fails with not_found (slots lost).
        loaded = await ensureLeadProfile(phone, {});
      }
      if (loaded) {
        profile = loaded.profile || profile;
        slotMeta = loaded.slotMeta || slotMeta;
        casVersion = loaded.casVersion ?? casVersion;
      }
    } catch (err) {
      console.warn('[flowV3] profile load failed', err?.message || err);
    }
  }

  const promptVersion = resolvePinnedVersion(contextPatch?.flowV3?.promptVersion || null);
  const mode = 'live';

  const result = await processFlowV3Turn({
    text: inboundText,
    phone,
    conversationId: inbound?.conversationId || null,
    inboundId: inbound?._id ? String(inbound._id) : null,
    profile,
    slotMeta,
    casVersion,
    promptVersion,
    mode,
    history: contextPatch?.flowV3?.history || [],
    deps: { leadContext },
  });

  // A-1: the crisis gate signals setCrisisLocked but nothing persisted it, so
  // the LLM ran again on the very next turn of a crisis conversation. The lock
  // is permanent by contract — write it to the durable profile (system
  // channel; the merge layer refuses to ever unset it).
  if (phone && result.terminal?.setCrisisLocked === true) {
    try {
      const { casUpdateLeadProfile } = require('../flowV3LLM/profile');
      const lockOutcome = await casUpdateLeadProfile({
        phone,
        expectedVersion: null,
        profilePatch: { crisisLocked: true },
        metaByPath: { crisisLocked: { source: 'system' } },
        channel: 'system',
        turnId: result.turnId || null,
      });
      if (!lockOutcome.ok) {
        console.error('[flowV3] CRISIS_LOCK_PERSIST_FAILED', {
          turnId: result.turnId,
          reason: lockOutcome.reason,
          rejected: lockOutcome.rejected || null,
        });
      }
    } catch (err) {
      console.error('[flowV3] CRISIS_LOCK_PERSIST_FAILED', {
        turnId: result.turnId,
        error: err?.message || String(err),
      });
    }
  }

  // §3 step 6 persistence (F-7): the dispatcher merged the deterministic
  // extraction in-memory; persist it here through the CAS store so the durable
  // profile matches what the turn was gated and answered against. Channel
  // 'extractor' with authoritative 'extracted' capture meta per the contract.
  //
  // Conflict retry: a model tool-write mid-turn bumps the CAS version, which
  // made this persist fail with cas_conflict and silently DROP the student's
  // actual answer (conformance finding 5). One retry against the fresh
  // version returned by the conflict is safe — the merge layer is additive.
  let persistedProfile = profile;
  async function persistPatch(label, { profilePatch, metaByPath, channel, enforceLlmAllowlist }) {
    if (!phone || !Object.keys(profilePatch).length) return;
    try {
      const { casUpdateLeadProfile } = require('../flowV3LLM/profile');
      let writeOutcome = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        writeOutcome = await casUpdateLeadProfile({
          phone,
          expectedVersion: casVersion,
          profilePatch,
          metaByPath,
          ...(channel ? { channel } : {}),
          ...(enforceLlmAllowlist ? { enforceLlmAllowlist: true } : {}),
          turnId: result.turnId || null,
        });
        if (writeOutcome.ok || writeOutcome.reason !== 'cas_conflict') break;
        const freshVersion = writeOutcome.doc?.casVersion;
        if (freshVersion == null || freshVersion === casVersion) break;
        casVersion = freshVersion;
      }
      if (writeOutcome?.ok) {
        persistedProfile = writeOutcome.doc?.profile || persistedProfile;
        slotMeta = writeOutcome.doc?.slotMeta || slotMeta;
        casVersion = writeOutcome.doc?.casVersion ?? casVersion;
      } else {
        console.error(`[flowV3] ${label} persist failed`, {
          turnId: result.turnId,
          reason: writeOutcome?.reason,
          rejected: writeOutcome?.rejected || null,
        });
      }
    } catch (err) {
      console.error(`[flowV3] ${label} persist failed`, {
        turnId: result.turnId,
        error: err?.message || String(err),
      });
    }
  }

  const extractedPatch = result.extractedPatch || {};
  if (Object.keys(extractedPatch).length) {
    const metaByPath = {};
    for (const key of Object.keys(extractedPatch)) {
      metaByPath[key] = { source: 'extracted', verbatimQuote: String(inboundText || '') };
    }
    await persistPatch('extractor patch', {
      profilePatch: extractedPatch,
      metaByPath,
      channel: 'extractor',
    });
  }

  // F-6: persist the allowlist-accepted envelope.profile_patch through the
  // same CAS path as the update_lead_profile tool (channel llm_tool, strict
  // allowlist). The dispatcher already filtered it; this write enforces the
  // policy again at the store boundary.
  const llmAccepted = result.llmPatch?.accepted || {};
  if (Object.keys(llmAccepted).length) {
    await persistPatch('llm profile patch', {
      profilePatch: llmAccepted,
      metaByPath: result.llmPatch.acceptedMeta || {},
      enforceLlmAllowlist: true,
    });
  }

  // Conversation history for the LLM context. Nothing ever WROTE history, so
  // the model saw only the profile and the current message on every turn — it
  // could not know it had already asked a question, and re-asked the same
  // slot forever instead of saving the student's answer. 16 entries = the
  // architecture's 8-turn window (§9.2); the context builder trims further.
  const HISTORY_MAX_ENTRIES = 16;
  const priorHistory = Array.isArray(contextPatch?.flowV3?.history)
    ? contextPatch.flowV3.history
    : [];
  const replyTextForHistory = result.silent
    ? null
    : result.replyText ||
      (Array.isArray(result.replyParts) ? result.replyParts.filter(Boolean).join('\n') : null);
  const history = [
    ...priorHistory,
    { role: 'user', text: String(inboundText || ''), at: new Date().toISOString() },
    ...(replyTextForHistory
      ? [{ role: 'assistant', text: replyTextForHistory, at: new Date().toISOString() }]
      : []),
  ].slice(-HISTORY_MAX_ENTRIES);

  const nextFlowV3 = {
    ...(contextPatch.flowV3 || {}),
    engine: 'flow_v3',
    mode: 'live',
    promptVersion,
    profile: persistedProfile,
    slotMeta,
    casVersion,
    history,
    lastTurnId: result.turnId,
    ...(result.contextPatch?.flowV3 || {}),
  };

  return {
    replyText: result.silent ? null : result.replyText,
    replyParts: result.silent ? null : result.replyParts,
    replyMedia: result.silent ? null : result.replyMedia || null,
    interactive: result.silent ? null : result.interactive || null,
    nextState: result.nextState || 'career_counselling_flow_v3',
    contextPatch: clearAssistantSessionFlags({
      ...contextPatch,
      flowV3: nextFlowV3,
    }),
    intent: result.intent || 'career_counselling_flow_v3',
    silent: Boolean(result.silent),
    localizationTier: 'static',
    preLocalized: true,
  };
}

async function processGuidedFlowTurn({
  flow,
  inboundText,
  inbound,
  contextPatch,
  isNewEntry = false,
  resolvedLanguage = 'en',
  intent = null,
  leadContext = null,
  phone = null,
}) {
  switch (flow.id) {
    case 'college_predictor':
      if (!isCollegePredictorEnabled()) {
        const rankBranchCheckText = normalizeText(inboundText);
        return {
          replyText: isRankBranchCollegePredictorQuery(rankBranchCheckText, inbound.text)
            ? resolveCollegePredictorRankQueryUnavailableReply(resolvedLanguage)
            : resolveCollegePredictorMaintenanceReply(resolvedLanguage),
          nextState: 'main_menu',
          contextPatch: emptySubflows(),
          intent: 'college_predictor',
          preLocalized: true,
          localizationTier: 'static',
        };
      }
      return processCollegePredictorTurn({ flow, inboundText, inbound, contextPatch, isNewEntry });
    case 'rank_predictor':
      return processRankPredictorTurn({ flow, inboundText, contextPatch });
    case 'career_counselling_journey':
      return processCareerCounsellingTurn({
        flow,
        inboundText,
        contextPatch,
        isNewEntry,
        analytics: {
          conversationId: inbound?.conversationId || null,
        },
      });
    case 'career_counselling_flow_v2':
      return await processCareerCounsellingFlowV2Turn({
        inboundText,
        inbound,
        contextPatch,
        isNewEntry,
        leadContext,
        phone,
      });
    case 'career_counselling_flow_v3':
      return await processCareerCounsellingFlowV3Turn({
        inboundText,
        inbound,
        contextPatch,
        isNewEntry,
        leadContext,
        phone,
      });
    case 'faq':
      return processFaqTurn({
        flow,
        inboundText,
        inbound,
        contextPatch,
        resolvedLanguage,
        intent: intent || (isNewEntry ? flow.entryIntents[0] : flow.continueIntent),
        isNewEntry,
      });
    default:
      throw new Error(`No processor registered for guided flow: ${flow.id}`);
  }
}

module.exports = {
  clearAssistantSessionFlags,
  processGuidedFlowTurn,
  processCollegePredictorTurn,
  processRankPredictorTurn,
  processCareerCounsellingTurn,
  processCareerCounsellingFlowV2Turn,
  processCareerCounsellingFlowV3Turn,
  processFaqTurn,
  maybeRunFlowV3Shadow,
};
