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
  resolveDistrictFilter,
  resolveGirlsFilter,
  resolveNamedCollegeFilter,
  filterCollegesLocally,
  slicePage,
} = require('./whatsappCollegePredictor/collegePredictorSessionService');
const {
  extractPreferredCollege,
} = require('./whatsappCollegePredictor/collegePredictorIntentService');

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

  const canWrite = (slot, currentlyFilled, explicitEdit = false) =>
    !currentlyFilled || focusSlot === slot || explicitEdit;

  if (extracted.exam) {
    if (next.exam && extracted.exam !== next.exam) {
      next = { ...clearDependentSlots(next, false), exam: extracted.exam, conversational: true };
    } else {
      next.exam = extracted.exam;
    }
  }

  // Explicit mid-flow edits (e.g. "my rank is 20000") overwrite filled slots.
  const explicitRankEdit = extracted.rank != null && focusSlot !== SLOT_RANK;
  const explicitCategoryEdit = extracted.categoryLabel && focusSlot !== SLOT_CATEGORY;
  const explicitGenderEdit = extracted.gender && focusSlot !== SLOT_GENDER;
  const explicitRegionEdit =
    extracted.admission_category_name_enum && focusSlot !== SLOT_REGION;

  if (extracted.rank != null && canWrite(SLOT_RANK, next.rank != null, explicitRankEdit)) {
    if (explicitRankEdit && next.rank != null && extracted.rank !== next.rank) {
      // Rank change invalidates result cache only; category/gender stay.
      next.resultCache = undefined;
      next.pageOffset = undefined;
      next.step = next.step === 'results' ? 'predict' : next.step;
    }
    next.rank = extracted.rank;
  }
  if (
    extracted.percentile != null &&
    canWrite(SLOT_PERCENTILE, next.percentile != null, extracted.percentile != null)
  ) {
    next.percentile = extracted.percentile;
  }
  if (extracted.admissionType && canWrite(SLOT_ADMISSION_TYPE, Boolean(next.admissionType))) {
    next.admissionType = extracted.admissionType;
    next.admission_category_name_enum = extracted.admission_category_name_enum;
  }
  if (
    extracted.categoryLabel &&
    canWrite(SLOT_CATEGORY, Boolean(next.categoryLabel), explicitCategoryEdit)
  ) {
    next.categoryLabel = extracted.categoryLabel;
    next.categoryN = extracted.categoryN;
    next.baseCategory = extracted.baseCategory;
    next.resultCache = undefined;
  }
  if (extracted.gender && canWrite(SLOT_GENDER, Boolean(next.gender), explicitGenderEdit)) {
    next.gender = extracted.gender;
    next.resultCache = undefined;
  }
  if (extracted.quota && canWrite(SLOT_QUOTA, Boolean(next.quota))) {
    next.quota = extracted.quota;
  }
  if (
    extracted.admission_category_name_enum &&
    next.exam === EXAM_AP &&
    canWrite(SLOT_REGION, Boolean(next.admission_category_name_enum), explicitRegionEdit)
  ) {
    next.admission_category_name_enum = extracted.admission_category_name_enum;
    next.resultCache = undefined;
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
    preferredCollege = undefined,
    namedCollegeFilter = undefined,
    districtFilter = undefined,
    girlsOnly = undefined,
    pendingBranchFilter = undefined,
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
    preferredCollege:
      preferredCollege !== undefined ? preferredCollege : ctx.preferredCollege || null,
    namedCollegeFilter:
      namedCollegeFilter !== undefined ? namedCollegeFilter : ctx.namedCollegeFilter || null,
    districtFilter: districtFilter !== undefined ? districtFilter : ctx.districtFilter || null,
    girlsOnly: girlsOnly !== undefined ? girlsOnly : Boolean(ctx.girlsOnly),
    pendingBranchFilter:
      pendingBranchFilter !== undefined ? pendingBranchFilter : ctx.pendingBranchFilter || null,
  };
}

