/**
 * WhatsApp College Predictor V1 — AP EAMCET & TS EAMCET only.
 * Reservation codes verified against earlywave (see frontend collegePredictorOptions.js).
 * Gender-aware codes: AP_EAMCET_RESERVATION_OPTIONS / TS_EAMCET_RESERVATION_OPTIONS.
 */

const { rankToCutoff } = require('../utils/rankToCutoff');

const FLOW = 'college_predictor';

const EXAM_AP = 'AP_EAMCET';
const EXAM_TS = 'TS_EAMCET';

const EXAM_DISPLAY = {
  [EXAM_AP]: 'AP EAMCET',
  [EXAM_TS]: 'TS EAMCET',
};

/** AP EAMCET menu category index for Open Competition (OC). */
const AP_OC_CATEGORY_N = 1;

/**
 * Menu category → upstream reservation code by exam and gender (verified on earlywave beta).
 * AP OC + Male: no verified upstream code (no OC BOYS on beta); do not guess — block prediction.
 */
const RESERVATION_BY_CATEGORY = {
  1: {
    label: 'OC',
    AP_EAMCET: { female: 'OC GIRLS', male: null },
    TS_EAMCET: { female: 'OC GIRLS', male: 'OC BOYS' },
  },
  2: {
    label: 'BC-A',
    AP_EAMCET: { female: 'BCA GIRLS', male: 'BCA BOYS' },
    TS_EAMCET: { female: 'BCA GIRLS', male: 'BCA BOYS' },
  },
  3: {
    label: 'BC-B',
    AP_EAMCET: { female: 'BCB GIRLS', male: 'BCB BOYS' },
    TS_EAMCET: { female: 'BCB GIRLS', male: 'BCB BOYS' },
  },
  4: {
    label: 'BC-C',
    AP_EAMCET: { female: 'BCC GIRLS', male: 'BCC BOYS' },
    TS_EAMCET: { female: 'BCC GIRLS', male: 'BCC BOYS' },
  },
  5: {
    label: 'BC-D',
    AP_EAMCET: { female: 'BCD GIRLS', male: 'BCD BOYS' },
    TS_EAMCET: { female: 'BCD GIRLS', male: 'BCD BOYS' },
  },
  6: {
    label: 'BC-E',
    AP_EAMCET: { female: 'BCE GIRLS', male: 'BCE BOYS' },
    TS_EAMCET: { female: 'BCE GIRLS', male: 'BCE BOYS' },
  },
  7: {
    label: 'SC',
    AP_EAMCET: { female: 'SC GIRLS', male: 'SC BOYS' },
    TS_EAMCET: { female: 'SC GIRLS', male: 'SC BOYS' },
  },
  8: {
    label: 'ST',
    AP_EAMCET: { female: 'ST GIRLS', male: 'ST BOYS' },
    TS_EAMCET: { female: 'ST GIRLS', male: 'ST BOYS' },
  },
  9: {
    label: 'EWS',
    AP_EAMCET: { female: 'OC EWS GIRLS', male: 'OC EWS BOYS' },
    TS_EAMCET: { female: 'EWS GEN OU', male: 'OC EWS BOYS' },
  },
};

/** @deprecated use RESERVATION_BY_CATEGORY — kept for tests/docs */
const CATEGORY_MENU = Object.entries(RESERVATION_BY_CATEGORY).map(([n, row]) => ({
  n: Number(n),
  label: row.label,
  apCode: row.AP_EAMCET.female,
  tsCode: row.TS_EAMCET.male,
}));

const PROMPT_EXAM = [
  '🎓 College Predictor',
  '',
  'Which exam would you like to predict colleges for?',
  '',
  '1️⃣ AP EAMCET',
  '2️⃣ TS EAMCET',
  '',
  'Example: Reply 1 for AP EAMCET.',
].join('\n');

const PROMPT_RANK = [
  '📊 Please enter your rank.',
  '',
  'Example:',
  '',
  '15000',
].join('\n');

const PROMPT_GENDER = [
  'Please select your gender.',
  '',
  'Reply with the number only:',
  '',
  '1️⃣ Male',
  '2️⃣ Female',
  '',
  'Example: Reply 1 for Male.',
].join('\n');

function buildCategoryPrompt() {
  const lines = [
    '🎓 Please select your category.',
    '',
    'Reply with the number only:',
    '',
  ];
  for (const n of Object.keys(RESERVATION_BY_CATEGORY).map(Number).sort((a, b) => a - b)) {
    const row = RESERVATION_BY_CATEGORY[n];
    const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'][n - 1];
    lines.push(`${emoji} ${row.label}`);
  }
  lines.push('', 'Example: Reply 4 for BC-C.');
  return lines.join('\n');
}

const PROMPT_REGION = [
  '📍 Please select your region.',
  '',
  '1️⃣ AU (Andhra University)',
  '2️⃣ SVU (Sri Venkateswara University)',
  '',
  'Example: Reply 1 for AU.',
].join('\n');

const FOOTER_ACTIONS = [
  '',
  'Reply:',
  '',
  'MENU → Main Menu',
  'AGENT → Talk to Expert',
  'AGAIN → Run Another Prediction',
].join('\n');

const AP_OC_MALE_BLOCKED_REPLY = [
  'We currently need your exact AP EAMCET reservation category to provide an accurate prediction.',
  '',
  'Please connect with a GuideXpert expert for assistance.',
  '',
  'Reply:',
  'AGENT → Talk to Expert',
  'MENU → Main Menu',
].join('\n');

