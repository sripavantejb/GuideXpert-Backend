'use strict';

const PLACEHOLDER_API_KEY_PATTERNS = [
  /placeholder/i,
  /^your[_-]?gupshup/i,
  /^changeme$/i,
  /^xxx+$/i,
  /^local-dev-placeholder$/i,
];

/** Known dev placeholder sender (see .env.gupshup.local.example). */
const PLACEHOLDER_SOURCE_DIGITS = new Set(['9199999999999']);

function isIntegrationStubEnabled() {
  return String(process.env.WA_INTEGRATION_STUB || '').trim() === '1';
}

function isPlaceholderGupshupApiKey(apiKey) {
  const value = String(apiKey || '').trim();
  if (!value) return true;
  return PLACEHOLDER_API_KEY_PATTERNS.some((pattern) => pattern.test(value));
}

function isPlaceholderGupshupSource(source) {
  const digits = String(source || '').trim().replace(/\D/g, '');
  if (!digits) return true;
  return PLACEHOLDER_SOURCE_DIGITS.has(digits);
}

/**
 * Human-readable issues for startup logs and health checks (no secrets).
 */
function getGupshupCredentialIssues() {
  const issues = [];
  if (isIntegrationStubEnabled()) {
    issues.push('WA_INTEGRATION_STUB=1 — WhatsApp sends are simulated locally');
  }
  const apiKey = process.env.GUPSHUP_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    issues.push('GUPSHUP_API_KEY is missing');
  } else if (isPlaceholderGupshupApiKey(apiKey)) {
    issues.push('GUPSHUP_API_KEY appears to be a placeholder');
  }
  const source = process.env.GUPSHUP_SOURCE;
  if (!source || !String(source).trim()) {
    issues.push('GUPSHUP_SOURCE is missing');
  } else if (isPlaceholderGupshupSource(source)) {
    issues.push('GUPSHUP_SOURCE is the placeholder test number (9199999999999)');
  }
  return issues;
}

function isGupshupOutboundConfigured() {
  return getGupshupCredentialIssues().length === 0;
}

module.exports = {
  isIntegrationStubEnabled,
  isPlaceholderGupshupApiKey,
  isPlaceholderGupshupSource,
  getGupshupCredentialIssues,
  isGupshupOutboundConfigured,
};
