'use strict';

const {
  ALLOW_CATEGORIES,
  BLOCK_CATEGORIES,
  CONFIDENCE_THRESHOLD,
} = require('./scopeClassifierConstants');
const { SCOPE_INTENTS, mapCategoryToIntent } = require('../../../constants/scopeIntents');

function extractJsonObject(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function isValidCategory(category, allowed) {
  const list = allowed ? ALLOW_CATEGORIES : BLOCK_CATEGORIES;
  return list.includes(category);
}

function normalizeClassifierResult(raw) {
  const parsed = typeof raw === 'string' ? extractJsonObject(raw) : raw;
  if (!parsed || typeof parsed !== 'object') return null;

  const allowed = parsed.allowed === true;
  const category = String(parsed.category || '').trim();
  const confidence = Number(parsed.confidence);
  const reason = String(parsed.reason || '').trim();

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (!category || !reason) return null;
  if (!isValidCategory(category, allowed)) return null;

  let intent = String(parsed.intent || '').trim().toUpperCase();
  if (!intent) {
    intent = mapCategoryToIntent(category, { fromClassifier: true });
  }
  if (!SCOPE_INTENTS.includes(intent)) {
    intent = 'OTHER';
  }

  return {
    allowed,
    category,
    confidence,
    reason,
    intent,
    meetsThreshold: confidence >= CONFIDENCE_THRESHOLD,
  };
}

module.exports = {
  extractJsonObject,
  normalizeClassifierResult,
  isValidCategory,
};
