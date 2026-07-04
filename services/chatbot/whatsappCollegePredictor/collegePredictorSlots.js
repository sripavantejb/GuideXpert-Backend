'use strict';

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
} = require('../../../constants/whatsappCollegePredictor');
const { AP_TS_CATEGORY_OPTIONS, resolveApTsReservationCode, isApOcMaleBlocked } = require('./apTs');
const { TNEA_CATEGORY_OPTIONS } = require('./tnea');
const { KCET_ADMISSION_OPTIONS, KCET_CATEGORY_OPTIONS } = require('./kcet');
const { KEAM_CATEGORY_OPTIONS } = require('./keam');
const { WBJEE_CATEGORY_OPTIONS, WBJEE_QUOTA_OPTIONS, getWbjeeReservationCategoryCode } = require('./wbjee');
const { JEE_CATEGORY_OPTIONS, getJeeReservationCategoryCodes } = require('./jee');
const {
  MHT_CET_ADMISSION_OPTIONS,
  getMhtCategoryOptionsByAdmissionType,
  normalizeMhtReservationCodeForApi,
  percentileToMhtCutoffRange,
} = require('./mhtCet');

const SLOT_EXAM = 'exam';
const SLOT_RANK = 'rank';
const SLOT_PERCENTILE = 'percentile';
const SLOT_ADMISSION_TYPE = 'admission_type';
const SLOT_CATEGORY = 'category';
const SLOT_GENDER = 'gender';
const SLOT_QUOTA = 'quota';
const SLOT_REGION = 'region';

function slotOrderForExam(exam) {
  if (!exam) return [SLOT_EXAM];
  if (exam === EXAM_MHT) {
    return [SLOT_EXAM, SLOT_PERCENTILE, SLOT_ADMISSION_TYPE, SLOT_CATEGORY];
  }
  if (exam === EXAM_KCET) {
    return [SLOT_EXAM, SLOT_RANK, SLOT_ADMISSION_TYPE, SLOT_CATEGORY];
  }
  if (exam === EXAM_JEE_MAIN || exam === EXAM_JEE_ADV) {
    return [SLOT_EXAM, SLOT_RANK, SLOT_GENDER, SLOT_CATEGORY];
  }
  if (exam === EXAM_AP || exam === EXAM_TS) {
    return [SLOT_EXAM, SLOT_RANK, SLOT_CATEGORY, SLOT_GENDER, ...(exam === EXAM_AP ? [SLOT_REGION] : [])];
  }
  if (exam === EXAM_WBJEE) {
    return [SLOT_EXAM, SLOT_RANK, SLOT_CATEGORY, SLOT_QUOTA];
  }
  return [SLOT_EXAM, SLOT_RANK, SLOT_CATEGORY];
}

function hasSlot(ctx, slot) {
  switch (slot) {
    case SLOT_EXAM:
      return Boolean(ctx.exam);
    case SLOT_RANK:
      return ctx.rank != null;
    case SLOT_PERCENTILE:
      return ctx.percentile != null;
    case SLOT_ADMISSION_TYPE:
      return Boolean(ctx.admissionType);
    case SLOT_CATEGORY:
      return Boolean(ctx.categoryLabel && (ctx.baseCategory || ctx.categoryN));
    case SLOT_GENDER:
      return Boolean(ctx.gender);
    case SLOT_QUOTA:
      return Boolean(ctx.quota);
    case SLOT_REGION:
      return Boolean(ctx.admission_category_name_enum && ctx.exam === EXAM_AP);
    default:
      return false;
  }
}

function getMissingSlots(ctx) {
  const exam = ctx.exam || null;
  const order = slotOrderForExam(exam);
  return order.filter((slot) => !hasSlot(ctx, slot));
}

function isPredictionReady(ctx) {
  return getMissingSlots(ctx).length === 0;
}

function clearDependentSlots(ctx, keepExam = true) {
  const next = { flow: ctx.flow, step: ctx.step, conversational: ctx.conversational };
  if (keepExam && ctx.exam) next.exam = ctx.exam;
  return next;
}

