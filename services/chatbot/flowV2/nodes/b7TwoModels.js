'use strict';

/**
 * Flow V3 — B7 · TWO MODELS (was v2 B4 bridge — rewritten honest both sides).
 * Zero taps; sets frameSent; advances to B8 same-turn via drain.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { advanceToB8 } = require('../flowV2NodeUtils');

const TWO_MODELS_TEXT = [
  "Before the names — one thing that'll help you read them.",
  '',
  "You're really choosing between two models, not just two campuses.",
  '',
  '🏛️ *Established colleges* — university degree, known name, big alumni base, usually cheaper. Curriculum updates on a university cycle, so it moves slower. Quality varies enormously between the good ones and the rest.',
  '',
  "🚀 *Newer industry-linked institutes* — coding and projects from year 1, curriculum updated yearly, close industry ties. But they're new: smaller alumni networks, shorter placement track records, and usually higher fees. Some are excellent. Some are marketing.",
  '',
  "Neither one wins by default. The checklist above is how you tell a good one from a bad one *within* either group — and that's the honest answer.",
].join('\n');

function handleB7TwoModelsEntry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  if (profile.frameSent === true) {
    return advanceToB8(profile, null);
  }
  const merged = mergeFlowV2Profile(profile, { frameSent: true });
  return {
    replyText: TWO_MODELS_TEXT,
    replyParts: null,
    interactive: null,
    contextPatch: { stage: 'b8_awaiting_entry', profile: merged },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleB7TwoModelsEntry,
  TWO_MODELS_TEXT,
};
