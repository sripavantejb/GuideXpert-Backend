'use strict';

/**
 * Flow V3 — B7 · TWO MODELS entry (replaces one-sided v2 B4 bridge).
 * Parks at b8_awaiting_entry for same-turn drain.
 */

const { handleB7TwoModelsEntry, TWO_MODELS_TEXT } = require('./b7TwoModels');

/** @deprecated name — callers still use handleB4Entry after B6.5 constraints. */
function handleB4Entry(ctx) {
  return handleB7TwoModelsEntry(ctx);
}

module.exports = {
  handleB4Entry,
  BRIDGE_TEXT: TWO_MODELS_TEXT,
  TWO_MODELS_TEXT,
};
