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
}) {
  const { processFlowV2Turn } = require('../flowV2/flowV2Dispatcher');
  const flowV2 = contextPatch.flowV2 || { stage: null, profile: null };
  const ctx = {
    conversationId: inbound?.conversationId || null,
    phone: null,
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

  return {
    replyText: result.replyText,
    replyParts: result.replyParts,
    interactive: result.interactive || null,
    nextState: result.nextState || 'career_counselling_flow_v2',
    contextPatch: clearAssistantSessionFlags({
      ...contextPatch,
      flowV2: nextFlowV2,
      ...(result.contextPatch?.predictionIdempotency
        ? { predictionIdempotency: result.contextPatch.predictionIdempotency }
        : {}),
    }),
    intent: result.intent || 'career_counselling_flow_v2',
    pendingSideEffect: result.pendingSideEffect || null,
    localizationTier: 'translate',
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
  processFaqTurn,
};
