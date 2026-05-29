const { normalizeText } = require('./intentClassifierService');
const { fetchCollegeDostColleges } = require('../collegePredictorCore');
const {
  EXAM_AP,
  EXAM_TS,
  EXAM_TNEA,
  EXAM_KCET,
  EXAM_KEAM,
  EXAM_WBJEE,
  EXAM_JEE_MAIN,
  EXAM_JEE_ADV,
  EXAM_MHT,
  initialContext,
  PROMPT_EXAM,
  PROMPT_RANK,
  PROMPT_PERCENTILE,
  PROMPT_GENDER,
  buildNumberedPrompt,
  mapById,
  PROMPT_REGION,
  mapExamChoice,
  mapGenderChoice,
  isApOcMaleBlocked,
  AP_OC_MALE_BLOCKED_REPLY,
  mapRegionChoice,
  formatPredictionReply,
} = require('../../constants/whatsappCollegePredictor');
const { AP_TS_CATEGORY_OPTIONS, resolveApTsReservationCode } = require('./whatsappCollegePredictor/apTs');
const { TNEA_CATEGORY_OPTIONS } = require('./whatsappCollegePredictor/tnea');
const { KCET_ADMISSION_OPTIONS, KCET_CATEGORY_OPTIONS } = require('./whatsappCollegePredictor/kcet');
const { KEAM_CATEGORY_OPTIONS } = require('./whatsappCollegePredictor/keam');
const { WBJEE_CATEGORY_OPTIONS, WBJEE_QUOTA_OPTIONS, getWbjeeReservationCategoryCode } = require('./whatsappCollegePredictor/wbjee');
const { JEE_CATEGORY_OPTIONS, getJeeReservationCategoryCodes } = require('./whatsappCollegePredictor/jee');
const {
  MHT_CET_ADMISSION_OPTIONS,
  getMhtCategoryOptionsByAdmissionType,
  normalizeMhtReservationCodeForApi,
  percentileToMhtCutoffRange,
} = require('./whatsappCollegePredictor/mhtCet');
const { logChatbotEvent } = require('./chatbotStructuredLog');

let fetchCollegeDostCollegesFn = fetchCollegeDostColleges;

