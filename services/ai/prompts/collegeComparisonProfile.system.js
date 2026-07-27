'use strict';

const fs = require('fs');
const path = require('path');

const PROMPT_FILE = path.join(__dirname, 'collegeComparisonProfile.system.md');
let cachedPrompt = null;
let cachedMtimeMs = null;

function buildCollegeComparisonProfileSystemPrompt() {
  try {
    const stats = fs.statSync(PROMPT_FILE);
    if (cachedPrompt != null && cachedMtimeMs === stats.mtimeMs) return cachedPrompt;
    cachedPrompt = fs.readFileSync(PROMPT_FILE, 'utf8').trim();
    cachedMtimeMs = stats.mtimeMs;
    return cachedPrompt;
  } catch {
    return 'Return only compact JSON college profile facts. Do not invent cutoffs. Use null for unknown numbers.';
  }
}

module.exports = { buildCollegeComparisonProfileSystemPrompt, PROMPT_FILE };