function buildFilterLabel(ownershipFilter, branchFilter, extras = {}) {
  const parts = [];
  if (branchFilter) parts.push(branchFilter);
  if (ownershipFilter) parts.push(ownershipFilter === 'government' ? 'Government' : 'Private');
  if (extras.namedCollege) parts.push(extras.namedCollege);
  if (extras.districtLabel) parts.push(extras.districtLabel);
  if (extras.girlsOnly) parts.push('Girls');
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

    // Apply pending branch / preferred college filters after first fetch (2A).
    const pendingBranch = ctx.pendingBranchFilter || ctx.branchFilter || null;
    const preferred = ctx.preferredCollege || null;
    let working = colleges;
    let appliedBranch = null;
    let appliedNamed = null;
    if (pendingBranch || preferred) {
      working = filterCollegesLocally(colleges, {
        branchCode: pendingBranch,
        namedCollege: preferred,
      });
      appliedBranch = pendingBranch;
      appliedNamed = preferred;
      if (working.length === 0) working = colleges;
    }

    const page = slicePage(working, 0, PAGE_SIZE);
    let results;
    try {
      const filterLabel = buildFilterLabel(null, appliedBranch, { namedCollege: appliedNamed });
      results = formatPredictionReply(ctx, page, { pageOffset: 0, filterLabel });
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
    const reply = appendCounselingAdvance(`${prefix}${results}`);
    const stickyCtx = buildResultsContext(ctx, {
      resultCache: working,
      pageOffset: page.length,
      apiOffset: colleges.length,
      totalColleges: total,
      lastRequestBody: requestBody,
      branchFilter: appliedBranch,
      namedCollegeFilter: appliedNamed,
      preferredCollege: preferred,
      pendingBranchFilter: null,
      filterLabel: buildFilterLabel(null, appliedBranch, { namedCollege: appliedNamed }),
      counselingAdvanceOffered: true,
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

function isCounselingBridgeIntent(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^(show\s*more|again|menu|top\s*colleges)\b/i.test(t)) return false;
  if (/^(cse|ece|eee|mech|civil|government|private)\b/i.test(t)) return false;
  return (
    /^\s*(y|yes|yeah|yep|ok|okay|sure|ready|continue|next)\s*[.!?]?\s*$/i.test(t) ||
    /\b(compare|comparison|what matters|factors|suggest|placements?|fees?|campus|location|roi|counsel|counselling|counseling)\b/i.test(
      t
    )
  );
}

function appendCounselingAdvance(reply) {
  const base = String(reply || '').trim();
  if (/compare these colleges based on placements|placements, curriculum and future/i.test(base)) {
    return base;
  }
  return `${base}\n\nWould you like me to help you compare these colleges based on placements, curriculum and future opportunities?`;
}

function seedCareerContextFromPredictor(ctx = {}) {
  const cache = Array.isArray(ctx.resultCache) ? ctx.resultCache : [];
  const recommended = cache.slice(0, 5).map((c, idx) => {
    const branch = Array.isArray(c.branches) ? c.branches[0] : null;
    return {
      collegeName: c.college_name || c.collegeName || `Option ${idx + 1}`,
      branchName: branch?.branch_name || branch?.branchName || null,
      branchCode: branch?.branch_code || null,
      tier: idx === 0 ? 'best_match' : 'strong_alternative',
      cutoff: branch?.cutoff ?? null,
      fee: branch?.fee ?? null,
    };
  });
  const preferredColleges = recommended.map((r) => r.collegeName).filter(Boolean);
  return {
    flow: 'career_counselling_v2',
    version: 2,
    stage: 'personalized_discovery',
    step: 'pers_career_priority',
    profile: {
      exam: ctx.exam || null,
      entranceExam: ctx.exam || null,
      rank: ctx.rank != null ? Number(ctx.rank) : null,
      category: ctx.categoryLabel || ctx.categoryN || null,
      gender: ctx.gender || null,
      recommendedColleges: recommended,
      preferredColleges,
      predictorRecommendedColleges: recommended,
      bridgedFromCollegePredictor: true,
    },
  };
}

async function handleResultsFollowUp(text, ctx) {
  // Counseling bridge takes priority over sticky reminder when user asks to compare / continue
  if (isCounselingBridgeIntent(text) && !isShowMoreRequest(text) && !isTopCollegesRequest(text)) {
    const branch = resolveBranchFilter(text);
    const ownership = resolveOwnershipFilter(text);
    if (!branch && !ownership && !resolveDistrictFilter(text) && !resolveGirlsFilter(text)) {
      return {
        reply: appendCounselingAdvance(
          'These options fit your rank band — next we can look at the factors that matter while choosing.'
        ),
        context: ctx,
        clearState: false,
        bridgeToCareerCounselling: true,
        bridgeSeed: seedCareerContextFromPredictor(ctx),
      };
    }
  }

  const branch = resolveBranchFilter(text);
  let ownership = resolveOwnershipFilter(text);
  const bare = normalizeText(text);
  if (!ownership) {
    if (/^government\s*[.!?]?$/i.test(bare)) ownership = 'government';
    if (/^private\s*[.!?]?$/i.test(bare)) ownership = 'private';
  }
  const districtFilter = resolveDistrictFilter(text);
  const girlsOnly = resolveGirlsFilter(text) || Boolean(ctx.girlsOnly);
  const namedCollege =
    resolveNamedCollegeFilter(text, ctx.preferredCollege) ||
    (ctx.preferredCollege && /\b(can i get|will i get|show|filter)\b/i.test(text)
      ? ctx.preferredCollege
      : ctx.namedCollegeFilter || null);
  const showMore = isShowMoreRequest(text) || isTopCollegesRequest(text);
  const isFilterTurn = Boolean(branch || ownership || districtFilter || resolveGirlsFilter(text) || namedCollege);

  if (!showMore && !isFilterTurn && !isPredictorFollowUpAction(text, ctx)) {
    return null;
  }

  let ownershipFilter = isFilterTurn && ownership ? ownership : ctx.ownershipFilter || null;
  let branchFilter = isFilterTurn && branch ? branch.code : ctx.branchFilter || ctx.pendingBranchFilter || null;
  if (isFilterTurn) {
    if (ownership) ownershipFilter = ownership;
    if (branch) branchFilter = branch.code;
  }

  let resultCache = Array.isArray(ctx.resultCache) ? [...ctx.resultCache] : [];
  let pageOffset = Number(ctx.pageOffset || 0);
  let apiOffset = Number(ctx.apiOffset || resultCache.length || 0);
  const requestBody = ctx.lastRequestBody || buildCounsellorStyleRequestBody(ctx);
  const activeDistrict = districtFilter || ctx.districtFilter || null;
  const activeNamed = namedCollege || ctx.namedCollegeFilter || null;
  const activeGirls = girlsOnly;
  const filterLabel = buildFilterLabel(ownershipFilter, branchFilter, {
    namedCollege: activeNamed,
    districtLabel: activeDistrict?.label,
    girlsOnly: activeGirls,
  });

  if (isFilterTurn) {
    let filtered = filterCollegesLocally(resultCache, {
      ownership: ownershipFilter,
      branchCode: branchFilter,
      namedCollege: activeNamed,
      districtFilter: activeDistrict,
      girlsOnly: activeGirls,
    });
    if (filtered.length < PAGE_SIZE) {
      try {
        const more = await fetchPredictionPage(ctx, 0, Math.max(50, PAGE_SIZE * 10), requestBody);
        resultCache = more.colleges;
        apiOffset = more.colleges.length;
        filtered = filterCollegesLocally(resultCache, {
          ownership: ownershipFilter,
          branchCode: branchFilter,
          namedCollege: activeNamed,
          districtFilter: activeDistrict,
          girlsOnly: activeGirls,
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
      namedCollege: activeNamed,
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
        preferredCollege: ctx.preferredCollege || activeNamed || null,
        namedCollegeFilter: activeNamed,
        districtFilter: activeDistrict,
        girlsOnly: activeGirls,
        pendingBranchFilter: null,
      }),
      clearState: false,
    };
  }

  // Pagination — reuse cache; extend from API only when exhausted.
  const working = filterCollegesLocally(resultCache, {
    ownership: ownershipFilter,
    branchCode: branchFilter,
    namedCollege: activeNamed,
    districtFilter: activeDistrict,
    girlsOnly: activeGirls,
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

  // Replay cached college reply for the same inbound (including retries after step=results).
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

  // Carry preferred college / pending branch from entry (2A post-result filters).
  if (opts.preferredCollege || context.preferredCollege) {
    ctx.preferredCollege = opts.preferredCollege || context.preferredCollege;
  }
  const namedFromText = extractPreferredCollege(text);
  if (namedFromText) ctx.preferredCollege = namedFromText;
  const earlyBranch = resolveBranchFilter(text);
  if (earlyBranch) ctx.pendingBranchFilter = earlyBranch.code;

  // Sticky post-result ownership — never treat results as a fresh entry.
  if (ctx.step === 'results') {
    const followUp = await handleResultsFollowUp(text, ctx);
    if (followUp) return followUp;

    // AU/SVU on sticky results → update region and re-run prediction (not nav reminder).
    if (ctx.exam === EXAM_AP) {
      const regionProbe = { ...ctx };
      delete regionProbe.admission_category_name_enum;
      const extracted = extractSlotsFromMessage(text, regionProbe);
      if (extracted.admission_category_name_enum) {
        const next = syncApTsReservationCodes({
          ...ctx,
          admission_category_name_enum: extracted.admission_category_name_enum,
          conversational: true,
          conversationOwner: 'COLLEGE_PREDICTOR',
          resultCache: undefined,
          pageOffset: undefined,
          apiOffset: undefined,
          ownershipFilter: null,
          branchFilter: null,
          filterLabel: null,
          predictionHash: null,
          lastRequestBody: null,
        });
        delete next.resultCache;
        delete next.pageOffset;
        delete next.apiOffset;
        delete next.predictionHash;
        delete next.lastRequestBody;
        const built = buildPredictionContext(next);
        if (built.blocked) {
          return {
            reply: AP_OC_MALE_BLOCKED_REPLY,
            context: { ...next, step: 'done' },
            clearState: true,
          };
        }
        if (!built.error) {
          logEventFn('predictor_journey_event', {
            eventType: 'region_changed_repredict',
            region: extracted.admission_category_name_enum,
          });
          return await runPrediction(built.ctx, opts);
        }
      }
    }

    // Unrecognized follow-up: keep ownership and remind actions + counseling advance.
    if (isCounselingBridgeIntent(text)) {
      return {
        reply: appendCounselingAdvance(
          'These colleges fit your rank band — next we can look at the factors that matter while choosing.'
        ),
        context: ctx,
        clearState: false,
        bridgeToCareerCounselling: true,
        bridgeSeed: seedCareerContextFromPredictor(ctx),
      };
    }

    return {
      reply: appendCounselingAdvance(
        'You are still in College Predictor.\nReply SHOW MORE, or CSE / Government / Private to filter.\nOr AGAIN / MENU to exit.'
      ),
      context: { ...ctx, counselingAdvanceOffered: true },
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
        reply: buildConversationalWelcome(merged),
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

  // Capture branch preference before results without making it mandatory.
  const branchPref = resolveBranchFilter(text);
  if (branchPref) ctx.pendingBranchFilter = branchPref.code;
  const namedPref = extractPreferredCollege(text);
  if (namedPref) ctx.preferredCollege = namedPref;

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
        ? buildConversationalWelcome(ctx)
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
  isCounselingBridgeIntent,
  seedCareerContextFromPredictor,
  appendCounselingAdvance,
};
