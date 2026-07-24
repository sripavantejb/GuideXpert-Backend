const { rankToCutoff } = require('../utils/rankToCutoff');
const {
  EXAM_AP,
  EXAM_TS,
  AP_TS_CATEGORY_OPTIONS,
  AP_REGION_OPTIONS,
  isApOcMaleBlocked: isApOcMaleBlockedByCategory,
  resolveApTsReservationCode,
} = require('../services/chatbot/whatsappCollegePredictor/apTs');

const FLOW = 'college_predictor';
const EXAM_TNEA = 'TNEA';
const EXAM_KCET = 'KCET';
const EXAM_KEAM = 'KEAM';
const EXAM_WBJEE = 'WBJEE_2024';
const EXAM_JEE_MAIN = 'JEE_MAINS_2024';
const EXAM_JEE_ADV = 'JEE_ADVANCE_2024';
const EXAM_MHT = 'MHTCET';

const EXAM_OPTIONS = [
  { id: 1, value: EXAM_AP, label: 'AP EAMCET' },
  { id: 2, value: EXAM_TS, label: 'TS EAMCET' },
  { id: 3, value: EXAM_TNEA, label: 'TNEA' },
  { id: 4, value: EXAM_KCET, label: 'KCET' },
  { id: 5, value: EXAM_KEAM, label: 'KEAM' },
  { id: 6, value: EXAM_WBJEE, label: 'WBJEE' },
  { id: 7, value: EXAM_JEE_MAIN, label: 'JEE Main' },
  { id: 8, value: EXAM_JEE_ADV, label: 'JEE Advanced' },
  { id: 9, value: EXAM_MHT, label: 'MHT CET' },
];

const EXAM_DISPLAY = Object.fromEntries(EXAM_OPTIONS.map((it) => [it.value, it.label]));

const FOOTER_ACTIONS = ['', 'Reply:', '', 'MENU -> Main Menu', 'AGAIN -> New Prediction', 'AGENT -> Talk to Counsellor'].join('\n');

const AP_OC_MALE_BLOCKED_REPLY = [
  'We currently need your exact AP EAMCET reservation category to provide an accurate prediction.',
  '',
  'Please connect with a GuideXpert expert for assistance.',
  '',
  'Reply:',
  'AGENT -> Talk to Expert',
  'MENU -> Main Menu',
].join('\n');

function buildNumberedPrompt(title, options, example) {
  const digits = ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.', '10.', '11.', '12.'];
  const lines = [title, '', 'Reply with number only:', ''];
  options.forEach((opt, i) => lines.push(`${digits[i] || `${i + 1}.`} ${opt.label}`));
  if (example) lines.push('', `Example: ${example}`);
  return lines.join('\n');
}

const PROMPT_EXAM = [
  'College Predictor',
  '',
  'Which entrance exam did you write?',
  '',
  `You can type the exam name — e.g. AP EAMCET, TS EAMCET, JEE Main, KCET, KEAM, WBJEE, MHT CET, TNEA, JEE Advanced.`,
].join('\n');
const PROMPT_RANK = ['Please enter your rank.', '', 'Example: 15000'].join('\n');
const PROMPT_PERCENTILE = ['Please enter your percentile (1 to 100).', '', 'Example: 92.5'].join('\n');
const PROMPT_GENDER = 'What is your gender? (Male / Female)';

function mapById(options, id) {
  return options.find((it) => Number(it.id) === Number(id)) || null;
}

function mapExamChoice(n) {
  const m = mapById(EXAM_OPTIONS, n);
  return m ? m.value : null;
}

function mapGenderChoice(n) {
  if (Number(n) === 1) return 'male';
  if (Number(n) === 2) return 'female';
  return null;
}

function mapRegionChoice(n) {
  const m = mapById(AP_REGION_OPTIONS, n);
  return m ? m.value : null;
}

function mapCategoryChoice(n) {
  const m = mapById(AP_TS_CATEGORY_OPTIONS, n);
  if (!m) return null;
  return { categoryN: m.id, label: m.label };
}

function isApOcMaleBlocked(exam, categoryN, gender) {
  return exam === EXAM_AP && isApOcMaleBlockedByCategory(categoryN, gender);
}

function resolveReservationCode(exam, categoryN, gender) {
  return resolveApTsReservationCode(exam, categoryN, gender);
}