function setCollegePredictorDeps(deps = {}) {
  if (deps.fetchCollegeDostColleges) {
    fetchCollegeDostCollegesFn = deps.fetchCollegeDostColleges;
  } else if (deps.getPredictedColleges) {
    fetchCollegeDostCollegesFn = (exam, offset, limit, body) =>
      deps.getPredictedColleges(exam, offset, limit, body);
  } else {
    fetchCollegeDostCollegesFn = fetchCollegeDostColleges;
  }
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

function parsePositiveIntRank(text) {
  const t = String(text || '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function parsePercentile(text) {
  const t = String(text || '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1 || n > 100) return null;
  return n;
}

function parseMenuDigit(text) {
  const t = String(text || '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  if (!Number.isInteger(n)) return null;
  return n;
}

async function runPrediction(ctx) {
  const PREDICT_RETRY_REPLY =
    'We could not fetch college predictions right now. Please try again in a moment.\n\nYour details are saved — send any message to retry.';
  const PREDICT_RETRY_REPLY_AT_PREDICT =
    'We could not fetch college predictions right now. Please try again in a moment.\n\nSend any message to retry.';

  try {
    const data = await fetchCollegeDostCollegesFn(
      ctx.exam,
      0,
      5,
      buildCounsellorStyleRequestBody(ctx)
    );
    const colleges = data?.colleges || [];
    const reply = formatPredictionReply(ctx, colleges);
    return {
      reply,
      context: { ...ctx, step: 'done' },
      clearState: true,
    };
  } catch (err) {
    const upstreamStatus =
      err.http_status_code != null
        ? String(err.http_status_code)
        : err.res_status || err.code || 'predict_failed';
    logChatbotEvent('predictor_failed', {
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

function categoryPrompt(options, title = 'Please select your category.') {
  return buildNumberedPrompt(title, options, `Reply ${options[0]?.id || 1}`);
}

function admissionPrompt(options, title = 'Please select admission type.') {
  return buildNumberedPrompt(title, options, `Reply ${options[0]?.id || 1}`);
}

function quotaPrompt(options) {
  return buildNumberedPrompt('Please select your quota.', options, 'Reply 1');
}

function nextStepAfterRank(exam) {
  if (exam === EXAM_AP || exam === EXAM_TS) return 'category';
  if (exam === EXAM_TNEA) return 'category';
  if (exam === EXAM_KCET) return 'admission_type';
  if (exam === EXAM_KEAM) return 'category';
  if (exam === EXAM_WBJEE) return 'category';
  if (exam === EXAM_JEE_MAIN || exam === EXAM_JEE_ADV) return 'gender';
  return 'category';
}

function buildExamCategoryPrompt(ctx) {
  if (ctx.exam === EXAM_AP || ctx.exam === EXAM_TS) return categoryPrompt(AP_TS_CATEGORY_OPTIONS);
  if (ctx.exam === EXAM_TNEA) return categoryPrompt(TNEA_CATEGORY_OPTIONS);
  if (ctx.exam === EXAM_KCET) return categoryPrompt(KCET_CATEGORY_OPTIONS);
  if (ctx.exam === EXAM_KEAM) return categoryPrompt(KEAM_CATEGORY_OPTIONS);
  if (ctx.exam === EXAM_WBJEE) return categoryPrompt(WBJEE_CATEGORY_OPTIONS);
  if (ctx.exam === EXAM_JEE_MAIN || ctx.exam === EXAM_JEE_ADV) return categoryPrompt(JEE_CATEGORY_OPTIONS);
  if (ctx.exam === EXAM_MHT) {
    return categoryPrompt(getMhtCategoryOptionsByAdmissionType(ctx.admissionType));
  }
  return 'Please select a valid category.';
}

/**
 * WhatsApp College Predictor multi-exam orchestrator.
 * @param {string} text
 * @param {object} context — WhatsAppBotState.context.college
 * @param {{ isNewEntry?: boolean }} [opts]
 */
async function handleCollegePredictorMessage(text, context = {}, opts = {}) {
  const t = normalizeText(text);

  if (/^again$/.test(t)) {
    return { reply: PROMPT_EXAM, context: initialContext(), restart: true };
  }

  let ctx = opts.isNewEntry ? initialContext() : { ...context };

  if (!ctx.flow) {
    ctx = initialContext();
  }
  if (!ctx.step || ctx.step === 'done') {
    ctx = initialContext();
  }

  const digit = parseMenuDigit(t);

  switch (ctx.step) {
    case 'exam': {
      if (digit == null) {
        return { reply: PROMPT_EXAM, context: ctx };
      }
      const exam = mapExamChoice(digit);
      if (!exam) {
        return {
          reply: `${PROMPT_EXAM}\n\nPlease reply with a number from 1 to 9.`,
          context: ctx,
        };
      }
      return {
        reply: exam === EXAM_MHT ? PROMPT_PERCENTILE : PROMPT_RANK,
        context: { ...ctx, step: exam === EXAM_MHT ? 'percentile' : 'rank', exam },
      };
    }

    case 'rank': {
      const rank = parsePositiveIntRank(t);
      if (rank == null) {
        return {
          reply: 'Please enter a valid positive number for your rank.\n\nExample: 15000',
          context: ctx,
        };
      }
      const step = nextStepAfterRank(ctx.exam);
      if (step === 'admission_type') {
        return {
          reply: admissionPrompt(KCET_ADMISSION_OPTIONS, 'Please select your admission type.'),
          context: { ...ctx, step, rank },
        };
      }
      if (step === 'gender') {
        return {
          reply: PROMPT_GENDER,
          context: { ...ctx, step: 'gender', rank },
        };
      }
      return {
        reply: buildExamCategoryPrompt({ ...ctx, rank }),
        context: { ...ctx, step, rank },
      };
    }

    case 'percentile': {
      const percentile = parsePercentile(t);
      if (percentile == null) {
        return {
          reply: `${PROMPT_PERCENTILE}\n\nPlease enter a valid number from 1 to 100.`,
          context: ctx,
        };
      }
      return {
        reply: admissionPrompt(MHT_CET_ADMISSION_OPTIONS, 'Please select your admission route.'),
        context: { ...ctx, step: 'admission_type', percentile },
      };
    }

    case 'admission_type': {
      if (digit == null) {
        const options = ctx.exam === EXAM_KCET ? KCET_ADMISSION_OPTIONS : MHT_CET_ADMISSION_OPTIONS;
        return {
          reply: `${admissionPrompt(options)}\n\nPlease reply with a valid option number.`,
          context: ctx,
        };
      }
      const options = ctx.exam === EXAM_KCET ? KCET_ADMISSION_OPTIONS : MHT_CET_ADMISSION_OPTIONS;
      const mapped = mapById(options, digit);
      if (!mapped) {
        return {
          reply: `${admissionPrompt(options)}\n\nPlease reply with a valid option number.`,
          context: ctx,
        };
      }
      return {
        reply: buildExamCategoryPrompt({ ...ctx, admissionType: mapped.value }),
        context: {
          ...ctx,
          step: 'category',
          admissionType: mapped.value,
          admission_category_name_enum: mapped.apiValue || mapped.value,
        },
      };
    }

    case 'category': {
      if (digit == null) {
        return {
          reply: `${buildExamCategoryPrompt(ctx)}\n\nPlease reply with a valid option number.`,
          context: ctx,
        };
      }
      let mapped = null;
      if (ctx.exam === EXAM_AP || ctx.exam === EXAM_TS) mapped = mapById(AP_TS_CATEGORY_OPTIONS, digit);
      if (ctx.exam === EXAM_TNEA) mapped = mapById(TNEA_CATEGORY_OPTIONS, digit);
      if (ctx.exam === EXAM_KCET) mapped = mapById(KCET_CATEGORY_OPTIONS, digit);
      if (ctx.exam === EXAM_KEAM) mapped = mapById(KEAM_CATEGORY_OPTIONS, digit);
      if (ctx.exam === EXAM_WBJEE) mapped = mapById(WBJEE_CATEGORY_OPTIONS, digit);
      if (ctx.exam === EXAM_JEE_MAIN || ctx.exam === EXAM_JEE_ADV) mapped = mapById(JEE_CATEGORY_OPTIONS, digit);
      if (ctx.exam === EXAM_MHT) mapped = mapById(getMhtCategoryOptionsByAdmissionType(ctx.admissionType), digit);
      if (!mapped) {
        return {
          reply: `${buildExamCategoryPrompt(ctx)}\n\nPlease reply with a valid option number.`,
          context: ctx,
        };
      }

      const next = { ...ctx, categoryLabel: mapped.label, categoryN: mapped.id, baseCategory: mapped.value };

      if (ctx.exam === EXAM_AP || ctx.exam === EXAM_TS) {
        return {
          reply: PROMPT_GENDER,
          context: { ...next, step: 'gender' },
        };
      }
      if (ctx.exam === EXAM_WBJEE) {
        return {
          reply: quotaPrompt(WBJEE_QUOTA_OPTIONS),
          context: { ...next, step: 'quota' },
        };
      }
      if (ctx.exam === EXAM_JEE_MAIN || ctx.exam === EXAM_JEE_ADV) {
        if (!ctx.gender) {
          return {
            reply: `${PROMPT_GENDER}\n\nPlease select gender first.`,
            context: { ...next, step: 'gender' },
          };
        }
        const reservation_category_codes = getJeeReservationCategoryCodes(ctx.exam, ctx.gender, mapped.value);
        if (!reservation_category_codes.length) {
          return {
            reply: `${buildExamCategoryPrompt(ctx)}\n\nPlease reply with a valid option number.`,
            context: ctx,
          };
        }
        return await runPrediction({
          ...next,
          reservation_category_codes,
          admission_category_name_enum: 'DEFAULT',
          step: 'predict',
        });
      }
      if (ctx.exam === EXAM_MHT) {
        const normalized = normalizeMhtReservationCodeForApi(ctx.admissionType, mapped.value);
        const [cutoff_from, cutoff_to] = percentileToMhtCutoffRange(ctx.percentile);
        return await runPrediction({
          ...next,
          reservation_category_codes: [normalized],
          cutoff_from,
          cutoff_to,
          step: 'predict',
        });
      }
      const admission = ctx.exam === EXAM_KCET ? ctx.admissionType : 'DEFAULT';
      return await runPrediction({
        ...next,
        reservation_category_codes: [mapped.value],
        admission_category_name_enum: admission,
        step: 'predict',
      });
    }

    case 'gender': {
      if (digit == null) {
        return {
          reply: `${PROMPT_GENDER}\n\nPlease reply 1 for Male or 2 for Female.`,
          context: ctx,
        };
      }
      const gender = mapGenderChoice(digit);
      if (!gender) {
        return {
          reply: `${PROMPT_GENDER}\n\nPlease reply 1 for Male or 2 for Female.`,
          context: ctx,
        };
      }
      if (ctx.exam === EXAM_AP || ctx.exam === EXAM_TS) {
        if (isApOcMaleBlocked(ctx.exam, ctx.categoryN, gender)) {
          return {
            reply: AP_OC_MALE_BLOCKED_REPLY,
            context: { ...ctx, gender, step: 'done' },
            clearState: true,
          };
        }
        const code = resolveApTsReservationCode(ctx.exam, ctx.categoryN, gender);
        if (!code) {
          return {
            reply: `${PROMPT_GENDER}\n\nPlease reply 1 for Male or 2 for Female.`,
            context: ctx,
          };
        }
        const next = { ...ctx, gender, reservation_category_codes: [code] };
        if (ctx.exam === EXAM_AP) {
          return { reply: PROMPT_REGION, context: { ...next, step: 'region' } };
        }
        return await runPrediction({
          ...next,
          admission_category_name_enum: 'DEFAULT',
          step: 'predict',
        });
      }
      if (ctx.exam === EXAM_JEE_MAIN || ctx.exam === EXAM_JEE_ADV) {
        return {
          reply: buildExamCategoryPrompt({ ...ctx, gender }),
          context: { ...ctx, gender, step: 'category' },
        };
      }
      return { reply: PROMPT_EXAM, context: initialContext() };
    }

    case 'quota': {
      if (digit == null) {
        return {
          reply: `${quotaPrompt(WBJEE_QUOTA_OPTIONS)}\n\nPlease reply with a valid option number.`,
          context: ctx,
        };
      }
      const quota = mapById(WBJEE_QUOTA_OPTIONS, digit);
      if (!quota) {
        return {
          reply: `${quotaPrompt(WBJEE_QUOTA_OPTIONS)}\n\nPlease reply with a valid option number.`,
          context: ctx,
        };
      }
      const code = getWbjeeReservationCategoryCode(ctx.baseCategory, quota.value);
      if (!code) {
        return {
          reply: 'Selected category is not available for that quota. Please choose another quota/category.',
          context: { ...ctx, step: 'category' },
        };
      }
      return await runPrediction({
        ...ctx,
        reservation_category_codes: [code],
        admission_category_name_enum: 'DEFAULT',
        step: 'predict',
        quota: quota.value,
      });
    }

    case 'region': {
      if (digit == null) {
        return {
          reply: `${PROMPT_REGION}\n\nPlease reply 1 or 2 only.`,
          context: ctx,
        };
      }
      const region = mapRegionChoice(digit);
      if (!region) {
        return {
          reply: `${PROMPT_REGION}\n\nPlease reply 1 or 2 only.`,
          context: ctx,
        };
      }
      return await runPrediction({
        ...ctx,
        step: 'predict',
        admission_category_name_enum: region,
      });
    }

    case 'predict': {
      if (isApOcMaleBlocked(ctx.exam, ctx.categoryN, ctx.gender)) {
        return {
          reply: AP_OC_MALE_BLOCKED_REPLY,
          context: { ...ctx, step: 'done' },
          clearState: true,
        };
      }
      return await runPrediction(ctx);
    }

    default:
      return { reply: PROMPT_EXAM, context: initialContext() };
  }
}

module.exports = {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
};
