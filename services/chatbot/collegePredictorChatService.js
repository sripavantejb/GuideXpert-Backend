const { normalizeText } = require('./intentClassifierService');
const { fetchCollegeDostColleges } = require('../collegePredictorCore');
const {
  EXAM_AP,
  EXAM_TS,
  EXAM_MHT,
  initialContext,
  isApOcMaleBlocked,
  AP_OC_MALE_BLOCKED_REPLY,
  formatPredictionReply,
} = require('../../constants/whatsappCollegePredictor');
const { resolveApTsReservationCode } = require('./whatsappCollegePredictor/apTs');
const { logChatbotEvent } = require('./chatbotStructuredLog');
const { extractSlotsFromMessage } = require('./whatsappCollegePredictor/collegePredictorSlotExtractor');
const {
  getMissingSlots,
  isPredictionReady,
  clearDependentSlots,
  buildPredictionContext,
  slotToLegacyStep,
} = require('./whatsappCollegePredictor/collegePredictorSlots');
const {
  buildConversationalWelcome,
  buildQuestionForSlot,
  buildInvalidMessage,
  buildPredictingMessage,
} = require('./whatsappCollegePredictor/collegePredictorConversation');
const { SLOT_EXAM } = require('./whatsappCollegePredictor/collegePredictorSlots');
const {
  buildPredictionHash,
  buildPredictionCompletion,
  findCompletedPrediction,
} = require('./whatsappCollegePredictor/predictionIdempotency');
const {
  getInboundPredictionCompletion,
  claimInboundPredictionCompletion,
} = require('./whatsappCollegePredictor/collegePredictionIdempotencyService');

function isNeutralPredictorEntry(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return true;
  if (
    /^(hi|hello|hey|help|start|menu|again|predict|college predictor|i want to predict|want to predict|predict my colleges|predict colleges)$/.test(
      t
    )
  ) {
    return true;
  }
  return /college prediction|predict colleges|college predictor|help me with college|can you predict|need college/i.test(
    t
  );
}

let fetchCollegeDostCollegesFn = fetchCollegeDostColleges;
let logEventFn = logChatbotEvent;

function setCollegePredictorDeps(deps = {}) {
  if (deps.fetchCollegeDostColleges) {
    fetchCollegeDostCollegesFn = deps.fetchCollegeDostColleges;
  } else if (deps.getPredictedColleges) {
    fetchCollegeDostCollegesFn = (exam, offset, limit, body) =>
      deps.getPredictedColleges(exam, offset, limit, body);
  } else {
    fetchCollegeDostCollegesFn = fetchCollegeDostColleges;
  }
  logEventFn = deps.logChatbotEvent || logChatbotEvent;
}

/** Same request shape as counsellor POST /api/counsellor/college-predictor/colleges */
function buildCounsellorStyleRequestBody(ctx) {
  const body = { exam: ctx.exam };
  if (ctx.rank != null) body.rank = ctx.rank;
  if (ctx.cutoff_from != null) body.cutoff_from = ctx.cutoff_from;
  if (ctx.cutoff_to != null) body.cutoff_to = ctx.cutoff_to;
  if (Array.isArray(ctx.reservation_category_codes)) {
    body.reservation_category_codes = ctx.reservation_category_codes;
  }
  if (ctx.admission_category_name_enum) {
    body.admission_category_name_enum = ctx.admission_category_name_enum;
  }
  if (ctx.quota) body.quota = ctx.quota;
  return body;
}

function syncApTsReservationCodes(ctx) {
  if ((ctx.exam !== EXAM_AP && ctx.exam !== EXAM_TS) || !ctx.categoryN || !ctx.gender) {
    return ctx;
  }
  const code = resolveApTsReservationCode(ctx.exam, ctx.categoryN, ctx.gender);
  if (!code) return ctx;
  return { ...ctx, reservation_category_codes: [code] };
}

