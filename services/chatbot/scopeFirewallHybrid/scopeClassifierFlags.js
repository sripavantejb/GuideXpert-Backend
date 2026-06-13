'use strict';

function isScopeClassifierEnabled() {
  return String(process.env.CHATBOT_SCOPE_CLASSIFIER_ENABLED || '').trim() === '1';
}

function isScopeClassifierReady() {
  if (!isScopeClassifierEnabled()) return false;
  const apiKey = String(process.env.LLM_API_KEY || '').trim();
  const baseUrl = String(process.env.LLM_BASE_URL || '').trim();
  const model = String(process.env.LLM_MODEL || '').trim();
  return Boolean(apiKey && baseUrl && model);
}

module.exports = {
  isScopeClassifierEnabled,
  isScopeClassifierReady,
};
