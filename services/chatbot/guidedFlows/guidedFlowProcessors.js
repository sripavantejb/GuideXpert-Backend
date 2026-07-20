'use strict';

const { emptySubflows } = require('../botSubflowContext');
const { handleCollegePredictorMessage } = require('../collegePredictorChatService');
const { handleRankPredictorMessage } = require('../rankPredictorChatService');
const {
  handleCareerCounsellingMessage,
} = require('../careerCounselling/careerCounsellingJourneyService');
const { isCareerCounsellingV2Enabled } = require('../../../constants/careerCounsellingV2Discovery');
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
const {
  upsertFromTurn,
} = require('../../conversationRecovery/conversationRecoverySnapshotService');
const {
  markPostRecoveryOutcomesFromSnapshot,
} = require('../../conversationRecovery/conversationRecoveryResumeService');

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
  preferredCollege = null,
}) {
  let collegeCtx = contextPatch.college || {};
  if (preferredCollege) {
    collegeCtx = { ...collegeCtx, preferredCollege };
  }
  const c = await handleCollegePredictorMessage(inboundText, collegeCtx, {
    isNewEntry,
    inboundId: inbound._id,
    predictionIdempotency: contextPatch.predictionIdempotency || null,
    preferredCollege: preferredCollege || collegeCtx.preferredCollege || null,
  });

  // Bridge into Career Counselling V2 compare / concern with seeded colleges
  if (c.bridgeToCareerCounselling && c.bridgeSeed) {
    const seed = c.bridgeSeed;
    const { processSmartComparisonTurn } = require('../careerCounselling/careerCounsellingV2ComparisonEngine');
    const { processConcernResolutionTurn } = require('../careerCounselling/careerCounsellingV2ConcernResolutionEngine');
    const { finalizeCounselingResult } = require('../careerCounselling/careerCounsellingJourneyService');

    let bridged;
    if (seed.stage === 'smart_comparison') {
      bridged = await processSmartComparisonTurn(inboundText, seed, {
        startSmartComparison: true,
        analytics: { source: 'college_predictor_bridge' },
      });
    } else {
      bridged = await processConcernResolutionTurn(inboundText, seed, {
        startConcernResolution: true,
        analytics: { source: 'college_predictor_bridge' },
      });
    }
    const finalized = finalizeCounselingResult(bridged, inboundText);

    return {
      replyText: finalized.reply,
      replyParts: finalized.replyParts || null,
      nextState: 'career_counselling_v2',
      contextPatch: clearAssistantSessionFlags({
        ...contextPatch,
        college: {},
        collegePredictorActive: false,
        currentJourney: 'CAREER_COUNSELLING',
        careerCounselling: finalized.context,
        predictionIdempotency: null,
      }),
      intent: 'career_counselling_journey_continue',
      localizationTier: 'translate',
    };
  }

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
      collegePredictorActive: false,
      currentJourney: null,
    });
    nextState = flow.completeBotState;
  } else {
    // Full replace each turn (mergeContext treats college atomically) so AGAIN/restart
    // cannot leave stale admission_category / resultCache from a prior prediction.
    nextContext.college = c.context;
    nextContext.collegePredictorActive = true;
    nextContext.currentJourney = 'COLLEGE_PREDICTOR';
    if (c.predictionIdempotency) {
      nextContext.predictionIdempotency = c.predictionIdempotency;
    }
    if (c.restart || isNewEntry) {
      nextContext.predictionIdempotency = null;
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

async function processCareerCounsellingTurn({
  flow,
  inboundText,
  contextPatch,
  isNewEntry = false,
  analytics = {},
  preferredLanguage = null,
  phone = null,
  conversationId = null,
}) {
  if (!isCareerCounsellingV2Enabled()) {
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

  const result = await handleCareerCounsellingMessage(
    inboundText,
    contextPatch.careerCounselling || {},
    { isNewEntry, analytics, preferredLanguage }
  );

  // Persist counseling language choice onto WhatsApp conversation (sticky).
  if (result.syncConversationLanguage && conversationId) {
    try {
      const {
        updatePreferredLanguage,
      } = require('../conversationLanguageService');
      await updatePreferredLanguage(conversationId, result.syncConversationLanguage);
    } catch (_) {
      /* non-blocking */
    }
  } else if (
    result.context?.counselingSessionLanguage &&
    conversationId &&
    result.context.counselingSessionLanguage !== contextPatch.careerCounselling?.counselingSessionLanguage
  ) {
    try {
      const {
        updatePreferredLanguage,
      } = require('../conversationLanguageService');
      await updatePreferredLanguage(conversationId, result.context.counselingSessionLanguage);
    } catch (_) {
      /* non-blocking */
    }
  }

  const nextContext = clearAssistantSessionFlags({
    ...contextPatch,
    careerCounselling: result.context,
  });

  const resolvedPhone = phone || analytics.phone || null;
  const resolvedConversationId =
    conversationId || analytics.conversationId || null;
  if (resolvedPhone && resolvedConversationId && result.context) {
    try {
      const snapshot = await upsertFromTurn({
        phone: resolvedPhone,
        conversationId: resolvedConversationId,
        context: result.context,
      });
      if (snapshot) {
        await markPostRecoveryOutcomesFromSnapshot(snapshot).catch(() => {});
      }
    } catch (err) {
      console.warn(
        '[conversationRecovery] snapshot upsert failed:',
        err?.message || err
      );
    }
  }

  return {
    replyText: result.reply,
    replyParts: Array.isArray(result.replyParts) ? result.replyParts : null,
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

async function processGuidedFlowTurn({
  flow,
  inboundText,
  inbound,
  contextPatch,
  isNewEntry = false,
  resolvedLanguage = 'en',
  intent = null,
  phone = null,
  conversationId = null,
  preferredCollege = null,
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
      return processCollegePredictorTurn({
        flow,
        inboundText,
        inbound,
        contextPatch,
        isNewEntry,
        preferredCollege,
      });
    case 'rank_predictor':
      return processRankPredictorTurn({ flow, inboundText, contextPatch });
    case 'career_counselling_v2':
      return await processCareerCounsellingTurn({
        flow,
        inboundText,
        contextPatch,
        isNewEntry,
        preferredLanguage: resolvedLanguage,
        phone,
        conversationId: conversationId || inbound?.conversationId || null,
        analytics: {
          conversationId: conversationId || inbound?.conversationId || null,
          phone: phone || null,
        },
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
  processFaqTurn,
};
