'use strict';

const { normalizeText } = require('../intentTextUtils');
const {
  MIN_COMPARE_COLLEGES,
  MAX_COMPARE_COLLEGES,
} = require('../../../constants/careerCounsellingV2Comparison');

function listShortlistForSelection(recommended = []) {
  return (Array.isArray(recommended) ? recommended : []).map((c, i) => ({
    index: i + 1,
    collegeName: c.collegeName,
    branchName: c.branchName || null,
    tier: c.tier || null,
    raw: c,
  }));
}

function formatShortlistChoices(recommended = []) {
  const list = listShortlistForSelection(recommended);
  if (list.length === 0) return '';
  return list
    .map((item) => {
      const branch = item.branchName ? ` — ${item.branchName}` : '';
      const tier = item.tier ? ` (${String(item.tier).replace(/_/g, ' ')})` : '';
      return `${item.index}. ${item.collegeName}${branch}${tier}`;
    })
    .join('\n');
}

function pickByIndices(list, indices) {
  const out = [];
  const seen = new Set();
  for (const n of indices) {
    if (n < 1 || n > list.length) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(list[n - 1].raw);
  }
  return out;
}

/**
 * Parse which shortlisted colleges the student wants to compare.
 * @returns {{ colleges: object[], rawAnswer: string } | null}
 */
function parseCollegeSelection(text, recommended = []) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const list = listShortlistForSelection(recommended);
  if (list.length === 0) return null;

  const t = normalizeText(raw);

  if (/^(all|everything|whole shortlist)\b/.test(t)) {
    return {
      colleges: list.slice(0, MAX_COMPARE_COLLEGES).map((x) => x.raw),
      rawAnswer: raw.slice(0, 200),
    };
  }

  if (/\b(first|top)\s*(two|2)\b|\b1\s*(and|&|,)\s*2\b/.test(t)) {
    const colleges = pickByIndices(list, [1, 2]);
    if (colleges.length >= MIN_COMPARE_COLLEGES) {
      return { colleges, rawAnswer: raw.slice(0, 200) };
    }
  }

  if (/\b(first|top)\s*(three|3)\b/.test(t)) {
    const colleges = pickByIndices(list, [1, 2, 3]);
    if (colleges.length >= MIN_COMPARE_COLLEGES) {
      return { colleges, rawAnswer: raw.slice(0, 200) };
    }
  }

  const numMatches = [...raw.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1]));
  if (numMatches.length >= MIN_COMPARE_COLLEGES) {
    const colleges = pickByIndices(list, numMatches).slice(0, MAX_COMPARE_COLLEGES);
    if (colleges.length >= MIN_COMPARE_COLLEGES) {
      return { colleges, rawAnswer: raw.slice(0, 200) };
    }
  }

  // Name / partial matches
  const matched = [];
  const seenNames = new Set();
  for (const item of list) {
    const name = normalizeText(item.collegeName);
    if (!name) continue;
    const tokens = name.split(/\s+/).filter((w) => w.length > 3);
    const hit =
      t.includes(name) ||
      tokens.some((tok) => tok.length > 4 && t.includes(tok)) ||
      (item.branchName && t.includes(normalizeText(item.branchName)));
    if (hit && !seenNames.has(item.collegeName)) {
      seenNames.add(item.collegeName);
      matched.push(item.raw);
    }
  }
  if (matched.length >= MIN_COMPARE_COLLEGES) {
    return {
      colleges: matched.slice(0, MAX_COMPARE_COLLEGES),
      rawAnswer: raw.slice(0, 200),
    };
  }

  // Single number + "and best" style leftover: if exactly one number and "best"
  if (numMatches.length === 1 && /\bbest\b/.test(t) && list.length >= 2) {
    const a = pickByIndices(list, [numMatches[0]]);
    const best = list.find((x) => x.tier === 'best_match');
    if (a[0] && best && best.raw.collegeName !== a[0].collegeName) {
      return { colleges: [a[0], best.raw], rawAnswer: raw.slice(0, 200) };
    }
  }

  return null;
}

function isCompareContinue(text) {
  const {
    isPermissionAffirmative,
    normalizePermissionText,
  } = require('../permissionAffirmative');
  if (isPermissionAffirmative(text)) return true;
  const t = normalizePermissionText(text);
  return /^(done|go on|move on)$/i.test(t);
}

function isComparePermissionYes(text) {
  const { isPermissionAffirmative } = require('../permissionAffirmative');
  return isPermissionAffirmative(text);
}

function isComparePermissionNo(text) {
  const { isPermissionNegative } = require('../permissionAffirmative');
  return isPermissionNegative(text);
}

function isCompareQuestion(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  if (isCompareContinue(t)) return false;
  return /\?\s*$|\b(what|how|why|when|where|which|tell me|explain|compare|difference|versus|vs)\b/i.test(
    t
  );
}

function isCompareAcknowledgment(text) {
  const { isPermissionAffirmative } = require('../permissionAffirmative');
  return isPermissionAffirmative(text);
}

module.exports = {
  listShortlistForSelection,
  formatShortlistChoices,
  parseCollegeSelection,
  isCompareContinue,
  isComparePermissionYes,
  isComparePermissionNo,
  isCompareQuestion,
  isCompareAcknowledgment,
};