function applyExtractedSlots(ctx, extracted) {
  if (!extracted || !Object.keys(extracted).length) return { ...ctx };

  let next = { ...ctx };

  if (extracted.exam) {
    if (next.exam && extracted.exam !== next.exam) {
      next = { ...clearDependentSlots(next, false), exam: extracted.exam, conversational: true };
    } else {
      next.exam = extracted.exam;
    }
  }

  if (extracted.rank != null) next.rank = extracted.rank;
  if (extracted.percentile != null) next.percentile = extracted.percentile;
  if (extracted.admissionType) {
    next.admissionType = extracted.admissionType;
    next.admission_category_name_enum = extracted.admission_category_name_enum;
  }
  if (extracted.categoryLabel) {
    next.categoryLabel = extracted.categoryLabel;
    next.categoryN = extracted.categoryN;
    next.baseCategory = extracted.baseCategory;
  }
  if (extracted.gender) next.gender = extracted.gender;
  if (extracted.quota) next.quota = extracted.quota;
  if (extracted.admission_category_name_enum && next.exam === EXAM_AP) {
    next.admission_category_name_enum = extracted.admission_category_name_enum;
  }

  if (next.exam && next.exam !== EXAM_MHT) {
    delete next.percentile;
  }
  if (next.exam === EXAM_MHT) {
    delete next.rank;
  }

  return syncApTsReservationCodes(next);
}

async function resolveCompletedPrediction(ctx, opts = {}) {
  const inboundId = opts.inboundId;
  if (!inboundId) return null;

  const fromInbound = await getInboundPredictionCompletion(inboundId);
  const inboundHit = findCompletedPrediction(fromInbound, inboundId);
  if (inboundHit) return inboundHit;

  const hash = buildPredictionHash(ctx);
  const fromContext = findCompletedPrediction(opts.predictionIdempotency, inboundId, hash);
  if (fromContext) return fromContext;

  return null;
}

function buildIdempotentPredictionResult(ctx, completed) {
  return {
    reply: completed.cachedReply,
    context: { ...ctx, step: 'done' },
    clearState: true,
    predictionIdempotency: completed,
    idempotentReplay: true,
  };
}

async function runPrediction(ctx, opts = {}) {
  const PREDICT_RETRY_REPLY =
    'We could not fetch college predictions right now. Please try again in a moment.\n\nYour details are saved — send any message to retry.';
  const PREDICT_RETRY_REPLY_AT_PREDICT =
    'We could not fetch college predictions right now. Please try again in a moment.\n\nSend any message to retry.';

  const completed = await resolveCompletedPrediction(ctx, opts);
  if (completed) {
    return buildIdempotentPredictionResult(ctx, completed);
  }

  const startedAt = Date.now();
  try {
    const data = await fetchCollegeDostCollegesFn(
      ctx.exam,
      0,
      5,
      buildCounsellorStyleRequestBody(ctx)
    );
    const colleges = data?.colleges || [];
    const results = formatPredictionReply(ctx, colleges);
    const prefix = ctx.conversational ? `${buildPredictingMessage(ctx)}\n\n` : '';
    const reply = `${prefix}${results}`;

    let predictionIdempotency = null;
    let analyticsEmitted = false;

    if (opts.inboundId) {
      const completion = buildPredictionCompletion({
        inboundId: opts.inboundId,
        ctx,
        cachedReply: reply,
        collegeCount: colleges.length,
      });
      const { record, isNewClaim } = await claimInboundPredictionCompletion(
        opts.inboundId,
        completion
      );
      predictionIdempotency = record || completion;

      if (!isNewClaim && record?.cachedReply) {
        return buildIdempotentPredictionResult(ctx, record);
      }

      if (isNewClaim) {
        logEventFn('predictor_success', {
          predictorExam: ctx.exam || null,
          rank: ctx.rank ?? ctx.percentile ?? null,
          category: ctx.categoryLabel || null,
          botState: 'college_predictor',
          collegeCount: colleges.length,
          durationMs: Date.now() - startedAt,
          idempotent: false,
        });
        analyticsEmitted = true;
      }
    } else {
      logEventFn('predictor_success', {
        predictorExam: ctx.exam || null,
        rank: ctx.rank ?? ctx.percentile ?? null,
        category: ctx.categoryLabel || null,
        botState: 'college_predictor',
        collegeCount: colleges.length,
        durationMs: Date.now() - startedAt,
        idempotent: false,
      });
      analyticsEmitted = true;
    }

    if (!analyticsEmitted && predictionIdempotency?.cachedReply) {
      return buildIdempotentPredictionResult(ctx, predictionIdempotency);
    }

    return {
      reply,
      context: { ...ctx, step: 'done' },
      clearState: true,
      predictionIdempotency,
    };
  } catch (err) {
    const upstreamStatus =
      err.http_status_code != null
        ? String(err.http_status_code)
        : err.res_status || err.code || 'predict_failed';
    logEventFn('predictor_failed', {
      predictorExam: ctx.exam || null,
      upstreamStatus,
      botState: 'college_predictor',
    });
    return {
      reply: ctx.step === 'predict' ? PREDICT_RETRY_REPLY_AT_PREDICT : PREDICT_RETRY_REPLY,
      context: { ...ctx, step: 'predict' },
    };
  }
}

