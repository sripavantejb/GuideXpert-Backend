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
  SLOT_EXAM,
  SLOT_RANK,
  SLOT_PERCENTILE,
  SLOT_ADMISSION_TYPE,
  SLOT_CATEGORY,
  SLOT_GENDER,
  SLOT_QUOTA,
  SLOT_REGION,
} = require('./whatsappCollegePredictor/collegePredictorSlots');
const {
  buildConversationalWelcome,
  buildQuestionForSlot,
  buildInvalidMessage,
  buildPredictingMessage,
} = require('./whatsappCollegePredictor/collegePredictorConversation');
const {
  buildPredictionHash,
  buildPredictionCompletion,
  findCompletedPrediction,
} = require('./whatsappCollegePredictor/predictionIdempotency');
const {
  getInboundPredictionCompletion,
  claimInboundPredictionCompletion,
} = require('./whatsappCollegePredictor/collegePredictionIdempotencyService');
const {
  classifyPredictorError,
  logPredictorPipeline,
  previewText,
} = require('./whatsappCollegePredictor/collegePredictorPipelineLog');
const {
  PAGE_SIZE,
  isShowMoreRequest,
  isTopCollegesRequest,
  isPredictorRestartRequest,
  isPredictorFollowUpAction,
  resolveBranchFilter,
  resolveOwnershipFilter,
  filterCollegesLocally,
  slicePage,
} = require('./whatsappCollegePredictor/collegePredictorSessionService');

function isNeutralPredictorEntry(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return true;
  // Bare main-menu College Predictor digit ("5") must not be treated as an exam option.
  if (/^5$/.test(t)) return true;
  if (
    /^(hi|hello|hey|help|start|menu|again|predict|college predictor|i want to predict|want to predict|predict my colleges|predict colleges)$/.test(
      t
    )
  ) {
    return true;
  }
  return /college prediction|predict colleges|college predictor|help me with college|can you predict|need college|show colleges|which colleges|suggest colleges/i.test(
    t
  );
}

