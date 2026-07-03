'use strict';

const {
  EXAM_OPTIONS,
  EXAM_DISPLAY,
  EXAM_MHT,
  buildNumberedPrompt,
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

function buildExamListHint() {
  const lines = EXAM_OPTIONS.map((opt) => `${opt.id}. ${opt.label}`);
  return lines.join('\n');
}

function buildConversationalWelcome() {
  return [
    'Sure! I can help you predict colleges.',
    '',
    'Which entrance exam did you write?',
    '',
    'Reply with the exam name (e.g. TS EAMCET, JEE Main) or a number:',
    buildExamListHint(),
  ].join('\n');
}

function buildQuestionForSlot(slot, ctx) {
  switch (slot) {
    case SLOT_EXAM:
      return buildConversationalWelcome();
    case SLOT_RANK:
      return 'What is your rank?\n\nExample: 18453';
    case SLOT_PERCENTILE:
      return 'What is your percentile? (1 to 100)\n\nExample: 92.5';
    case SLOT_ADMISSION_TYPE: {
      const options = admissionOptionsForExam(ctx.exam);
      return buildNumberedPrompt(
        'Please select your admission type.',
        options,
        `Reply ${options[0]?.id || 1}`
      );
    }
    case SLOT_CATEGORY: {
      const options = categoryOptionsForExam(ctx);
      return buildNumberedPrompt(
        'Which category do you belong to?',
        options,
        `Reply ${options[0]?.id || 1} or type the category (e.g. BC-B)`
      );
    }
    case SLOT_GENDER:
      return 'What is your gender?\n\nReply Male or Female (or 1 = Male, 2 = Female).';
    case SLOT_QUOTA:
      return buildNumberedPrompt(
        'Which quota applies to you?',
        WBJEE_QUOTA_OPTIONS,
        'Reply 1 for All India'
      );
    case SLOT_REGION:
      return buildNumberedPrompt(
        'Which region do you belong to?',
        AP_REGION_OPTIONS,
        'Reply 1 for AU or type AU / SVU'
      );
    default:
      return buildConversationalWelcome();
  }
}

function buildInvalidMessage(slot, ctx) {
  switch (slot) {
    case SLOT_EXAM:
      return `I didn't recognize that exam. Please reply with an exam name or number:\n\n${buildExamListHint()}`;
    case SLOT_RANK:
      return 'Please enter a valid positive number for your rank.\n\nExample: 15000';
    case SLOT_PERCENTILE:
      return 'Please enter a valid percentile from 1 to 100.\n\nExample: 92.5';
    case SLOT_ADMISSION_TYPE: {
      const options = admissionOptionsForExam(ctx.exam);
      return `${buildNumberedPrompt('Please select a valid admission type.', options)}\n\nPlease reply with a valid option number.`;
    }
    case SLOT_CATEGORY: {
      const options = categoryOptionsForExam(ctx);
      return `${buildNumberedPrompt('Please select a valid category.', options)}\n\nPlease reply with a valid option number or category name (e.g. BC-B).`;
    }
    case SLOT_GENDER:
      return 'Please reply Male or Female (or 1 = Male, 2 = Female).';
    case SLOT_QUOTA:
      return `${buildNumberedPrompt('Please select your quota.', WBJEE_QUOTA_OPTIONS)}\n\nReply 1 for All India or 2 for Home State.`;
    case SLOT_REGION:
      return `${buildNumberedPrompt('Please select your region.', AP_REGION_OPTIONS)}\n\nReply 1 for AU, 2 for SVU, or type AU / SVU.`;
    default:
      return 'Please provide a valid answer.';
  }
}

function buildPredictingMessage(ctx) {
  const examLabel = EXAM_DISPLAY[ctx.exam] || ctx.exam;
  const score = ctx.exam === EXAM_MHT ? `percentile ${ctx.percentile}` : `rank ${ctx.rank}`;
  return `Perfect. Let me predict colleges for your ${examLabel} ${score}...`;
}

module.exports = {
  buildConversationalWelcome,
  buildQuestionForSlot,
  buildInvalidMessage,
  buildPredictingMessage,
  buildExamListHint,
};
