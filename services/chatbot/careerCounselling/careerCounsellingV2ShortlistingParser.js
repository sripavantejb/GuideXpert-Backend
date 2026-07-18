'use strict';

const { normalizeText } = require('../intentTextUtils');
const { mapExamKey } = require('./careerCounsellingV2EligibilityService');

function parseExamAnswer(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;
  const exam = mapExamKey(raw);
  if (!exam) return null;
  return { exam, rawAnswer: raw.slice(0, 200) };
}

function parseRankAnswer(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const m = raw.match(/(\d{1,7})/);
  if (!m) return null;
  const rank = Number(m[1]);
  if (!Number.isFinite(rank) || rank <= 0) return null;
  return { rank, rawAnswer: raw.slice(0, 200) };
}

function parseCategoryAnswer(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return null;
  const t = raw.toUpperCase();

  let category = null;
  if (/\bOC\b|\bOPEN\b|\bGENERAL\b|\bGEN\b/.test(t)) category = 'OC';
  else if (/\bBC[\s-]?A\b|\bBCA\b/.test(t)) category = 'BC_A';
  else if (/\bBC[\s-]?B\b|\bBCB\b/.test(t)) category = 'BC_B';
  else if (/\bBC[\s-]?C\b|\bBCC\b/.test(t)) category = 'BC_C';
  else if (/\bBC[\s-]?D\b|\bBCD\b/.test(t)) category = 'BC_D';
  else if (/\bBC[\s-]?E\b|\bBCE\b/.test(t)) category = 'BC_E';
  else if (/\bSC\b/.test(t)) category = 'SC';
  else if (/\bST\b/.test(t)) category = 'ST';
  else if (/\bEWS\b/.test(t)) category = 'EWS';

  let gender = null;
  if (/\bGIRL|\bFEMALE|\bWOMEN/.test(t)) gender = 'female';
  else if (/\bBOY|\bMALE\b/.test(t)) gender = 'male';

  // Full AP-style code already provided
  if (/^(OC|BC[A-E]|SC|ST)\s+(BOYS|GIRLS)$/i.test(raw.trim())) {
    return {
      category: category || raw.split(/\s+/)[0].toUpperCase().replace('BC', 'BC_'),
      gender: /GIRL/i.test(raw) ? 'female' : 'male',
      reservationCategory: raw.trim().toUpperCase(),
      rawAnswer: raw.slice(0, 200),
    };
  }

  if (!category) {
    return {
      category: null,
      gender,
      reservationCategory: raw.slice(0, 64),
      rawAnswer: raw.slice(0, 200),
    };
  }

  return { category, gender, reservationCategory: null, rawAnswer: raw.slice(0, 200) };
}

function parseRegionAnswer(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (/\bau\b|andhra university/i.test(raw)) return { region: 'AU', admissionCategory: 'AU', rawAnswer: raw };
  if (/\bsvu\b|sri venkateswara/i.test(raw)) return { region: 'SVU', admissionCategory: 'SVU', rawAnswer: raw };
  return null;
}

function isShortlistAcknowledgment(text) {
  const t = normalizeText(text);
  return /^(ok|okay|yes|yeah|yep|sure|continue|go on|ready|proceed|let'?s go)$/i.test(t);
}

function isPermissionYes(text) {
  const t = normalizeText(text);
  return /^(yes|yeah|yep|yup|sure|ok|okay|please|y|continue|go ahead|compare)\b/i.test(t);
}

function isPermissionNo(text) {
  const t = normalizeText(text);
  return /^(no|nope|not now|later|nah|n|not yet)\b/i.test(t);
}

function isShortlistQuestion(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  return /\?\s*$|\b(what|how|why|when|where|which|tell me|explain)\b/i.test(t);
}

module.exports = {
  parseExamAnswer,
  parseRankAnswer,
  parseCategoryAnswer,
  parseRegionAnswer,
  isShortlistAcknowledgment,
  isPermissionYes,
  isPermissionNo,
  isShortlistQuestion,
};
