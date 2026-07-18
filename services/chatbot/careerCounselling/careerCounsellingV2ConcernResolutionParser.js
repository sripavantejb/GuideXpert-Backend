'use strict';

const { normalizeText } = require('../intentTextUtils');
const {
  CONCERN_CATEGORIES,
  getCategoryById,
  normalizeConcernId,
} = require('../../../constants/careerCounsellingV2ConcernResolution');
const { classifyConcernText, mapLegacyConcern } = require('./careerCounsellingV2ConcernResolutionCore');

function formatActiveConcernChoices(activeConcerns = []) {
  const list = (Array.isArray(activeConcerns) ? activeConcerns : []).map((id, i) => {
    const cat = getCategoryById(mapLegacyConcern(id));
    return `${i + 1}. ${cat.label}`;
  });
  return list.join('\n');
}

function parseConcernPick(text, activeConcerns = []) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const active = (Array.isArray(activeConcerns) ? activeConcerns : []).map(mapLegacyConcern);

  const t = normalizeText(raw);
  const num = raw.match(/\b(\d{1,2})\b/);
  if (num) {
    const idx = Number(num[1]);
    if (idx >= 1 && idx <= active.length) {
      return { category: active[idx - 1], source: 'pick', rawAnswer: raw.slice(0, 200) };
    }
  }

  for (const id of active) {
    const cat = getCategoryById(id);
    const label = normalizeText(cat.label);
    if (t.includes(id.replace(/_/g, ' ')) || (label && t.includes(label))) {
      return { category: id, source: 'pick', rawAnswer: raw.slice(0, 200) };
    }
  }

  const classified = classifyConcernText(raw);
  if (classified) {
    return {
      category: classified.category,
      source: active.includes(classified.category) ? 'pick' : 'new',
      rawAnswer: classified.rawAnswer,
    };
  }

  return null;
}

function isConcernResolvedYes(text) {
  const t = normalizeText(text);
  return /^(yes|yeah|yep|yup|y|resolved|addressed|clear(er)?|sorted|done|ok(ay)?|helps?|that helps)\b/i.test(
    t
  );
}

function isConcernResolvedNo(text) {
  const t = normalizeText(text);
  return /^(no|nope|nah|n|not really|still worried|still open|not yet|unresolved)\b/i.test(t);
}

function isConcernContinue(text) {
  const t = normalizeText(text);
  return /^(continue|next|ready|proceed|move on|go on|done|yes|yeah|yep|ok|okay)\b/i.test(t);
}

function isConcernPermissionYes(text) {
  const t = normalizeText(text);
  return /^(yes|yeah|yep|yup|sure|ok|okay|please|y|continue|go ahead)\b/i.test(t);
}

function isConcernPermissionNo(text) {
  const t = normalizeText(text);
  return /^(no|nope|not now|later|nah|n|not yet)\b/i.test(t);
}

function isConcernQuestion(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  if (isConcernContinue(t) && !/\?/.test(t)) return false;
  return /\?\s*$|\b(what|how|why|when|where|which|tell me|explain)\b/i.test(t);
}

function looksLikeNewConcern(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 3) return false;
  if (isConcernResolvedYes(raw) || isConcernResolvedNo(raw) || isConcernContinue(raw)) return false;
  return CONCERN_CATEGORIES.some(
    (cat) => cat.id !== 'other' && cat.patterns.some((re) => re.test(raw))
  );
}

module.exports = {
  formatActiveConcernChoices,
  parseConcernPick,
  isConcernResolvedYes,
  isConcernResolvedNo,
  isConcernContinue,
  isConcernPermissionYes,
  isConcernPermissionNo,
  isConcernQuestion,
  looksLikeNewConcern,
  normalizeConcernId,
};
