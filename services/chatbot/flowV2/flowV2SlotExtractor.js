'use strict';

/**
 * Flow v2 — turn-level slot extraction.
 *
 * Pure function: (text, profile) -> sparse patch object containing only the
 * slots this function could confidently extract from `text`. Never emits a
 * key for a slot it did not confidently find (i.e. never emits null/undefined
 * values) — "additive" merging is enforced downstream by
 * `flowV2ProfileMerge.mergeFlowV2Profile`, but this function already keeps
 * its output sparse so a single-slot message never risks nulling anything.
 *
 * Deliberately self-contained — does NOT reuse
 * `whatsappCollegePredictor/collegePredictorSlotExtractor.js`, since that
 * module's exam-specific coupling (menu digits, per-exam category tables)
 * is out of scope for this minimal Flow v2 pass.
 *
 * `profile` is accepted for future contextual extraction (e.g. avoiding
 * re-derivation once a slot is already known with higher confidence) but is
 * not required by the current extractors — kept in the signature for
 * forward-compatibility with later beats.
 */

const QUALIFICATION_GROUP_KEYWORDS = ['mpc', 'mec', 'bipc', 'cec', 'hec'];

/** Display casing for 12th-group codes (replaces a blanket .toUpperCase()
 * so 'bipc' renders as the conventional 'BiPC', not 'BIPC'). */
const QUALIFICATION_GROUP_LABELS = Object.freeze({
  mpc: 'MPC',
  mec: 'MEC',
  bipc: 'BiPC',
  cec: 'CEC',
  hec: 'HEC',
});

/**
 * Extended (Flow v2 Phase 2) to also recognize Class 10, Class 11, the
 * combined MEC/CEC commerce group, "Dropper / gap year", and "Already in
 * college" — closing the gap between the original 12th/Diploma/B.Tech-year/
 * Graduation-only coverage and the Greeting node's 9-row qualification
 * taxonomy, so the SAME extractor resolves both tapped list rows (row
 * titles arrive as plain text) and free-typed replies.
 */
function extractQualification(t) {
  // Combined MEC/CEC group, checked before the single-group match below.
  if (/\bmec\s*\/\s*cec\b/.test(t) || (/\bmec\b/.test(t) && /\bcec\b/.test(t))) {
    if (/\b12\s*th\b|\bclass\s*12\b|\bxii\b|\bintermediate\b|\binter\b/.test(t)) {
      return 'Class 12 (MEC/CEC)';
    }
  }
  const groupMatch = t.match(new RegExp(`\\b(${QUALIFICATION_GROUP_KEYWORDS.join('|')})\\b`));
  if (/\b12\s*th\b|\bclass\s*12\b|\bxii\b|\bintermediate\b|\binter\b/.test(t)) {
    return groupMatch ? `Class 12 (${QUALIFICATION_GROUP_LABELS[groupMatch[1]]})` : 'Class 12 / Intermediate';
  }
  if (/\bclass\s*10\b|\b10\s*th\b/.test(t)) return 'Class 10';
  if (/\bclass\s*11\b|\b11\s*th\b/.test(t)) return 'Class 11';
  if (/\bdiploma\b/.test(t)) return 'Diploma';
  const btechYear = t.match(/\bb\.?\s*tech\b[^.]{0,20}\b(1st|first|2nd|second|3rd|third|4th|fourth)\s*year\b/);
  if (btechYear) return `B.Tech ${btechYear[1]} year`;
  if (/\bdropper\b|\bgap year\b/.test(t)) return 'Dropper / gap year';
  if (/\balready in college\b|\balready studying\b|\bpursuing (my )?(degree|graduation|b\.?\s*tech)\b/.test(t)) {
    return 'Already in college';
  }
  if (/\bgraduation\b|\bgraduate\b|\bdegree\b/.test(t)) return 'Graduation';
  return null;
}

const BRANCH_KEYWORD_MAP = Object.freeze([
  Object.freeze({ re: /\bcse\b|\bcomputer science\b/, label: 'CSE' }),
  Object.freeze({ re: /\bece\b|\belectronics\b/, label: 'ECE' }),
  Object.freeze({ re: /\bmech(anical)?\b/, label: 'Mechanical' }),
  Object.freeze({ re: /\bcivil\b/, label: 'Civil' }),
  Object.freeze({ re: /\beee\b|\belectrical\b/, label: 'EEE' }),
  Object.freeze({ re: /\b(information technology|\bit\b)/, label: 'IT' }),
  Object.freeze({ re: /\bmbbs\b|\bmedicine\b|\bmedical\b/, label: 'MBBS' }),
  Object.freeze({ re: /\bmba\b|\bbba\b|\bbusiness\b|\bcommerce\b/, label: 'Business/Commerce' }),
  // Phase 4 (B2 · Branch) additions — map B2's own list-row titles (and
  // common free-text equivalents) to the SAME canonical values the B2.2
  // core-engineering fork itself uses ('cse_ai', matching the fork's F1/F2b
  // "route to coding" value) so a student arrives at the same destination
  // whether they picked it directly or via the fork's redirect. Appended
  // AFTER every entry above, so pre-existing free-text matches (e.g. "cse"
  // -> 'CSE', "business" -> 'Business/Commerce') are completely unchanged
  // — these only fire when nothing above already matched. "Core engineering
  // (mech, civil, ECE)" (B2's own generic core-engineering row title) is
  // deliberately NOT given a new entry here — it already matches an
  // existing pattern above (its title literally contains "mech", "civil",
  // AND "ece"). Note the \bece\b pattern is checked BEFORE \bmech(anical)?\b
  // in this array, so this generic tap actually resolves branchInterest to
  // 'ECE', not 'Mechanical' — harmless (isCoreEngineeringBranch in
  // b2Branch.js treats both as core-engineering), but worth knowing if
  // you're tracing branchInterest specifically. coreInterest is unaffected
  // either way — b2CoreFork.js's extractCoreField independently detects
  // "mech, civil, ECE" all appearing together and defaults to 'mechanical'
  // for that ambiguous case.
  Object.freeze({ re: /\bcoding\b|\bsoftware\b|\bartificial intelligence\b/, label: 'cse_ai' }),
  Object.freeze({ re: /\bdesign\b|\bproduct\b/, label: 'design' }),
  Object.freeze({ re: /\bdata\b|\banalytics\b/, label: 'data_analytics' }),
]);