/** Main-menu College Predictor digit (iit_counselling menu option 5). Must not select KEAM. */
function isMainMenuEntryDigit(text) {
  return /^5$/.test(String(text || '').trim());
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

function applyExtractedSlots(ctx, extracted, focusSlot = null) {
  if (!extracted || !Object.keys(extracted).length) return { ...ctx };

  let next = { ...ctx };

  const canWrite = (slot, currentlyFilled) => !currentlyFilled || focusSlot === slot;

  if (extracted.exam) {
    if (next.exam && extracted.exam !== next.exam) {
      next = { ...clearDependentSlots(next, false), exam: extracted.exam, conversational: true };
    } else {
      next.exam = extracted.exam;
    }
  }

  // Slot locking: once a validated value is stored, later menu digits must not overwrite it
  // unless the bot is explicitly re-asking that slot.
  if (extracted.rank != null && canWrite(SLOT_RANK, next.rank != null)) {
    next.rank = extracted.rank;
  }
  if (extracted.percentile != null && canWrite(SLOT_PERCENTILE, next.percentile != null)) {
    next.percentile = extracted.percentile;
  }
  if (extracted.admissionType && canWrite(SLOT_ADMISSION_TYPE, Boolean(next.admissionType))) {
    next.admissionType = extracted.admissionType;
    next.admission_category_name_enum = extracted.admission_category_name_enum;
  }
  if (extracted.categoryLabel && canWrite(SLOT_CATEGORY, Boolean(next.categoryLabel))) {
    next.categoryLabel = extracted.categoryLabel;
    next.categoryN = extracted.categoryN;
    next.baseCategory = extracted.baseCategory;
  }
  if (extracted.gender && canWrite(SLOT_GENDER, Boolean(next.gender))) {
    next.gender = extracted.gender;
  }
  if (extracted.quota && canWrite(SLOT_QUOTA, Boolean(next.quota))) {
    next.quota = extracted.quota;
  }
  if (
    extracted.admission_category_name_enum &&
    next.exam === EXAM_AP &&
    canWrite(SLOT_REGION, Boolean(next.admission_category_name_enum))
  ) {
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
    context: buildResultsContext(ctx, {
      resultCache: ctx.resultCache || [],
      pageOffset: ctx.pageOffset || 0,
      apiOffset: ctx.apiOffset || PAGE_SIZE,
      ownershipFilter: ctx.ownershipFilter || null,
      branchFilter: ctx.branchFilter || null,
      totalColleges: ctx.totalColleges || null,
      predictionHash: completed.predictionHash || ctx.predictionHash || null,
    }),
    clearState: false,
    predictionIdempotency: completed,
    idempotentReplay: true,
  };
}

function buildResultsContext(ctx, extras = {}) {
  const {
    resultCache = [],
    pageOffset = 0,
    apiOffset = PAGE_SIZE,
    ownershipFilter = null,
    branchFilter = null,
    filterLabel = null,
    totalColleges = null,
    predictionHash = null,
    lastRequestBody = null,
  } = extras;
  return {
    ...ctx,
    step: 'results',
    conversational: true,
    conversationOwner: 'COLLEGE_PREDICTOR',
    resultCache,
    pageOffset,
    apiOffset,
    pageSize: PAGE_SIZE,
    ownershipFilter,
    branchFilter,
    filterLabel,
    totalColleges,
    predictionHash,
    lastRequestBody: lastRequestBody || ctx.lastRequestBody || null,
  };
}

function buildFilterLabel(ownershipFilter, branchFilter) {
  const parts = [];
  if (branchFilter) parts.push(branchFilter);
  if (ownershipFilter) parts.push(ownershipFilter === 'government' ? 'Government' : 'Private');
  return parts.length ? parts.join(' + ') : null;
}

async function fetchPredictionPage(ctx, offset, limit, requestBody) {
  const data = await fetchCollegeDostCollegesFn(ctx.exam, offset, limit, requestBody);
  return {
    colleges: data?.colleges || [],
    total: data?.total_no_of_colleges ?? (data?.colleges || []).length,
    data,
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
  const requestBody = buildCounsellorStyleRequestBody(ctx);
  logPredictorPipeline('predictor_payload_built', {
    predictorExam: ctx.exam || null,
    rank: ctx.rank ?? ctx.percentile ?? null,
    category: ctx.categoryLabel || null,
    gender: ctx.gender || null,
    requestBody,
  });

  try {
    // Fetch a larger window once so Show more / local filters can reuse the set.
    const fetchLimit = Math.max(PAGE_SIZE * 5, 25);
    const { colleges, total } = await fetchPredictionPage(ctx, 0, fetchLimit, requestBody);
    logPredictorPipeline('predictor_upstream_response', {
      predictorExam: ctx.exam || null,
      upstreamStatus: '200',
      collegeCount: colleges.length,
      totalColleges: total,
      durationMs: Date.now() - startedAt,
    });

    const page = slicePage(colleges, 0, PAGE_SIZE);
    let results;
    try {
      results = formatPredictionReply(ctx, page, { pageOffset: 0 });
      logPredictorPipeline('predictor_reply_formatted', {
        predictorExam: ctx.exam || null,
        collegeCount: page.length,
        replyLength: results.length,
        replyPreview: previewText(results),
      });
    } catch (formatErr) {
      logPredictorPipeline('predictor_stage_error', {
        stage: 'formatter',
        errorKind: 'formatter_error',
        predictorExam: ctx.exam || null,
        errMessage: formatErr.message,
      });
      throw formatErr;
    }

    const prefix = ctx.conversational ? `${buildPredictingMessage(ctx)}\n\n` : '';
    const reply = `${prefix}${results}`;
    const stickyCtx = buildResultsContext(ctx, {
      resultCache: colleges,
      pageOffset: page.length,
      apiOffset: colleges.length,
      totalColleges: total,
      lastRequestBody: requestBody,
    });

    let predictionIdempotency = null;
    let analyticsEmitted = false;

    if (opts.inboundId) {
      const completion = buildPredictionCompletion({
        inboundId: opts.inboundId,
        ctx: stickyCtx,
        cachedReply: reply,
        collegeCount: page.length,
      });
      let claimResult;
      try {
        claimResult = await claimInboundPredictionCompletion(opts.inboundId, completion);
      } catch (claimErr) {
        logPredictorPipeline('predictor_stage_error', {
          stage: 'idempotency_persist',
          errorKind: 'idempotency_error',
          predictorExam: ctx.exam || null,
          errMessage: claimErr.message,
        });
        throw claimErr;
      }
      const { record, isNewClaim } = claimResult;
      predictionIdempotency = record || completion;
      stickyCtx.predictionHash = completion.predictionHash || stickyCtx.predictionHash;

      if (!isNewClaim && record?.cachedReply) {
        return buildIdempotentPredictionResult(stickyCtx, record);
      }

      if (isNewClaim) {
        logEventFn('predictor_success', {
          predictorExam: ctx.exam || null,
          rank: ctx.rank ?? ctx.percentile ?? null,
          category: ctx.categoryLabel || null,
          botState: 'college_predictor',
          collegeCount: page.length,
          durationMs: Date.now() - startedAt,
          idempotent: false,
        });
        logEventFn('predictor_journey_event', {
          eventType: 'prediction_completed',
          predictorExam: ctx.exam || null,
          durationMs: Date.now() - startedAt,
        });
        analyticsEmitted = true;
      }
    } else {
      logEventFn('predictor_success', {
        predictorExam: ctx.exam || null,
        rank: ctx.rank ?? ctx.percentile ?? null,
        category: ctx.categoryLabel || null,
        botState: 'college_predictor',
        collegeCount: page.length,
        durationMs: Date.now() - startedAt,
        idempotent: false,
      });
      logEventFn('predictor_journey_event', {
        eventType: 'prediction_completed',
        predictorExam: ctx.exam || null,
        durationMs: Date.now() - startedAt,
      });
      analyticsEmitted = true;
    }

    if (!analyticsEmitted && predictionIdempotency?.cachedReply) {
      return buildIdempotentPredictionResult(stickyCtx, predictionIdempotency);
    }

    return {
      reply,
      context: stickyCtx,
      clearState: false,
      predictionIdempotency,
    };
  } catch (err) {
    const errorKind = classifyPredictorError(err);
    const upstreamStatus =
      err.http_status_code != null
        ? String(err.http_status_code)
        : err.res_status || err.code || 'predict_failed';
    logPredictorPipeline('predictor_upstream_error', {
      predictorExam: ctx.exam || null,
      upstreamStatus,
      errorKind,
      resStatus: err.res_status || null,
      upstreamResponse: previewText(err.response || err.message),
      durationMs: Date.now() - startedAt,
      errMessage: err.message,
    });
    logEventFn('predictor_failed', {
      predictorExam: ctx.exam || null,
      upstreamStatus,
      errorKind,
      botState: 'college_predictor',
    });
    logEventFn('predictor_journey_event', {
      eventType: 'prediction_failed',
      predictorExam: ctx.exam || null,
      errorKind,
    });
    return {
      reply: ctx.step === 'predict' ? PREDICT_RETRY_REPLY_AT_PREDICT : PREDICT_RETRY_REPLY,
      context: { ...ctx, step: 'predict' },
      predictionErrorKind: errorKind,
    };
  }
}

async function handleResultsFollowUp(text, ctx) {
  const branch = resolveBranchFilter(text);
  let ownership = resolveOwnershipFilter(text);
  const bare = normalizeText(text);
  if (!ownership) {
    if (/^government\s*[.!?]?$/i.test(bare)) ownership = 'government';
    if (/^private\s*[.!?]?$/i.test(bare)) ownership = 'private';
  }
  const showMore = isShowMoreRequest(text) || isTopCollegesRequest(text);
  const isFilterTurn = Boolean(branch || ownership);

  if (!showMore && !isFilterTurn && !isPredictorFollowUpAction(text, ctx)) {
    return null;
  }

  let ownershipFilter = isFilterTurn && ownership ? ownership : ctx.ownershipFilter || null;
  let branchFilter = isFilterTurn && branch ? branch.code : ctx.branchFilter || null;
  if (isFilterTurn) {
    // Replacing filters on explicit filter utterance
    if (ownership) ownershipFilter = ownership;
    if (branch) branchFilter = branch.code;
    // Bare "CSE" should clear ownership unless combined
    if (branch && !ownership && /^(cse|ece|eee|mechanical|civil|ai)\s*[.!?]?$/i.test(bare)) {
      // keep prior ownership if any — stacking is OK
    }
  }

  let resultCache = Array.isArray(ctx.resultCache) ? [...ctx.resultCache] : [];
  let pageOffset = Number(ctx.pageOffset || 0);
  let apiOffset = Number(ctx.apiOffset || resultCache.length || 0);
  const requestBody = ctx.lastRequestBody || buildCounsellorStyleRequestBody(ctx);
  const filterLabel = buildFilterLabel(ownershipFilter, branchFilter);

  if (isFilterTurn) {
    let filtered = filterCollegesLocally(resultCache, {
      ownership: ownershipFilter,
      branchCode: branchFilter,
    });
    if (filtered.length < PAGE_SIZE) {
      try {
        const more = await fetchPredictionPage(ctx, 0, Math.max(50, PAGE_SIZE * 10), requestBody);
        resultCache = more.colleges;
        apiOffset = more.colleges.length;
        filtered = filterCollegesLocally(resultCache, {
          ownership: ownershipFilter,
          branchCode: branchFilter,
        });
      } catch (_) {
        /* keep */
      }
    }
    const page = slicePage(filtered, 0, PAGE_SIZE);
    logEventFn('predictor_journey_event', {
      eventType: 'filter_applied',
      ownershipFilter,
      branchFilter,
      collegeCount: page.length,
    });
    return {
      reply: formatPredictionReply(ctx, page, {
        pageOffset: 0,
        filterLabel,
        exhausted: page.length === 0,
      }),
      context: buildResultsContext(ctx, {
        resultCache: filtered,
        pageOffset: page.length,
        apiOffset,
        ownershipFilter,
        branchFilter,
        filterLabel,
        totalColleges: filtered.length,
        lastRequestBody: requestBody,
        predictionHash: ctx.predictionHash,
      }),
      clearState: false,
    };
  }

  // Pagination — reuse cache; extend from API only when exhausted.
  const working = filterCollegesLocally(resultCache, {
    ownership: ownershipFilter,
    branchCode: branchFilter,
  });
  let page = slicePage(working, pageOffset, PAGE_SIZE);

  if (page.length === 0) {
    try {
      const more = await fetchPredictionPage(ctx, apiOffset, PAGE_SIZE * 5, requestBody);
      if (more.colleges.length) {
        const seen = new Set(working.map((c) => String(c.college_name || '').toLowerCase()));
        for (const c of more.colleges) {
          const key = String(c.college_name || '').toLowerCase();
          if (key && !seen.has(key)) {
            working.push(c);
            seen.add(key);
          }
        }
        resultCache = working;
        apiOffset += more.colleges.length;
        page = slicePage(working, pageOffset, PAGE_SIZE);
      }
    } catch (_) {
      /* exhausted */
    }
  }

  if (page.length === 0) {
    logEventFn('predictor_journey_event', { eventType: 'pagination_exhausted' });
    return {
      reply: formatPredictionReply(ctx, [], {
        pageOffset,
        filterLabel,
        exhausted: true,
        continuation: true,
      }),
      context: buildResultsContext(ctx, {
        resultCache: working,
        pageOffset,
        apiOffset,
        ownershipFilter,
        branchFilter,
        filterLabel,
        totalColleges: ctx.totalColleges,
        lastRequestBody: requestBody,
        predictionHash: ctx.predictionHash,
      }),
      clearState: false,
    };
  }

  logEventFn('predictor_journey_event', {
    eventType: 'pagination',
    pageOffset,
    collegeCount: page.length,
  });
  return {
    reply: formatPredictionReply(ctx, page, {
      pageOffset,
      filterLabel,
      continuation: true,
    }),
    context: buildResultsContext(ctx, {
      resultCache: working,
      pageOffset: pageOffset + page.length,
      apiOffset,
      ownershipFilter,
      branchFilter,
      filterLabel,
      totalColleges: ctx.totalColleges,
      lastRequestBody: requestBody,
      predictionHash: ctx.predictionHash,
    }),
    clearState: false,
  };
}

/**
 * WhatsApp College Predictor — conversational slot-filling orchestrator.
 * @param {string} text
 * @param {object} context — WhatsAppBotState.context.college
 * @param {{ isNewEntry?: boolean }} [opts]
 */
async function handleCollegePredictorMessage(text, context = {}, opts = {}) {
  const t = normalizeText(text);

  if (isPredictorRestartRequest(t) || /^again$/.test(t)) {
    logEventFn('predictor_journey_event', { eventType: 'restart' });
    return {
      reply: buildConversationalWelcome(),
      context: initialContext(),
      restart: true,
      clearState: false,
    };
  }

  if (opts.inboundId && context.step !== 'results') {
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
  // Sticky post-result ownership — never treat results as a fresh entry.
  if (ctx.step === 'results') {
    const followUp = await handleResultsFollowUp(text, ctx);
    if (followUp) return followUp;
    // Unrecognized follow-up: keep ownership and remind actions.
    return {
      reply:
        'You are still in College Predictor.\n\nReply SHOW MORE for more colleges, or CSE / ECE / Government / Private to filter.\n\nOr AGAIN for a new prediction / MENU to exit.',
      context: ctx,
      clearState: false,
    };
  }
  if (!ctx.step || ctx.step === 'done') ctx = initialContext();
  ctx.conversational = true;
  ctx.conversationOwner = 'COLLEGE_PREDICTOR';

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

  // P0: main-menu digits (e.g. "5" = College Predictor) must not select exam options on entry.
  const slotText =
    opts.isNewEntry && isMainMenuEntryDigit(text) ? '' : text;

  const beforeMissing = getMissingSlots(ctx);
  const focusSlot = beforeMissing[0] || null;
  const extracted = extractSlotsFromMessage(slotText, ctx);
  const merged = applyExtractedSlots(ctx, extracted, focusSlot);
  const afterMissing = getMissingSlots(merged);

  const trimmed = String(slotText || '').trim();
  if (
    beforeMissing.length > 0 &&
    afterMissing.length > 0 &&
    beforeMissing[0] === afterMissing[0] &&
    (trimmed || (opts.isNewEntry && isMainMenuEntryDigit(text))) &&
    Object.keys(extracted).length === 0
  ) {
    if (
      beforeMissing[0] === SLOT_EXAM &&
      (isNeutralPredictorEntry(text) || isMainMenuEntryDigit(text))
    ) {
      logEventFn('predictor_journey_event', { eventType: 'prediction_started' });
      return {
        reply: buildConversationalWelcome(),
        context: { ...merged, step: 'exam', conversational: true, conversationOwner: 'COLLEGE_PREDICTOR' },
      };
    }
    return {
      reply: buildInvalidMessage(beforeMissing[0], merged),
      context: {
        ...merged,
        step: slotToLegacyStep(beforeMissing[0]),
        conversational: true,
        conversationOwner: 'COLLEGE_PREDICTOR',
      },
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
      opts.isNewEntry &&
      nextSlot === SLOT_EXAM &&
      (isNeutralPredictorEntry(text) || isMainMenuEntryDigit(text))
        ? buildConversationalWelcome()
        : buildQuestionForSlot(nextSlot, ctx);
    if (opts.isNewEntry) {
      logEventFn('predictor_journey_event', { eventType: 'prediction_started' });
    }
    return {
      reply,
      context: {
        ...ctx,
        step: slotToLegacyStep(nextSlot),
        conversational: true,
        conversationOwner: 'COLLEGE_PREDICTOR',
      },
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
      context: {
        ...ctx,
        step: slotToLegacyStep(slot),
        conversational: true,
        conversationOwner: 'COLLEGE_PREDICTOR',
      },
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
  handleResultsFollowUp,
};
