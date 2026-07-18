'use strict';

const { fetchCollegeDostColleges } = require('../../collegePredictorCore');
const {
  EXAM_AP,
  EXAM_TS,
  AP_TS_CATEGORY_OPTIONS,
  resolveApTsReservationCode,
  isApOcMaleBlocked,
} = require('../whatsappCollegePredictor/apTs');

let deps = {
  fetchCollegeDostColleges,
};

function setShortlistingEligibilityDeps(next = {}) {
  deps = {
    fetchCollegeDostColleges: next.fetchCollegeDostColleges || fetchCollegeDostColleges,
  };
}

function mapExamKey(raw) {
  const t = String(raw || '')
    .trim()
    .toLowerCase();
  if (!t) return null;
  if (/\bap\b.*\b(eapcet|eamcet)\b|\beapcet\b|\bandhra\b/.test(t)) return 'AP_EAMCET';
  if (/\bts\b.*\beamcet\b|\btelangana\b/.test(t)) return 'TS_EAMCET';
  if (/\bkcet\b|\bkarnataka\b/.test(t)) return 'KCET';
  if (/\bmht\b|\bmaha\b/.test(t)) return 'MHT_CET';
  if (/\bjee\s*adv/.test(t)) return 'JEE_ADVANCED';
  if (/\bjee\b/.test(t)) return 'JEE_MAIN';
  if (/\bwbjee\b/.test(t)) return 'WBJEE';
  if (/\bkeam\b/.test(t)) return 'KEAM';
  if (/\btnea\b/.test(t)) return 'TNEA';
  const upper = String(raw || '').trim().toUpperCase().replace(/\s+/g, '_');
  return upper || null;
}

function mapCategoryLabelToId(category) {
  const t = String(category || '')
    .trim()
    .toUpperCase()
    .replace(/_/g, '-');
  if (t === 'OC' || t === 'OPEN' || t === 'GENERAL') return 1;
  if (t === 'BC-A' || t === 'BCA' || t === 'BC_A') return 2;
  if (t === 'BC-B' || t === 'BCB' || t === 'BC_B') return 3;
  if (t === 'BC-C' || t === 'BCC' || t === 'BC_C') return 4;
  if (t === 'BC-D' || t === 'BCD' || t === 'BC_D') return 5;
  if (t === 'BC-E' || t === 'BCE' || t === 'BC_E') return 6;
  if (t === 'SC') return 7;
  if (t === 'ST') return 8;
  if (t === 'EWS') return 9;
  const found = AP_TS_CATEGORY_OPTIONS.find(
    (opt) => String(opt.label || '').toUpperCase() === t
  );
  return found ? found.id : null;
}

function defaultCategoryForExam(exam) {
  if (exam === 'AP_EAMCET') return 'OC GIRLS';
  if (exam === 'TS_EAMCET') return 'OC BOYS';
  if (exam === 'KCET') return '1G';
  return 'OC';
}

function buildEligibilityRequest(profile = {}) {
  const exam = profile.exam || mapExamKey(profile.entranceExam) || null;
  const rank = profile.rank != null ? Number(profile.rank) : null;
  const missing = [];
  if (!exam) missing.push('exam');
  if (!Number.isFinite(rank) || rank <= 0) missing.push('rank');

  let reservationCodes = Array.isArray(profile.reservationCategoryCodes)
    ? profile.reservationCategoryCodes.filter(Boolean)
    : [];

  if (reservationCodes.length === 0 && profile.reservationCategory) {
    reservationCodes = [String(profile.reservationCategory)];
  }

  if (reservationCodes.length === 0 && (exam === EXAM_AP || exam === EXAM_TS)) {
    const categoryId = profile.categoryId || mapCategoryLabelToId(profile.category);
    const gender = profile.gender || 'female';
    if (!categoryId) {
      missing.push('category');
    } else if (exam === EXAM_AP && isApOcMaleBlocked(categoryId, gender)) {
      missing.push('category');
    } else {
      const code = resolveApTsReservationCode(exam, categoryId, gender);
      if (code) reservationCodes = [code];
      else missing.push('category');
    }
  }

  if (reservationCodes.length === 0 && exam && !missing.includes('category')) {
    reservationCodes = [defaultCategoryForExam(exam)];
  }

  let admissionCategory = profile.admissionCategory || null;
  if (exam === EXAM_AP && !admissionCategory) {
    if (profile.region) admissionCategory = String(profile.region).toUpperCase();
    else missing.push('region');
  }
  if (exam === EXAM_TS && !admissionCategory) admissionCategory = 'DEFAULT';

  return {
    ok: missing.length === 0,
    missing,
    body: {
      exam,
      rank,
      reservation_category_codes: reservationCodes,
      admission_category_name_enum: admissionCategory || undefined,
      branch_codes: [],
      districts: [],
      sort_order: 'ASC',
    },
  };
}

async function retrieveEligibleColleges(profile, opts = {}) {
  const built = buildEligibilityRequest(profile);
  if (!built.ok) {
    return { ok: false, missing: built.missing, colleges: [], total: 0, error: null };
  }

  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 40;
  try {
    const data = await deps.fetchCollegeDostColleges(built.body.exam, 0, limit, built.body);
    const colleges = Array.isArray(data?.colleges) ? data.colleges : [];
    return {
      ok: true,
      missing: [],
      colleges,
      total: Number(data?.total_no_of_colleges) || colleges.length,
      request: built.body,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      missing: [],
      colleges: [],
      total: 0,
      request: built.body,
      error: err,
    };
  }
}

module.exports = {
  setShortlistingEligibilityDeps,
  mapExamKey,
  mapCategoryLabelToId,
  buildEligibilityRequest,
  retrieveEligibleColleges,
};
