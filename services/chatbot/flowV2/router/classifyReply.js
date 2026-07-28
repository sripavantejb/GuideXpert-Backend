'use strict';

/**
 * Flow v2 — reply-bucket classifier.
 *
 * `classifyReply(text, profile, ctx)` runs on every Flow v2 turn, after
 * `flowV2Dispatcher`'s crisis-lock short-circuit and Node 0's booking-override
 * pre-empt, and before any stage-specific handling. It decides which of 13
 * reply buckets (R1-R13) the inbound message falls into.
 *
 * Checked in this exact order — FIRST MATCH WINS, no exceptions:
 *   R7-Tier-2 (crisis)  > R7-Tier-1 (disappointment) > R12 (hostile/testing)
 *   > R11 (out of scope) > R8 (not the student) > R9 (non-text)
 *   > R6 (deflects) > R5 (asks about us) > R10 (ambiguous)
 *   > R4 (jumps ahead) > R3 (over-answers) > R2 (types) > R1 (taps, default)
 *
 * R7 Tier-2 is checked FIRST, always, unconditionally — it must never be
 * reachable through any other bucket's path, and no other bucket may ever
 * be checked before it. R13 (silence) is a timeout condition, never
 * returned by this function — see BUCKETS.R13 below for why.
 *
 * `ctx` here is the router-facing view built by flowV2Dispatcher — NOT the
 * full dispatcher ctx. Expected shape:
 *   { stage: string|null, messageType: string, pendingQualificationGuess: string|null }
 * `ctx.messageType` defaults to 'text' if the caller never had a real
 * inbound message-type to supply (see flowV2Dispatcher.js `meta.messageType`).
 */

const { extractFlowV2Slots } = require('../flowV2SlotExtractor');
const { isTier2Crisis, R7_TIER2_CRISIS_PATTERNS } = require('./crisisClassifier');

/** All 13 bucket ids, for reference/validation elsewhere. R13 is never
 * returned by classifyReply — see module docstring. */
const BUCKETS = Object.freeze({
  R1: 'R1',
  R2: 'R2',
  R3: 'R3',
  R4: 'R4',
  R5: 'R5',
  R6: 'R6',
  R7: 'R7',
  R8: 'R8',
  R9: 'R9',
  R10: 'R10',
  R11: 'R11',
  R12: 'R12',
  R13: 'R13',
});

/**
 * R7 TIER-2 — genuine distress / self-harm signals.
 *
 * FLAGGED FOR EXPLICIT REVIEW (per task instructions) — this is the single
 * highest-priority pattern list in this file. Deliberately conservative and
 * high-precision: every entry below is a strong, unambiguous statement of
 * hopelessness/self-harm intent, not a loose keyword. A false negative here
 * is worse than a narrower list that is reliably true when it fires, but a
 * false positive on ordinary disappointment (that belongs in R7 Tier-1
 * instead) would also misroute a student into an unrecoverable crisis lock —
 * so this list is intentionally NOT expanded with broad/ambiguous phrasing.
 */
/** R7 TIER-1 — disappointment / pressure. Does NOT overlap with Tier-2 —
 * checked second, only after Tier-2 has already failed to match. */
