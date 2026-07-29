'use strict';

/**
 * Flow V3 — B7 · TWO MODELS (Company Stage 7).
 * Framing bubbles, then ask before showing the top-5 shortlist (no auto-dump).
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { handleB8ShortlistAskEntry } = require('./b8FlatShortlist');
const { withMergedProfile } = require('../flowV2NodeUtils');

/** Traditional vs new-age comparison card — the framing is carried by the image. */
const TWO_MODELS_IMAGE_URL =
  'https://res.cloudinary.com/dfqdb1xws/image/upload/v1785308851/WhatsApp_Image_2026-07-29_at_12.35.01_PM_bm2zsf.jpg';

const TWO_MODELS_TEXT = [
  'Great! 👍',
  '',
  "Before I recommend colleges, here's something every student should know.",
].join('\n');

function twoModelsMedia() {
  return { type: 'image', url: TWO_MODELS_IMAGE_URL, caption: TWO_MODELS_TEXT };
}

function handleB7TwoModelsEntry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  if (profile.frameSent === true) {
    return handleB8ShortlistAskEntry(withMergedProfile(ctx, profile));
  }
  const merged = mergeFlowV2Profile(profile, { frameSent: true });
  const ask = handleB8ShortlistAskEntry(withMergedProfile(ctx, merged));
  return { ...ask, replyMedia: twoModelsMedia() };
}

module.exports = {
  handleB7TwoModelsEntry,
  TWO_MODELS_TEXT,
  TWO_MODELS_IMAGE_URL,
};
