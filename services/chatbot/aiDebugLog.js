'use strict';

function isAiDebugEnabled() {
  return String(process.env.DEBUG_AI || '').trim().toLowerCase() === 'true';
}

function aiDebugLog(tag, ...args) {
  if (!isAiDebugEnabled()) return;
  console.log(`[${tag}]`, ...args);
}

module.exports = {
  isAiDebugEnabled,
  aiDebugLog,
};