/**
 * WhatsApp College Predictor — conversational slot-filling orchestrator.
 * @param {string} text
 * @param {object} context — WhatsAppBotState.context.college
 * @param {{ isNewEntry?: boolean }} [opts]
 */
async function handleCollegePredictorMessage(text, context = {}, opts = {}) {
  const t = normalizeText(text);

  if (/^again$/.test(t)) {
    return {
      reply: buildConversationalWelcome(),
      context: initialContext(),
      restart: true,
    };
  }

  if (opts.inboundId) {
    const completed = await resolveCompletedPrediction(
      { ...context, conversational: true },
      opts
    );
    if (completed) {
      return buildIdempotentPredictionResult(
        { ...context, conversational: true },
        completed
      );
    }
  }

  let ctx = opts.isNewEntry ? initialContext() : { ...context };
  if (!ctx.flow) ctx = initialContext();
  if (!ctx.step || ctx.step === 'done') ctx = initialContext();
  ctx.conversational = true;

  if (ctx.step === 'predict') {
    if (isApOcMaleBlocked(ctx.exam, ctx.categoryN, ctx.gender)) {
      return {
        reply: AP_OC_MALE_BLOCKED_REPLY,
        context: { ...ctx, step: 'done' },
        clearState: true,
      };
    }
    return await runPrediction(ctx, opts);
  }

  const beforeMissing = getMissingSlots(ctx);
  const extracted = extractSlotsFromMessage(text, ctx);
  const merged = applyExtractedSlots(ctx, extracted);
  const afterMissing = getMissingSlots(merged);

  const trimmed = String(text || '').trim();
  if (
    beforeMissing.length > 0 &&
    afterMissing.length > 0 &&
    beforeMissing[0] === afterMissing[0] &&
    trimmed &&
    Object.keys(extracted).length === 0
  ) {
    if (beforeMissing[0] === SLOT_EXAM && isNeutralPredictorEntry(text)) {
      return {
        reply: buildConversationalWelcome(),
        context: { ...merged, step: 'exam', conversational: true },
      };
    }
    return {
      reply: buildInvalidMessage(beforeMissing[0], merged),
      context: { ...merged, step: slotToLegacyStep(beforeMissing[0]), conversational: true },
    };
  }

  ctx = merged;

  if (ctx.exam === EXAM_AP && ctx.gender && isApOcMaleBlocked(ctx.exam, ctx.categoryN, ctx.gender)) {
    return {
      reply: AP_OC_MALE_BLOCKED_REPLY,
      context: { ...ctx, step: 'done' },
      clearState: true,
    };
  }

  if (!isPredictionReady(ctx)) {
    const nextSlot = getMissingSlots(ctx)[0];
    const reply =
      opts.isNewEntry && nextSlot === SLOT_EXAM && isNeutralPredictorEntry(text)
        ? buildConversationalWelcome()
        : buildQuestionForSlot(nextSlot, ctx);
    return {
      reply,
      context: { ...ctx, step: slotToLegacyStep(nextSlot), conversational: true },
    };
  }

  const built = buildPredictionContext(ctx);
  if (built.blocked) {
    return {
      reply: AP_OC_MALE_BLOCKED_REPLY,
      context: { ...ctx, step: 'done' },
      clearState: true,
    };
  }
  if (built.error) {
    const slot = getMissingSlots(ctx)[0] || 'category';
    return {
      reply: built.error,
      context: { ...ctx, step: slotToLegacyStep(slot), conversational: true },
    };
  }

  return await runPrediction(built.ctx, opts);
}

module.exports = {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
  buildCounsellorStyleRequestBody,
  runPrediction,
  resolveCompletedPrediction,
};
