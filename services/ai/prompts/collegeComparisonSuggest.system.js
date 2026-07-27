'use strict';

const fs = require('fs');
const path = require('path');

const PROMPT_FILE = path.join(__dirname, 'collegeComparisonSuggest.system.md');

let cachedPrompt = null;
let cachedMtimeMs = null;

function buildCollegeComparisonSuggestSystemPrompt() {
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
      '[college-comparison-suggest] prompt file missing/unreadable, using fallback:',
      error.message
    );
    return [
      'Suggest real Indian colleges matching the query.',
      'Return JSON: { "colleges": [{ "name", "shortName", "city", "state", "ownership" }] }.',
      'Up to 8 results. No markdown.',
    ].join('\n');
  }
}

module.exports = { buildCollegeComparisonSuggestSystemPrompt, PROMPT_FILE };
