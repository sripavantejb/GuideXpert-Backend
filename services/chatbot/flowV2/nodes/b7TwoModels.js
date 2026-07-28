'use strict';

/**
 * Flow V3 — B7 · TWO MODELS (Company Stage 7).
 * Framing bubbles, then ask before showing the top-5 shortlist (no auto-dump).
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { handleB8ShortlistAskEntry } = require('./b8FlatShortlist');
const { withMergedProfile, combineNodeResults } = require('../flowV2NodeUtils');

const TWO_MODELS_PART_1 = [
  'Great! 👍',
  "Before I suggest colleges, here's something important.",
  'Today, students generally have two choices:',
  '🏛️ Traditional Colleges',
  '📚 Curriculum updates less frequently',
  '📝 Theory & semester-focused learning',
  '🎓 More focus on exams than practical skills',
  '💻 Limited industry exposure',
  '📉 Placements usually start in the final year',
  '🚀 New-Age Colleges',
  '✅ Industry projects from Day 1',
  '✅ Coding from Day 1',
  '✅ AI & emerging technologies',
  '✅ Internships and hands-on learning',
  '✅ Regularly updated curriculum',
  '✅ Job-ready skills with strong placement support',
].join('\n');

const TWO_MODELS_PART_2 =
  "The biggest difference isn't the campus—it's how well the college prepares you for your career.";

/** Combined for tests / callers that expect a single string. */
const TWO_MODELS_TEXT = `${TWO_MODELS_PART_1}\n\n${TWO_MODELS_PART_2}`;

function handleB7TwoModelsEntry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  if (profile.frameSent === true) {
    return handleB8ShortlistAskEntry(withMergedProfile(ctx, profile));
  }
  const merged = mergeFlowV2Profile(profile, { frameSent: true });
  const ask = handleB8ShortlistAskEntry(withMergedProfile(ctx, merged));
  return combineNodeResults([TWO_MODELS_PART_1, TWO_MODELS_PART_2], ask);
}

module.exports = {
  handleB7TwoModelsEntry,
  TWO_MODELS_TEXT,
  TWO_MODELS_PART_1,
  TWO_MODELS_PART_2,
};
