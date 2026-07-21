'use strict';

const { normalizeText } = require('../intentTextUtils');

function isPhase12Continue(text) {
  const { isPermissionAffirmative } = require('../permissionAffirmative');
  const {
    isExplicitBookingLinkRequest,
  } = require('./careerCounsellingV2BookingOrchestratorParser');
  if (isPermissionAffirmative(text)) return true;
  if (isExplicitBookingLinkRequest(text)) return true;
  const { normalizeText } = require('../intentTextUtils');
  const t = normalizeText(text);
  return /^(book|lets book|i want to book|i('m| am) interested)$/i.test(t);
}

function isPhase12Decline(text) {
  const { isPermissionNegative } = require('../permissionAffirmative');
  const { normalizeText } = require('../intentTextUtils');
  const t = normalizeText(text);
  if (isPermissionNegative(text)) return true;
  return /^(done|finish|finished|thanks|thank you)$/i.test(t);
}

function isPhase12Question(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (isPhase12Continue(raw) || isPhase12Decline(raw)) return false;
  if (/\?/.test(raw)) return true;
  return /\b(why|how|what|which|explain)\b/i.test(raw);
}

module.exports = {
  isPhase12Continue,
  isPhase12Decline,
  isPhase12Question,
};