function formatGenderLabel(gender) {
  if (gender === 'male') return 'Male';
  if (gender === 'female') return 'Female';
  return 'NA';
}

function buildPredictorRequestBody(ctx) {
  const range = rankToCutoff(ctx.rank);
  if (!range) throw new Error('Invalid rank for cutoff');
  const reservation =
    Array.isArray(ctx.reservation_category_codes) && ctx.reservation_category_codes.length > 0
      ? ctx.reservation_category_codes[0]
      : null;
  if (!reservation) throw new Error('Missing reservation category');
  return {
    entrance_exam_name_enum: ctx.exam,
    admission_category_name_enum: ctx.exam === EXAM_AP ? ctx.admission_category_name_enum || 'AU' : 'DEFAULT',
    cutoff_from: range[0],
    cutoff_to: range[1],
    reservation_category_codes: [reservation],
    branch_codes: [],
    districts: [],
    sort_order: 'ASC',
  };
}

function pickBranchDetails(college) {
  const b = Array.isArray(college?.branches) ? college.branches[0] : null;
  if (!b) {
    return { branch: 'NA', cutoff: null, category: null };
  }
  const rc = Array.isArray(b.reservation_categories) ? b.reservation_categories[0] : null;
  return {
    branch: b.branch_name || b.branch_code || 'NA',
    cutoff: rc?.cutoff_rank ?? rc?.cutoff ?? null,
    category: rc?.category_name ?? rc?.reservation_category_code ?? null,
  };
}

function pickBranchLine(college) {
  return pickBranchDetails(college).branch;
}

function formatPredictionReply(ctx, colleges) {
  const lines = [
    'Here are your predicted colleges:',
    '',
    `Exam: ${EXAM_DISPLAY[ctx.exam] || ctx.exam}`,
    `Rank/Percentile: ${ctx.percentile != null ? ctx.percentile : ctx.rank}`,
    `Category: ${ctx.categoryLabel || 'NA'}`,
  ];
  if (ctx.gender) {
    lines.push(`Gender: ${formatGenderLabel(ctx.gender)}`);
  }
  lines.push('', 'Top Matches:', '');

  const list = Array.isArray(colleges) ? colleges.slice(0, 5) : [];
  if (list.length === 0) {
    lines.push('No colleges found for this profile.');
    lines.push('Try AGAIN with different inputs.');
  } else {
    list.forEach((c, i) => {
      const details = pickBranchDetails(c);
      lines.push(`${i + 1}. ${c.college_name || 'College'}`);
      lines.push(`   Branch: ${details.branch}`);
      if (details.cutoff != null) {
        lines.push(`   Cutoff: ${details.cutoff}`);
      }
      if (details.category) {
        lines.push(`   Category: ${details.category}`);
      }
      lines.push('');
    });
  }
  lines.push(FOOTER_ACTIONS.trim());
  return lines.join('\n');
}

function initialContext() {
  return { flow: FLOW, step: 'exam', conversational: true };
}

module.exports = {
  FLOW,
  EXAM_AP,
  EXAM_TS,
  EXAM_TNEA,
  EXAM_KCET,
  EXAM_KEAM,
  EXAM_WBJEE,
  EXAM_JEE_MAIN,
  EXAM_JEE_ADV,
  EXAM_MHT,
  EXAM_OPTIONS,
  EXAM_DISPLAY,
  CATEGORY_MENU: AP_TS_CATEGORY_OPTIONS.map((it) => ({ n: it.id, label: it.label })),
  RESERVATION_BY_CATEGORY: Object.fromEntries(
    AP_TS_CATEGORY_OPTIONS.map((it) => [
      it.id,
      { label: it.label, AP_EAMCET: it.byExamGender.AP_EAMCET, TS_EAMCET: it.byExamGender.TS_EAMCET },
    ])
  ),
  PROMPT_EXAM,
  PROMPT_RANK,
  PROMPT_PERCENTILE,
  PROMPT_GENDER,
  PROMPT_REGION: 'Which university region do you belong to for AP EAMCET?\n\nType AU (Andhra University) or SVU (Sri Venkateswara University).',
  FOOTER_ACTIONS,
  AP_OC_MALE_BLOCKED_REPLY,
  buildNumberedPrompt,
  mapById,
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