function extractBranchInterest(t) {
  for (const { re, label } of BRANCH_KEYWORD_MAP) {
    if (re.test(t)) return label;
  }
  return null;
}

const BUDGET_BANDS = Object.freeze([
  { maxAmount: 200000, band: 'under_2l' },
  { maxAmount: 400000, band: '2_4l' },
  { maxAmount: 600000, band: '4_6l' },
  { maxAmount: 1000000, band: '6_10l' },
  { maxAmount: Infinity, band: 'above_10l' },
]);

/**
 * KNOWN BUG (found during Phase 5 / B3 · Constraints, not fixed here —
 * B3 itself routes around this via its own `extractB3BudgetTap` and never
 * calls this function for its own button taps, see b3Constraints.js).
 *
 * This function assumes a message states ONE specific rupee/lakh figure.
 * It has no concept of ranges or open-ended qualifiers, and — critically —
 * does not fail safely (return `null`) for either: it silently returns a
 * CONFIDENT, WRONG band instead.
 *   extractBudgetBand('between 2 and 5 lakhs') -> '4_6l' (keeps only the
 *     second number adjacent to "lakhs" and drops the range entirely;
 *     most of "2 to 5" is actually the '2_4l' band, not '4_6l')
 *   extractBudgetBand('2-5 lakhs') / ('2 to 5 lakhs') -> '4_6l' (same)
 *   extractBudgetBand('5 lakhs or more') -> '4_6l' (drops the open-ended
 *     qualifier and buckets it as if the family capped it around 6L)
 *   extractBudgetBand('more than 5 lakhs') -> '4_6l' (same)
 *   extractBudgetBand('5+ lakhs') -> null (this one narrow case DOES fail
 *     safely, but only because the bare '+' happens to break the regex's
 *     digit-then-unit-word boundary — not by design)
 *
 * LIVE RISK: R3 (over-answers) and R4-C (jump-ahead budget/money
 * statements) both call `extractFlowV2Slots` -> this function directly on
 * raw free text, with no B3-style tap-recognizer in front of it. A
 * student typing "more than 5 lakhs" or "between 2 and 5 lakhs" through
 * either of those buckets today gets a confidently wrong `budgetBand`
 * silently merged into their profile — no re-ask is triggered, because a
 * non-null value was returned.
 *
 * Not fixed as part of Phase 5 (out of scope) — needs its own ticket
 * against this function (range parsing + open-ended "+"/"or more"/"more
 * than" support, and — at minimum — returning `null` instead of a
 * plausible-looking wrong band whenever the match is ambiguous).
 */
function extractBudgetBand(t) {
  const cleaned = t.replace(/,/g, '');
  const lakhMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:lakhs?|l\b)/);
  let amount = null;
  if (lakhMatch) {
    amount = parseFloat(lakhMatch[1]) * 100000;
  } else {
    const rupeeMatch = cleaned.match(/(?:rs\.?|inr|₹)\s*(\d+(?:\.\d+)?)/);
    if (rupeeMatch) amount = parseFloat(rupeeMatch[1]);
  }
  if (amount == null || !Number.isFinite(amount)) return null;
  const found = BUDGET_BANDS.find((b) => amount <= b.maxAmount);
  return found ? found.band : null;
}

/** Curated, not exhaustive — extend as Flow v2's city coverage grows. */
const CITY_KEYWORDS = Object.freeze([
  'hyderabad',
  'bangalore',
  'bengaluru',
  'chennai',
  'pune',
  'mumbai',
  'delhi',
  'vijayawada',
  'visakhapatnam',
  'vishakhapatnam',
  'warangal',
  'kolkata',
  'ahmedabad',
]);

function extractCityPref(t) {
  for (const city of CITY_KEYWORDS) {
    if (t.includes(city)) return city.charAt(0).toUpperCase() + city.slice(1);
  }
  return null;
}

