'use strict';

const fs = require('fs');
const path = require('path');

const PROMPT_FILE = path.join(__dirname, 'collegeComparison.system.md');

let cachedPrompt = null;
let cachedMtimeMs = null;

/**
 * Loads the editable college-comparison system prompt from
 * `collegeComparison.system.md` so you can update copy without touching JS.
 */
function buildCollegeComparisonSystemPrompt() {
  try {
    const stats = fs.statSync(PROMPT_FILE);
    if (cachedPrompt != null && cachedMtimeMs === stats.mtimeMs) {
      return cachedPrompt;
    }
    cachedPrompt = fs.readFileSync(PROMPT_FILE, 'utf8').trim();
    cachedMtimeMs = stats.mtimeMs;
    return cachedPrompt;
  } catch (error) {
    console.warn(
      '[college-comparison] prompt file missing/unreadable, using fallback:',
      error.message
    );
    return [
      '# GuideXpert College Comparison Assistant',
      '',
      'Summarize only the supplied college comparison JSON.',
      'Do not invent data. Keep under 120 words.',
      'Mention 2-4 trade-offs and give a soft recommendation.',
    ].join('\n');
  }
}

module.exports = { buildCollegeComparisonSystemPrompt, PROMPT_FILE };
