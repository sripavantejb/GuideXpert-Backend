'use strict';

const {
  EXAM_OPTIONS,
  EXAM_DISPLAY,
  EXAM_MHT,
} = require('../../../constants/whatsappCollegePredictor');
const { AP_REGION_OPTIONS } = require('./apTs');
const { WBJEE_QUOTA_OPTIONS } = require('./wbjee');
const {
  SLOT_EXAM,
  SLOT_RANK,
  SLOT_PERCENTILE,
  SLOT_ADMISSION_TYPE,
  SLOT_CATEGORY,
  SLOT_GENDER,
  SLOT_QUOTA,
  SLOT_REGION,
  categoryOptionsForExam,
  admissionOptionsForExam,
} = require('./collegePredictorSlots');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function examList() {
  return EXAM_OPTIONS.map((o) => o.label).join(', ');
}

function categoryList(ctx) {
  return categoryOptionsForExam(ctx)
    .map((o) => o.label)
    .join(', ');
}

// ---------------------------------------------------------------------------
// Welcome / exam prompt — conversational, no numbered list
// ---------------------------------------------------------------------------

function buildConversationalWelcome() {
  return [
    'Sure! I can help you predict colleges.',
    '',
    'Which entrance exam did you write?',
    '',
    `You can type the exam name — for example: TS EAMCET, JEE Main, KCET.`,
    '',
    `Supported exams: ${examList()}.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Per-slot natural language questions
// ---------------------------------------------------------------------------

function buildQuestionForSlot(slot, ctx) {
  switch (slot) {
    case SLOT_EXAM:
      return buildConversationalWelcome();

    case SLOT_RANK:
      return [
        'What is your rank?',
        '',
        'Example: 18453',
      ].join('\n');

    case SLOT_PERCENTILE:
      return [
        'What is your percentile? (1 to 100)',
        '',
        'Example: 92.5',
      ].join('\n');

    case SLOT_ADMISSION_TYPE: {
      const options = admissionOptionsForExam(ctx.exam);
      const labels = options.map((o) => o.label).join(', ');
      return `Which admission type applies to you?\n\nOptions: ${labels}`;
    }

    case SLOT_CATEGORY: {
      const cats = categoryList(ctx);
      return `Which reservation category do you belong to?\n\nYou can simply type your category — for example: ${cats}.`;
    }

    case SLOT_GENDER:
      return 'What is your gender? (Male / Female)';

    case SLOT_QUOTA:
      return [
        'Which quota applies to you?',
        '',
        'Options: All India, Home State (West Bengal).',
      ].join('\n');

    case SLOT_REGION:
      return [
        'Which university region do you belong to for AP EAMCET?',
        '',
        'Type AU (Andhra University) or SVU (Sri Venkateswara University).',
      ].join('\n');

    default:
      return buildConversationalWelcome();
  }
}

// ---------------------------------------------------------------------------
// Clarification / invalid input messages — natural, no numbered lists
// ---------------------------------------------------------------------------

function buildInvalidMessage(slot, ctx) {
  switch (slot) {
    case SLOT_EXAM:
      return `I couldn't identify that exam. Please type the exam name — for example: TS EAMCET, JEE Main, KCET.\n\nSupported exams: ${examList()}.`;

    case SLOT_RANK:
      return 'Please enter your rank as a number.\n\nExample: 15000';

    case SLOT_PERCENTILE:
      return 'Please enter your percentile as a number between 1 and 100.\n\nExample: 92.5';

    case SLOT_ADMISSION_TYPE: {
      const options = admissionOptionsForExam(ctx.exam);
      const labels = options.map((o) => o.label).join(', ');
      return `I couldn't identify your admission type. Please type one of: ${labels}.`;
    }

    case SLOT_CATEGORY: {
      const cats = categoryList(ctx);
      return `I couldn't identify your reservation category. Could you tell me whether you're ${cats}?`;
    }

    case SLOT_GENDER:
      return 'Please tell me your gender — Male or Female.';

    case SLOT_QUOTA:
      return 'Please tell me your quota — All India or Home State (West Bengal).';

    case SLOT_REGION:
      return 'Please type your region — AU (Andhra University) or SVU (Sri Venkateswara University).';

    default:
      return 'Please provide a valid answer.';
  }
}

// ---------------------------------------------------------------------------
// Prediction header
// ---------------------------------------------------------------------------

function buildPredictingMessage(ctx) {
  const examLabel = EXAM_DISPLAY[ctx.exam] || ctx.exam;
  const score = ctx.exam === EXAM_MHT ? `percentile ${ctx.percentile}` : `rank ${ctx.rank}`;
  return `Perfect. Let me predict colleges for your ${examLabel} ${score}...`;
}

// ---------------------------------------------------------------------------
// Kept for compatibility (used in a few places that still need the exam list)
// ---------------------------------------------------------------------------

function buildExamListHint() {
  return EXAM_OPTIONS.map((o) => o.label).join(', ');
}

module.exports = {
  buildConversationalWelcome,
  buildQuestionForSlot,
  buildInvalidMessage,
  buildPredictingMessage,
  buildExamListHint,
};
