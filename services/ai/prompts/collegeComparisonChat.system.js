'use strict';

const fs = require('fs');
const path = require('path');

const PROMPT_FILE = path.join(__dirname, 'collegeComparisonChat.system.md');

let cachedPrompt = null;
let cachedMtimeMs = null;

function buildCollegeComparisonChatSystemPrompt() {
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
      '[college-comparison-chat] prompt file missing/unreadable, using fallback:',
      error.message
    );
    return [
      'You help students ask doubts about a college comparison.',
      'Use only the supplied comparison facts. Do not invent data.',
      'Keep answers under 120 words.',
    ].join('\n');
  }
}

module.exports = { buildCollegeComparisonChatSystemPrompt, PROMPT_FILE };
