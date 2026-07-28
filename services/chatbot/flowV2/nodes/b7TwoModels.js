'use strict';

/**
 * Flow V3 — B7 · TWO MODELS (Company Stage 7).
 * Two bubbles (company script); sets frameSent; advances to B8 same-turn via drain.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { advanceToB8 } = require('../flowV2NodeUtils');

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
    return advanceToB8(profile, null);
  }
  const merged = mergeFlowV2Profile(profile, { frameSent: true });
  return {
    replyText: null,
    replyParts: [TWO_MODELS_PART_1, TWO_MODELS_PART_2],
    interactive: null,
    contextPatch: { stage: 'b8_awaiting_entry', profile: merged },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleB7TwoModelsEntry,
  TWO_MODELS_TEXT,
  TWO_MODELS_PART_1,
  TWO_MODELS_PART_2,
};
