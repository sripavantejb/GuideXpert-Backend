const { normalizeText } = require('./intentClassifierService');
const { fetchCollegeDostColleges } = require('../collegePredictorCore');
const {
  EXAM_AP,
  initialContext,
  PROMPT_EXAM,
  PROMPT_RANK,
  PROMPT_GENDER,
  buildCategoryPrompt,
  PROMPT_REGION,
  mapExamChoice,
  mapCategoryChoice,
  mapGenderChoice,
  isApOcMaleBlocked,
  resolveReservationCode,
  AP_OC_MALE_BLOCKED_REPLY,
  mapRegionChoice,
  formatPredictionReply,
} = require('../../constants/whatsappCollegePredictor');

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
  const body = {
    exam: ctx.exam,
    rank: ctx.rank,
    reservation_category_codes: ctx.reservation_category_codes,
  };
  if (ctx.exam === EXAM_AP && ctx.admission_category_name_enum) {
    body.admission_category_name_enum = ctx.admission_category_name_enum;
  }
  return body;
}

function parsePositiveIntRank(text) {
  const t = String(text || '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = parseInt(t, 10);
  if (!Number.isInteger(n) || n < 1) return null;
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
}

/**
 * WhatsApp College Predictor V1 — AP & TS EAMCET slot-filling.
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
          reply: `${PROMPT_EXAM}\n\nPlease reply 1 or 2 only.`,
          context: ctx,
        };
      }
      return {
        reply: PROMPT_RANK,
        context: { ...ctx, step: 'rank', exam },
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
      return {
        reply: buildCategoryPrompt(),
        context: { ...ctx, step: 'category', rank },
      };
    }

    case 'category': {
      if (digit == null || digit < 1 || digit > 9) {
        return {
          reply: `${buildCategoryPrompt()}\n\nPlease reply with a number from 1 to 9.`,
          context: ctx,
        };
      }
      const mapped = mapCategoryChoice(digit);
      if (!mapped) {
        return {
          reply: `${buildCategoryPrompt()}\n\nPlease reply with a number from 1 to 9.`,
          context: ctx,
        };
      }
      return {
        reply: PROMPT_GENDER,
        context: {
          ...ctx,
          step: 'gender',
          categoryLabel: mapped.label,
          categoryN: mapped.categoryN,
        },
      };
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
      if (isApOcMaleBlocked(ctx.exam, ctx.categoryN, gender)) {
        return {
          reply: AP_OC_MALE_BLOCKED_REPLY,
          context: { ...ctx, gender, step: 'done' },
          clearState: true,
        };
      }
      const code = resolveReservationCode(ctx.exam, ctx.categoryN, gender);
      if (!code) {
        return {
          reply: `${PROMPT_GENDER}\n\nPlease reply 1 for Male or 2 for Female.`,
          context: ctx,
        };
      }
      const next = {
        ...ctx,
        gender,
        reservation_category_codes: [code],
      };
      if (ctx.exam === EXAM_AP) {
        return {
          reply: PROMPT_REGION,
          context: { ...next, step: 'region' },
        };
      }
      try {
        return await runPrediction({ ...next, step: 'predict' });
      } catch (err) {
        console.error('[whatsapp:college-predictor] predict failed:', {
          exam: next.exam,
          rank: next.rank,
          reservation: next.reservation_category_codes,
          http_status_code: err.http_status_code,
          res_status: err.res_status,
          response: err.response,
          upstreamDetail: err.upstreamBody?.detail,
        });
        return {
          reply:
            'We could not fetch college predictions right now. Please try again in a moment.\n\nYour details are saved — send any message to retry.',
          context: { ...next, step: 'predict' },
        };
      }
    }

    case 'region': {
      if (isApOcMaleBlocked(ctx.exam, ctx.categoryN, ctx.gender)) {
        return {
          reply: AP_OC_MALE_BLOCKED_REPLY,
          context: { ...ctx, step: 'done' },
          clearState: true,
        };
      }
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
      const ready = {
        ...ctx,
        step: 'predict',
        admission_category_name_enum: region,
      };
      try {
        return await runPrediction(ready);
      } catch (err) {
        console.error('[whatsapp:college-predictor] predict failed:', {
          exam: ready.exam,
          rank: ready.rank,
          reservation: ready.reservation_category_codes,
          region: ready.admission_category_name_enum,
          http_status_code: err.http_status_code,
          res_status: err.res_status,
          response: err.response,
          upstreamDetail: err.upstreamBody?.detail,
        });
        return {
          reply:
            'We could not fetch college predictions right now. Please try again in a moment.\n\nYour details are saved — send any message to retry.',
          context: ready,
        };
      }
    }

    case 'predict': {
      if (isApOcMaleBlocked(ctx.exam, ctx.categoryN, ctx.gender)) {
        return {
          reply: AP_OC_MALE_BLOCKED_REPLY,
          context: { ...ctx, step: 'done' },
          clearState: true,
        };
      }
      try {
        return await runPrediction(ctx);
      } catch (err) {
        console.error('[whatsapp:college-predictor] predict retry failed:', {
          exam: ctx.exam,
          rank: ctx.rank,
          reservation: ctx.reservation_category_codes,
          http_status_code: err.http_status_code,
          res_status: err.res_status,
          response: err.response,
          upstreamDetail: err.upstreamBody?.detail,
        });
        return {
          reply:
            'We could not fetch college predictions right now. Please try again in a moment.\n\nSend any message to retry.',
          context: ctx,
        };
      }
    }

    default:
      return { reply: PROMPT_EXAM, context: initialContext() };
  }
}

module.exports = {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
};