function categoryOptionsForExam(ctx) {
  const exam = ctx.exam;
  if (exam === EXAM_AP || exam === EXAM_TS) return AP_TS_CATEGORY_OPTIONS;
  if (exam === EXAM_TNEA) return TNEA_CATEGORY_OPTIONS;
  if (exam === EXAM_KCET) return KCET_CATEGORY_OPTIONS;
  if (exam === EXAM_KEAM) return KEAM_CATEGORY_OPTIONS;
  if (exam === EXAM_WBJEE) return WBJEE_CATEGORY_OPTIONS;
  if (exam === EXAM_JEE_MAIN || exam === EXAM_JEE_ADV) return JEE_CATEGORY_OPTIONS;
  if (exam === EXAM_MHT) return getMhtCategoryOptionsByAdmissionType(ctx.admissionType);
  return [];
}

function admissionOptionsForExam(exam) {
  if (exam === EXAM_KCET) return KCET_ADMISSION_OPTIONS;
  if (exam === EXAM_MHT) return MHT_CET_ADMISSION_OPTIONS;
  return [];
}

/**
 * Build API-ready context or return block/error before calling predictor.
 */
function buildPredictionContext(ctx) {
  if (ctx.exam === EXAM_AP || ctx.exam === EXAM_TS) {
    if (ctx.exam === EXAM_AP && isApOcMaleBlocked(ctx.categoryN, ctx.gender)) {
      return { blocked: true };
    }
    const code = resolveApTsReservationCode(ctx.exam, ctx.categoryN, ctx.gender);
    if (!code) {
      return { error: 'Could not resolve your reservation category. Please check category and gender.' };
    }
    const next = {
      ...ctx,
      reservation_category_codes: [code],
      admission_category_name_enum: ctx.exam === EXAM_AP ? ctx.admission_category_name_enum : 'DEFAULT',
      step: 'predict',
    };
    return { ctx: next };
  }

  if (ctx.exam === EXAM_WBJEE) {
    const code = getWbjeeReservationCategoryCode(ctx.baseCategory, ctx.quota);
    if (!code) {
      return { error: 'Selected category is not available for that quota. Please choose another combination.' };
    }
    return {
      ctx: {
        ...ctx,
        reservation_category_codes: [code],
        admission_category_name_enum: 'DEFAULT',
        step: 'predict',
      },
    };
  }

  if (ctx.exam === EXAM_JEE_MAIN || ctx.exam === EXAM_JEE_ADV) {
    const codes = getJeeReservationCategoryCodes(ctx.exam, ctx.gender, ctx.baseCategory);
    if (!codes.length) {
      return { error: 'Please choose a valid JEE category.' };
    }
    return {
      ctx: {
        ...ctx,
        reservation_category_codes: codes,
        admission_category_name_enum: 'DEFAULT',
        step: 'predict',
      },
    };
  }

  if (ctx.exam === EXAM_MHT) {
    const normalized = normalizeMhtReservationCodeForApi(ctx.admissionType, ctx.baseCategory);
    const [cutoff_from, cutoff_to] = percentileToMhtCutoffRange(ctx.percentile);
    return {
      ctx: {
        ...ctx,
        reservation_category_codes: [normalized],
        admission_category_name_enum: ctx.admission_category_name_enum || 'SL',
        cutoff_from,
        cutoff_to,
        step: 'predict',
      },
    };
  }

  const admission = ctx.exam === EXAM_KCET ? ctx.admissionType : 'DEFAULT';
  return {
    ctx: {
      ...ctx,
      reservation_category_codes: [ctx.baseCategory],
      admission_category_name_enum: admission,
      step: 'predict',
    },
  };
}

function slotToLegacyStep(slot) {
  const map = {
    exam: 'exam',
    rank: 'rank',
    percentile: 'percentile',
    admission_type: 'admission_type',
    category: 'category',
    gender: 'gender',
    quota: 'quota',
    region: 'region',
  };
  return map[slot] || slot;
}

module.exports = {
  SLOT_EXAM,
  SLOT_RANK,
  SLOT_PERCENTILE,
  SLOT_ADMISSION_TYPE,
  SLOT_CATEGORY,
  SLOT_GENDER,
  SLOT_QUOTA,
  SLOT_REGION,
  slotOrderForExam,
  getMissingSlots,
  isPredictionReady,
  clearDependentSlots,
  categoryOptionsForExam,
  admissionOptionsForExam,
  buildPredictionContext,
  slotToLegacyStep,
};
