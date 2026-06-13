'use strict';

const ALLOWED_CATEGORIES = Object.freeze([
  'iit_counselling',
  'josaa',
  'csab',
  'rank_prediction',
  'college_prediction',
  'branch_guidance',
  'admissions',
  'scholarship',
  'fees',
  'hostel',
  'placements',
  'guidexpert_services',
  'career_guidance',
]);

const DENY_CATEGORIES = Object.freeze([
  'programming',
  'image_generation',
  'movies',
  'weather',
  'sports',
  'politics',
  'finance',
  'general_trivia',
]);

/**
 * Level 1 - hard deny patterns. Each entry blocks the message unless a strong
 * allow signal is also present (see scopeFirewallService decision logic).
 */
const DENY_PATTERNS = Object.freeze([
  // programming
  { category: 'programming', pattern: /\bpython\b/i },
  { category: 'programming', pattern: /\bjava(script)?\b/i },
  { category: 'programming', pattern: /\breact(\.?js)?\b/i },
  { category: 'programming', pattern: /\bnode(\.?js)?\b/i },
  { category: 'programming', pattern: /\bc\+\+\b/i },
  { category: 'programming', pattern: /\bleetcode\b/i },
  { category: 'programming', pattern: /\bbinary tree\b/i },
  { category: 'programming', pattern: /\b(sorting|search(ing)?) algorithm\b/i },
  { category: 'programming', pattern: /\bwrite (me )?(some )?code\b/i },
  { category: 'programming', pattern: /\b(write|give|generate|share).{0,20}\bcode\b/i },
  { category: 'programming', pattern: /\bcode for\b/i },
  { category: 'programming', pattern: /\bimplement\b/i },
  { category: 'programming', pattern: /\bdebug\b/i },
  { category: 'programming', pattern: /\bfunction to\b/i },
  { category: 'programming', pattern: /\bcalculator code\b/i },

  // image generation
  { category: 'image_generation', pattern: /\b(generate|create|draw|make|render)\b.{0,20}\b(image|picture|photo|pic|drawing|art)\b/i },
  { category: 'image_generation', pattern: /\b(image|picture|photo|pic) of\b/i },

  // weather
  { category: 'weather', pattern: /\bweather\b/i },
  { category: 'weather', pattern: /\btemperature\b/i },
  { category: 'weather', pattern: /\brain forecast\b/i },
  { category: 'weather', pattern: /\bforecast\b/i },

  // movies / entertainment
  { category: 'movies', pattern: /\bmovies?\b/i },
  { category: 'movies', pattern: /\bavengers\b/i },
  { category: 'movies', pattern: /\bactor\b/i },
  { category: 'movies', pattern: /\bactress\b/i },
  { category: 'movies', pattern: /\bsongs?\b/i },
  { category: 'movies', pattern: /\blyrics\b/i },
  { category: 'movies', pattern: /\bnetflix\b/i },

  // sports
  { category: 'sports', pattern: /\bipl\b/i },
  { category: 'sports', pattern: /\bcricket\b/i },
  { category: 'sports', pattern: /\bfootball\b/i },
  { category: 'sports', pattern: /\b(match|game) score\b/i },

  // politics
  { category: 'politics', pattern: /\belections?\b/i },
  { category: 'politics', pattern: /\bprime minister\b/i },
  { category: 'politics', pattern: /\bpolitical party\b/i },
  { category: 'politics', pattern: /\bpolitics\b/i },

  // finance
  { category: 'finance', pattern: /\bstocks?\b/i },
  { category: 'finance', pattern: /\bshare market\b/i },
  { category: 'finance', pattern: /\bstock market\b/i },
  { category: 'finance', pattern: /\bcrypto(currency)?\b/i },
  { category: 'finance', pattern: /\bbitcoin\b/i },
  { category: 'finance', pattern: /\bmutual funds?\b/i },
]);

/**
 * Level 2 - allow signals. Counselling-domain tokens that grant passage even
 * when a deny pattern matched (e.g. "I like python but want CSE in IIT").
 */
const ALLOW_SIGNAL_PATTERN =
  /\b(iit|nit|iiit|jee|josaa|csab|rank|ranks|branch|branches|cse|ece|eee|mech|civil|admission|admissions|college|colleges|hostel|fee|fees|placement|placements|scholarship|scholarships|counsell?ing|counsel(or|lor)|float|freeze|slide|cutoff|cutoffs|quota|seat|guidexpert)\b/i;

/**
 * Allowed exploratory counselling questions that may carry no explicit allow
 * token but are clearly in-domain (e.g. "which branch is good for me").
 */
const BRANCH_GUIDANCE_PATTERN =
  /\b(which|what|best|good)\b.{0,30}\b(branch|stream|course|college|career)\b/i;

module.exports = {
  ALLOWED_CATEGORIES,
  DENY_CATEGORIES,
  DENY_PATTERNS,
  ALLOW_SIGNAL_PATTERN,
  BRANCH_GUIDANCE_PATTERN,
};
