'use strict';

/**
 * Last-N-turns window for the turn context. Provider-agnostic: produces neutral
 * {role, text} entries, never provider message objects.
 */

const DEFAULT_WINDOW_TURNS = 6;
const DEFAULT_MAX_CHARS = 4000;
const MAX_PART_CHARS = 700;

function truncate(text, max = MAX_PART_CHARS) {
  const value = String(text == null ? '' : text);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * @param {Array<{role:string,text:string,at?:Date}>} turns oldest → newest
 * @param {{ windowTurns?: number, maxChars?: number }} [options]
 * @returns {{ entries: Array, droppedTurns: number, charCount: number }}
 */
function buildHistoryWindow(turns = [], options = {}) {
  const windowTurns = Number(options.windowTurns) > 0 ? Number(options.windowTurns) : DEFAULT_WINDOW_TURNS;
  const maxChars = Number(options.maxChars) > 0 ? Number(options.maxChars) : DEFAULT_MAX_CHARS;

  const ordered = Array.isArray(turns) ? turns.filter(Boolean) : [];
  const windowed = ordered.slice(-windowTurns);
  const droppedTurns = ordered.length - windowed.length;

  // Trim from the oldest end until the window fits the char budget; the newest
  // turn is what the reply must answer, so it is never the one dropped.
  const entries = [];
  let charCount = 0;
  for (let i = windowed.length - 1; i >= 0; i -= 1) {
    const turn = windowed[i];
    const text = truncate(turn.text);
    if (charCount + text.length > maxChars && entries.length > 0) break;
    entries.unshift({
      role: turn.role === 'bot' || turn.role === 'assistant' ? 'assistant' : 'user',
      text,
      at: turn.at || null,
    });
    charCount += text.length;
  }

  return {
    entries,
    droppedTurns: droppedTurns + (windowed.length - entries.length),
    charCount,
  };
}

module.exports = {
  DEFAULT_WINDOW_TURNS,
  DEFAULT_MAX_CHARS,
  buildHistoryWindow,
};
