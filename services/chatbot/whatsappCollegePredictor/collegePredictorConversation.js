'use strict';

const {
  EXAM_OPTIONS,
  EXAM_DISPLAY,
  EXAM_MHT,
} = require('../../../constants/whatsappCollegePredictor');
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

const MAX_NON_RESULT_LINES = 5;

function clampReplyLines(text, maxLines = MAX_NON_RESULT_LINES) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trimEnd());
  // Drop trailing empties but keep short body
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length <= maxLines) return lines.join('\n');
  return lines.slice(0, maxLines).join('\n');
}

function examExamples() {
  return 'TS EAMCET, JEE Main, KCET, AP EAMCET';
}

function shortCategoryHint(ctx) {
  const opts = categoryOptionsForExam(ctx) || [];
  const labels = opts.slice(0, 4).map((o) => o.label);
  if (!labels.length) return 'OC, BC-A, SC, ST';
  const more = opts.length > 4 ? ' (or type yours)' : '';
  return `${labels.join(', ')}${more}`;
}

function buildConversationalWelcome(ctx = {}) {
  const rank = ctx && ctx.rank != null ? Number(ctx.rank) : null;
  if (Number.isFinite(rank) && rank >= 1) {
    return clampReplyLines(
      [
        'Absolutely! I can help you predict colleges.',
        `I already have your rank (${rank}).`,
        'Which entrance exam is this rank from?',
        '',
        `e.g. ${examExamples()}`,
      ].join('\n')
    );
  }
  return clampReplyLines(
    [
      'Sure! I can help you predict colleges.',
      'Which entrance exam did you write?',
      '',
      `e.g. ${examExamples()}`,
    ].join('\n')
  );
}

function buildQuestionForSlot(slot, ctx) {
  switch (slot) {
    case SLOT_EXAM:
      return buildConversationalWelcome(ctx || {});

    case SLOT_RANK:
      return clampReplyLines(['Thanks!', "What's your rank?", '', 'Example: 18453'].join('\n'));

    case SLOT_PERCENTILE:
      return clampReplyLines(
        ['Got it!', "What's your percentile (1–100)?", '', 'Example: 92.5'].join('\n')
      );

    case SLOT_ADMISSION_TYPE: {
      const options = admissionOptionsForExam(ctx.exam);
      const labels = (options || []).map((o) => o.label).join(' / ');
      return clampReplyLines(
        ['Thanks!', 'Which admission type?', '', labels || 'Type your admission type'].join('\n')
      );
    }

    case SLOT_CATEGORY:
      return clampReplyLines(
        ['Thanks!', "What's your category?", '', `e.g. ${shortCategoryHint(ctx)}`].join('\n')
      );

    case SLOT_GENDER:
      return clampReplyLines(['Got it!', 'Male or Female?'].join('\n'));

    case SLOT_QUOTA:
      return clampReplyLines(
        ['Thanks!', 'Which quota?', '', 'All India or Home State (WB)'].join('\n')
      );

    case SLOT_REGION:
      return clampReplyLines(
        ['Almost done!', 'AU or SVU region?', '', 'AU = Andhra University, SVU = Sri Venkateswara'].join(
          '\n'
        )
      );

    default:
      return buildConversationalWelcome();
  }
}

function buildInvalidMessage(slot, ctx) {
  switch (slot) {
    case SLOT_EXAM:
      return clampReplyLines(
        [`Couldn't catch that exam.`, `Try: ${examExamples()}`].join('\n')
      );

    case SLOT_RANK:
      return clampReplyLines(['Please send rank as a number.', 'Example: 15000'].join('\n'));

    case SLOT_PERCENTILE:
      return clampReplyLines(['Percentile should be 1–100.', 'Example: 92.5'].join('\n'));

    case SLOT_ADMISSION_TYPE: {
      const options = admissionOptionsForExam(ctx.exam);
      const labels = (options || []).map((o) => o.label).join(' / ');
      return clampReplyLines([`Please type: ${labels || 'your admission type'}`].join('\n'));
    }

    case SLOT_CATEGORY:
      return clampReplyLines(
        ['Please type your category.', `e.g. ${shortCategoryHint(ctx)}`].join('\n')
      );

    case SLOT_GENDER:
      return clampReplyLines(['Please reply Male or Female.'].join('\n'));

    case SLOT_QUOTA:
      return clampReplyLines(['Please reply All India or Home State.'].join('\n'));

    case SLOT_REGION:
      return clampReplyLines(['Please type AU or SVU.'].join('\n'));

    default:
      return clampReplyLines(['Please send a valid answer.'].join('\n'));
  }
}

function buildPredictingMessage(ctx) {
  const examLabel = EXAM_DISPLAY[ctx.exam] || ctx.exam;
  const score = ctx.exam === EXAM_MHT ? `percentile ${ctx.percentile}` : `rank ${ctx.rank}`;
  return `Perfect — predicting for your ${examLabel} ${score}…`;
}

function buildExamListHint() {
  return EXAM_OPTIONS.map((o) => o.label).join(', ');
}

module.exports = {
  buildConversationalWelcome,
  buildQuestionForSlot,
  buildInvalidMessage,
  buildPredictingMessage,
  buildExamListHint,
  clampReplyLines,
  MAX_NON_RESULT_LINES,
};