const R7_TIER1_PATTERNS = Object.freeze([
  /\bi failed\b/i,
  /\bvery less marks?\b/i,
  /\bmy parents are forcing me\b/i,
  /\beveryone('s| is) telling me different things\b/i,
  /\bi('m| am) not good enough\b/i,
  /\bfeel like giving up\b/i,
]);

/** R12 — hostile / testing / prompt-injection-shaped text. No existing
 * profanity/abuse detection utility exists anywhere in this backend
 * (confirmed by search) — this list is built from scratch, intentionally
 * short and conservative rather than an exhaustive profanity filter. */
const R12_HOSTILE_PATTERNS = Object.freeze([
  /\bare you (chatgpt|gpt|an? ai)\b/i,
  /\bignore (your|previous|all) instructions\b/i,
  /\bsystem prompt\b/i,
  /\bwrite me a poem\b/i,
  /\bpretend you are\b/i,
  /\bact as\b/i,
]);

/** R11 — out of scope (non-engineering career asks). */
const R11_OUT_OF_SCOPE_PATTERNS = Object.freeze([
  /\bmbbs\b/i,
  /\bnursing\b/i,
  /\blaw\b/i,
  /\bmba\b/i,
  /\bbba\b/i,
  /\bcharter(ed)? accountant\b/i,
  /\bca\b/i,
  /\bonly abroad\b/i,
  /\bphd\b/i,
  /\bi want a job\b/i,
]);

/** R8 — not the student (explicit third-party framing). */
const R8_NOT_STUDENT_PATTERNS = Object.freeze([
  /\bmy (son|daughter)\b/i,
  /\bfor my friend\b/i,
  /\bwrong number\b/i,
]);
const R8_VENDOR_SPAM_PATTERN = /\b(business|partnership|collaborate|collaboration)\b/i;
const URL_PATTERN = /\bhttps?:\/\/|\bwww\./i;

/** R6 — deflects. */
const R6_DEFLECT_PATTERNS = Object.freeze([
  /\bjust send( me)? the list\b/i,
  /\bnot interested\b/i,
  /\blater\b/i,
  /\bstop\b/i,
  /\bdon'?t message me\b/i,
]);

/** R5 — asks about us. */
const R5_ASKS_ABOUT_US_PATTERNS = Object.freeze([
  /\bis this a bot\b/i,
  /\bis this free\b/i,
  /\bwho are you\b/i,
  /\bhow did you get my number\b/i,
  /\bhow long will (this|it) take\b/i,
]);

/** R10 — ambiguous (recognized-but-incomplete). Bare = without a qualifying
 * group/context word that would let extractFlowV2Slots resolve confidently. */
const R10_BARE_INTER_PATTERN = /\binter\b/i;
const R10_BARE_YEAR_PATTERN = /\b(1st|first|2nd|second)\s*year\b/i;
const R10_PASSED_OUT_PATTERN = /\bpassed out\b/i;
const R10_12TH_PASS_PATTERN = /^\s*(?:12th|class\s*12)\s+pass(?:ed)?\s*$/i;
const R10_PCM_PATTERN = /\bpcm\b/i;
const R10_PCB_PATTERN = /\bpcb\b/i;

/** Known qualification-adjacent terms for the generic typo-guess sub-case. */
const R10_KNOWN_TERMS = Object.freeze([
  { term: 'diploma', guess: 'Diploma' },
  { term: 'graduation', guess: 'Degree' },
  { term: 'dropper', guess: 'Drop Year' },
]);

/** R4 — jumps ahead. Sub-case patterns, checked in this order. */
const R4_RANK_PATTERN =
  /\b((my|the|eamcet|jee|ts|ap|wbjee|kcet|mht)\s+)?(rank|percentile|air)\b|\brank\s*(is|=|:)?\s*\d|\b\d{2,7}\s*(rank|percentile|%ile)/i;
const R4_STICK_RANK_LIST_PATTERN = /\bstick to my rank list\b/i;
const R4_KNOWN_COLLEGES = Object.freeze([
  'plaksha',
  'scaler',
  'newton school',
  'kalvium',
  'niat',
  "masters' union",
  'masters union',
  'krea',
  'ahmedabad university',
  'upes',
  'srm ap',
]);
const R4_MONEY_PATTERN = /\b(fees?|cost|budget|scholarship)\b/i;
const R4_BEST_PATTERN = /\bbest college\b/i;
const R4_ADMISSION_PATTERN = /\b(admission|deadline|apply by)\b/i;
const R4_VS_PATTERN = /\b\w+\s+vs\s+\w+/i;
const R4_GOAL_PATTERN =
  /\b(i want|want to (become|do|study)|interested in|looking (at|for))\b.{0,40}\b(cse|ai|software|coding|mechanical|civil|ece|eee|engineer|engineering|data|design)\b/i;
const R4_UNKNOWN_COLLEGE_ASK_PATTERN =
  /\b(is|about|tell me about|what('?s| is)|how (is|good is))\b.{0,60}\b(any good|worth it|good\??|placements?|fees?)\b/i;

function levenshteinAtMost2(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[a.length][b.length] <= 2;
}

function matchAny(patterns, t) {
  return patterns.some((re) => re.test(t));
}

function classifyR4SubCase(t) {
  if (R4_STICK_RANK_LIST_PATTERN.test(t)) return null;
  if (R4_RANK_PATTERN.test(t)) return 'rank';
  if (R4_VS_PATTERN.test(t)) return 'vs';
  if (R4_KNOWN_COLLEGES.some((name) => t.includes(name))) return 'college';
  if (R4_MONEY_PATTERN.test(t)) return 'money';
  if (R4_UNKNOWN_COLLEGE_ASK_PATTERN.test(t)) return 'college';
  if (R4_GOAL_PATTERN.test(t)) return 'goal';
  if (R4_BEST_PATTERN.test(t)) return 'best';
  if (R4_ADMISSION_PATTERN.test(t)) return 'admission';
  return null;
}

/**
 * @param {string} text - inbound student message
 * @param {object} profile - current Flow v2 profile
 * @param {{ stage?: string|null, messageType?: string, pendingQualificationGuess?: string|null }} ctx
 * @returns {{ bucket: string, confidence: number, extractedSlots: object, subCase: string|null }}
 */
function classifyReply(text, profile = {}, ctx = {}) {
  const raw = String(text || '');
  const t = raw.toLowerCase();
  const messageType = ctx.messageType || 'text';

  // Defense in depth: the dispatcher already performs this exact I-10
  // check before Node 0 and before entering the router at all. Keep the
  // router-level check too for direct callers, and keep it before slot
  // extraction so even those callers preserve the same safety ordering.
  if (isTier2Crisis(raw)) {
    return { bucket: BUCKETS.R7, tier: 2, confidence: 0.98, extractedSlots: {}, subCase: 'tier2' };
  }

  const extractedSlots = extractFlowV2Slots(raw, profile);

  // R7 TIER-1 — checked second.
  if (matchAny(R7_TIER1_PATTERNS, t)) {
    return { bucket: BUCKETS.R7, tier: 1, confidence: 0.85, extractedSlots, subCase: 'tier1' };
  }

  // R12 — hostile/testing.
  if (matchAny(R12_HOSTILE_PATTERNS, t)) {
    return { bucket: BUCKETS.R12, confidence: 0.85, extractedSlots: {}, subCase: null };
  }

  // R11 — out of scope.
  if (matchAny(R11_OUT_OF_SCOPE_PATTERNS, t)) {
    return { bucket: BUCKETS.R11, confidence: 0.85, extractedSlots: {}, subCase: null };
  }

  // R8 — not the student.
  if (matchAny(R8_NOT_STUDENT_PATTERNS, t)) {
    return { bucket: BUCKETS.R8, confidence: 0.85, extractedSlots, subCase: 'third_party' };
  }
  if (URL_PATTERN.test(t) && R8_VENDOR_SPAM_PATTERN.test(t)) {
    return { bucket: BUCKETS.R8, confidence: 0.7, extractedSlots: {}, subCase: 'vendor_spam' };
  }

  // R9 — non-text.
  if (messageType !== 'text' && messageType !== 'button_reply' && messageType !== 'list_reply') {
    return { bucket: BUCKETS.R9, confidence: 0.95, extractedSlots: {}, subCase: messageType };
  }

  // R6 — deflects.
  if (matchAny(R6_DEFLECT_PATTERNS, t)) {
    return { bucket: BUCKETS.R6, confidence: 0.8, extractedSlots: {}, subCase: null };
  }

  // R5 — asks about us.
  if (matchAny(R5_ASKS_ABOUT_US_PATTERNS, t)) {
    return { bucket: BUCKETS.R5, confidence: 0.8, extractedSlots: {}, subCase: null };
  }

  // R10 — ambiguous (recognized-but-incomplete).
  const hasGroupKeyword = /\b(?:mpc|pcm|mec|cec|commerce|bipc|pcb|hec|arts)\b/.test(t);
  if (R10_PASSED_OUT_PATTERN.test(t)) {
    return { bucket: BUCKETS.R10, confidence: 0.6, extractedSlots: {}, subCase: 'passed_out' };
  }
  if (R10_12TH_PASS_PATTERN.test(t)) {
    return { bucket: BUCKETS.R10, confidence: 0.65, extractedSlots: {}, subCase: 'bare_12th_pass' };
  }
  if (R10_BARE_INTER_PATTERN.test(t) && !hasGroupKeyword) {
    return { bucket: BUCKETS.R10, confidence: 0.6, extractedSlots: {}, subCase: 'bare_inter' };
  }
  if (R10_BARE_YEAR_PATTERN.test(t) && !/\b(inter|12th|diploma|b\.?\s*tech|graduation)\b/.test(t)) {
    return { bucket: BUCKETS.R10, confidence: 0.6, extractedSlots: {}, subCase: 'bare_year' };
  }
  if (R10_PCM_PATTERN.test(t)) {
    return { bucket: BUCKETS.R10, confidence: 0.75, extractedSlots: {}, subCase: 'pcm' };
  }
  if (R10_PCB_PATTERN.test(t)) {
    return { bucket: BUCKETS.R10, confidence: 0.75, extractedSlots: {}, subCase: 'pcb' };
  }
  if (!extractedSlots.qualification) {
    const trimmed = t.trim();
    for (const { term, guess } of R10_KNOWN_TERMS) {
      if (trimmed !== term && trimmed.length >= 3 && levenshteinAtMost2(trimmed, term)) {
        return { bucket: BUCKETS.R10, confidence: 0.55, extractedSlots: {}, subCase: 'typo_guess', guess };
      }
    }
  }

  // R3 — over-answers (3+ extractable slots in one message). The Master
  // Flow's canonical R3 paste contains the word "budget", which also
  // resembles R4-C. Treat a genuinely multi-fact answer as R3 unless it is
  // rank-led (R4-P owns rank/exam jumps and must keep its earlier route).
  const r4SubCase = classifyR4SubCase(t);
  if (Object.keys(extractedSlots).length >= 3 && r4SubCase !== 'rank') {
    return { bucket: BUCKETS.R3, confidence: 0.8, extractedSlots, subCase: null };
  }

  // R4 — jumps ahead.
  if (r4SubCase) {
    return { bucket: BUCKETS.R4, confidence: 0.75, extractedSlots, subCase: r4SubCase };
  }

  // R3 — over-answers without an R4-shaped keyword.
  if (Object.keys(extractedSlots).length >= 3) {
    return { bucket: BUCKETS.R3, confidence: 0.8, extractedSlots, subCase: null };
  }

  // R2 — types (free text matching exactly one known slot value).
  if (messageType === 'text' && Object.keys(extractedSlots).length === 1) {
    return { bucket: BUCKETS.R2, confidence: 0.7, extractedSlots, subCase: null };
  }

  // R1 — taps (default/fallback bucket).
  return { bucket: BUCKETS.R1, confidence: 0.5, extractedSlots, subCase: null };
}

module.exports = {
  classifyReply,
  BUCKETS,
  R7_TIER2_CRISIS_PATTERNS,
  R7_TIER1_PATTERNS,
  R12_HOSTILE_PATTERNS,
  R11_OUT_OF_SCOPE_PATTERNS,
  R8_NOT_STUDENT_PATTERNS,
  R6_DEFLECT_PATTERNS,
  R5_ASKS_ABOUT_US_PATTERNS,
  R4_KNOWN_COLLEGES,
};
