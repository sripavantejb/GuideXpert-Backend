'use strict';

const ALLOW_CATEGORIES = Object.freeze([
  'iit_counselling',
  'josaa',
  'csab',
  'branch_guidance',
  'college_prediction',
  'career_guidance',
  'placements',
  'hostel',
  'fees',
  'scholarships',
]);

const BLOCK_CATEGORIES = Object.freeze([
  'programming',
  'image_generation',
  'movies',
  'weather',
  'sports',
  'finance',
  'politics',
  'medical',
  'legal',
  'adult',
  'religion',
  'current_affairs',
  'math',
  'prompt_injection',
]);

const POLICY_BLOCK_CATEGORIES = Object.freeze([
  'medical',
  'legal',
  'adult',
  'religion',
  'current_affairs',
  'math',
  'prompt_injection',
]);

const CLASSIFIER_TRIGGER_REASONS = Object.freeze([
  'no_deny_match',
  'low_confidence',
  'ambiguous',
]);

const CONFIDENCE_THRESHOLD = 0.92;

const CLASSIFIER_TIMEOUT_MS = 8000;
const CLASSIFIER_MAX_TOKENS = 120;

/** Standalone abbreviations that rules may miss or over-block. */
const AMBIGUOUS_ABBREV_RE =
  /^\s*(dsa|bfs|dfs|dp|bst|ll|os|dbms|cn|oop)\s*\.?\s*$/i;

const INDIC_SCRIPT_RE = /[\u0900-\u097F\u0980-\u09FF\u0A80-\u0AFF\u0B80-\u0BFF\u0C00-\u0C7F\u0D00-\u0D7F]/;

const SPACED_LETTERS_RE = /\b(?:[a-z]\s+){3,}[a-z]\b/i;

const HEX_SPACED_RE = /(?:\b[0-9a-f]{2}\s+){4,}[0-9a-f]{2}\b/i;

const URL_ENCODED_RE = /%[0-9a-f]{2}/i;

const BASE64_CANDIDATE_RE = /[A-Za-z0-9+/]{16,}={0,2}/;

const INJECTION_HINT_RE =
  /\b(ignore (all )?(previous|prior)|forget guidexpert|developer mode|act as chatgpt|you are chatgpt|system override)\b/i;

const CAREER_DISPUTE_RE =
  /\b(exam tips?|placement|roadmap|for cse|for students?|study tips?|preparation|prep|college|counsell?ing)\b/i;

module.exports = {
  ALLOW_CATEGORIES,
  BLOCK_CATEGORIES,
  POLICY_BLOCK_CATEGORIES,
  CLASSIFIER_TRIGGER_REASONS,
  CONFIDENCE_THRESHOLD,
  CLASSIFIER_TIMEOUT_MS,
  CLASSIFIER_MAX_TOKENS,
  AMBIGUOUS_ABBREV_RE,
  INDIC_SCRIPT_RE,
  SPACED_LETTERS_RE,
  HEX_SPACED_RE,
  URL_ENCODED_RE,
  BASE64_CANDIDATE_RE,
  INJECTION_HINT_RE,
  CAREER_DISPUTE_RE,
};