const EXAM_TYPE_PATTERNS = Object.freeze([
  Object.freeze({ re: /\bjee\s*adv/i, value: 'JEE_ADVANCED' }),
  Object.freeze({ re: /\bjee\b/i, value: 'JEE_MAIN' }),
  Object.freeze({ re: /\bap\s*eamcet\b|\beapcet\b/i, value: 'AP_EAMCET' }),
  Object.freeze({ re: /\bts\s*eamcet\b/i, value: 'TS_EAMCET' }),
  Object.freeze({ re: /\bkcet\b/i, value: 'KCET' }),
]);

function extractExamType(t) {
  for (const { re, value } of EXAM_TYPE_PATTERNS) {
    if (re.test(t)) return value;
  }
  return null;
}

/** Conservative: only fires with an explicit rank/AIR keyword, so it never
 * mistakes an unrelated number (e.g. a budget figure) for a rank. */
function extractRank(t) {
  if (!/\brank\b|\bair\b/.test(t)) return null;
  const match = t.replace(/,/g, '').match(/(\d{1,7})/);
  return match ? parseInt(match[1], 10) : null;
}

const CATEGORY_KEYWORDS = Object.freeze(['bc-a', 'bc-b', 'bc-c', 'bc-d', 'bc-e', 'oc', 'sc', 'st', 'ews', 'general']);

function extractCategory(t) {
  for (const c of CATEGORY_KEYWORDS) {
    const re = new RegExp(`\\b${c.replace('-', '[- ]?')}\\b`, 'i');
    if (re.test(t)) return c.toUpperCase();
  }
  return null;
}

function extractGender(t) {
  const male = /\b(male|boy|man)\b/.test(t);
  const female = /\b(female|girl|woman)\b/.test(t);
  if (male && !female) return 'male';
  if (female && !male) return 'female';
  return null;
}

const PRIORITY_KEYWORDS = Object.freeze([
  'placements',
  'placement',
  'research',
  'startup',
  'entrepreneurship',
  'internships',
  'internship',
  'fees',
  'affordable',
  'campus life',
  'mentorship',
  'faculty',
]);

/**
 * Phase 4 (B1 · Goal) additions — two of B1's own list-row titles ("AI &
 * future tech", "Higher studies later") don't have a safe bare keyword:
 * a plain substring 'ai' would false-positive inside ordinary words
 * ("said", "explain", "maintain", "again", "raise"...) under the
 * `.includes()` check PRIORITY_KEYWORDS uses above, so these are matched
 * with word-boundary-aware regexes instead and appended as their own
 * canonical labels.
 */
const PRIORITY_PHRASE_PATTERNS = Object.freeze([
  Object.freeze({ re: /\bai\b|\bartificial intelligence\b|\bfuture tech(nology)?\b/, label: 'ai_future_tech' }),
  Object.freeze({ re: /\bhigher studies\b|\bmasters\b|\bmba later\b|\bstudy abroad\b/, label: 'higher_studies' }),
]);

function extractGoalPriority(t) {
  const found = PRIORITY_KEYWORDS.filter((k) => t.includes(k)).map((k) => k.replace(/s$/, ''));
  for (const { re, label } of PRIORITY_PHRASE_PATTERNS) {
    if (re.test(t)) found.push(label);
  }
  if (!found.length) return null;
  return [...new Set(found)];
}

/** Returns `true` when mentioned, otherwise `null` (never an explicit
 * `false`) so the sparse-patch / additive-merge contract holds. */
function extractScholarshipFlag(t) {
  return /\bscholarship\b/i.test(t) ? true : null;
}

function extractIsParent(t) {
  return /\bmy (son|daughter|child)\b|\bas a parent\b/i.test(t) ? true : null;
}

/**
 * @param {string} text - inbound student message
 * @param {object} [profile] - current Flow v2 profile (reserved for future use)
 * @returns {object} sparse patch — only keys that were confidently extracted
 */
function extractFlowV2Slots(text, profile = {}) {
  const raw = String(text || '');
  const t = raw.toLowerCase();
  const patch = {};

  const maybeSet = (key, value) => {
    if (value !== null && value !== undefined) patch[key] = value;
  };

  maybeSet('qualification', extractQualification(t));
  maybeSet('branchInterest', extractBranchInterest(t));
  maybeSet('budgetBand', extractBudgetBand(t));
  maybeSet('cityPref', extractCityPref(t));
  maybeSet('examType', extractExamType(t));
  maybeSet('rank', extractRank(t));
  maybeSet('category', extractCategory(t));
  maybeSet('gender', extractGender(t));
  maybeSet('goalPriority', extractGoalPriority(t));
  maybeSet('scholarshipFlag', extractScholarshipFlag(t));
  maybeSet('isParent', extractIsParent(t));

  return patch;
}

module.exports = {
  extractFlowV2Slots,
  // exported individually for focused unit testing / future reuse
  extractQualification,
  extractBranchInterest,
  extractBudgetBand,
  extractCityPref,
  extractExamType,
  extractRank,
  extractCategory,
  extractGender,
  extractGoalPriority,
  extractScholarshipFlag,
  extractIsParent,
};