function mapExamChoice(n) {
  if (n === 1) return EXAM_AP;
  if (n === 2) return EXAM_TS;
  return null;
}

function mapCategoryChoice(n) {
  const row = RESERVATION_BY_CATEGORY[n];
  if (!row) return null;
  return { label: row.label, categoryN: n };
}

function mapGenderChoice(n) {
  if (n === 1) return 'male';
  if (n === 2) return 'female';
  return null;
}

/**
 * AP EAMCET Open Category (OC) has no verified male code on earlywave; never map to BC-* proxies.
 * @param {string} exam
 * @param {number} categoryN
 * @param {'male'|'female'|string} gender
 */
function isApOcMaleBlocked(exam, categoryN, gender) {
  return exam === EXAM_AP && Number(categoryN) === AP_OC_CATEGORY_N && gender === 'male';
}

/**
 * Resolve upstream reservation_category_code from exam, menu category, and gender.
 * @param {string} exam AP_EAMCET | TS_EAMCET
 * @param {number} categoryN 1–9
 * @param {'male'|'female'} gender
 * @returns {string|null}
 */
function resolveReservationCode(exam, categoryN, gender) {
  if (isApOcMaleBlocked(exam, categoryN, gender)) return null;
  const row = RESERVATION_BY_CATEGORY[categoryN];
  if (!row || !exam) return null;
  const bucket = row[exam];
  if (!bucket) return null;
  const g = gender === 'female' ? 'female' : gender === 'male' ? 'male' : null;
  if (!g) return null;
  const code = bucket[g];
  return code != null && String(code).trim() !== '' ? code : null;
}

function mapRegionChoice(n) {
  if (n === 1) return 'AU';
  if (n === 2) return 'SVU';
  return null;
}

function formatGenderLabel(gender) {
  if (gender === 'male') return 'Male';
  if (gender === 'female') return 'Female';
  return '—';
}

/**
 * @param {object} ctx — college context with exam, rank, reservation_category_codes, admission_category_name_enum
 */
function buildPredictorRequestBody(ctx) {
  const exam = ctx.exam;
  const rank = ctx.rank;
  const range = rankToCutoff(rank);
  if (!range) {
    throw new Error('Invalid rank for cutoff');
  }
  const [cutoff_from, cutoff_to] = range;
  const reservation =
    Array.isArray(ctx.reservation_category_codes) && ctx.reservation_category_codes.length > 0
      ? ctx.reservation_category_codes[0]
      : null;
  if (!reservation) {
    throw new Error('Missing reservation category');
  }

  const admission_category_name_enum =
    exam === EXAM_AP ? ctx.admission_category_name_enum || 'AU' : 'DEFAULT';

  return {
    entrance_exam_name_enum: exam,
    admission_category_name_enum,
    cutoff_from,
    cutoff_to,
    reservation_category_codes: [reservation],
    branch_codes: [],
    districts: [],
    sort_order: 'ASC',
  };
}

function pickBranchLine(college) {
  const branches = college?.branches;
  if (!Array.isArray(branches) || branches.length === 0) {
    return '—';
  }
  const b = branches[0];
  return b.branch_name || b.branch_code || '—';
}

/**
 * @param {object} ctx
 * @param {object[]} colleges
 */
function formatPredictionReply(ctx, colleges) {
  const examLabel = EXAM_DISPLAY[ctx.exam] || ctx.exam;
  const categoryLabel = ctx.categoryLabel || '—';
  const genderLabel = formatGenderLabel(ctx.gender);
  const lines = [
    '🎯 Based on your profile:',
    '',
    `Exam: ${examLabel}`,
    `Rank: ${ctx.rank}`,
    `Category: ${categoryLabel}`,
    `Gender: ${genderLabel}`,
    '',
    'Top Matches:',
    '',
  ];

  const list = Array.isArray(colleges) ? colleges.slice(0, 5) : [];
  if (list.length === 0) {
    lines.push('No colleges found for this profile.');
    lines.push('Try a different category or rank, or reply AGAIN to start over.');
  } else {
    const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
    list.forEach((c, i) => {
      lines.push(`${nums[i]} ${c.college_name || 'College'}`);
      lines.push(pickBranchLine(c));
      lines.push('');
    });
  }

  lines.push(FOOTER_ACTIONS.trim());
  return lines.join('\n');
}

function initialContext() {
  return {
    flow: FLOW,
    step: 'exam',
  };
}

module.exports = {
  FLOW,
  EXAM_AP,
  EXAM_TS,
  EXAM_DISPLAY,
  AP_OC_CATEGORY_N,
  CATEGORY_MENU,
  RESERVATION_BY_CATEGORY,
  PROMPT_EXAM,
  PROMPT_RANK,
  PROMPT_GENDER,
  buildCategoryPrompt,
  PROMPT_REGION,
  FOOTER_ACTIONS,
  AP_OC_MALE_BLOCKED_REPLY,
  mapExamChoice,
  mapCategoryChoice,
  mapGenderChoice,
  isApOcMaleBlocked,
  resolveReservationCode,
  mapRegionChoice,
  formatGenderLabel,
  buildPredictorRequestBody,
  formatPredictionReply,
  initialContext,
};
