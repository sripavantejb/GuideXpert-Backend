'use strict';

const ALLOWED_KB_CATEGORIES = new Set(['iit_counselling_strategy']);

const SHORT_STRATEGY_QUERY_EXPANSIONS = {
  'cse vs ece': 'CSE vs ECE branch comparison counselling strategy placements coding',
  'iit vs nit': 'IIT vs NIT which is better counselling strategy trade-offs',
  float: 'when should I use float JoSAA strategy safer option',
  freeze: 'when should I freeze JoSAA strategy accept seat',
  slide: 'when should I use slide branch sliding strategy',
  placements: 'branch placements comparison strategy trade-offs not guarantees',
  coding: 'CSE ECE coding interest branch choice strategy',
  'branch vs college': 'prioritize branch or college counselling strategy',
  'cse ece': 'CSE vs ECE branch counselling strategy',
  'float kab use karein': 'when should I use float JoSAA Hindi strategy',
  'freeze kab karein': 'when should I freeze JoSAA Hindi strategy',
  'branch kaun sa better': 'which branch is better counselling strategy Hindi',
  'cse ya ece': 'CSE vs ECE branch comparison counselling strategy',
  'cse leda ece': 'CSE vs ECE branch comparison counselling strategy Telugu',
  'coding nachite': 'CSE ECE coding interest branch choice strategy',
  'coding pasand ho to': 'CSE ECE coding interest branch choice strategy Hindi',
  'coding pasand': 'CSE ECE coding interest branch choice strategy Hindi',
  'should i use slide': 'Should I use slide JoSAA branch sliding strategy',
};

const TOPIC_FALLBACK_PATTERNS = [
  { pattern: /\bcse\b.*\b(vs|or|ya|leda)\b.*\bece\b/i, questionPrefix: 'Should I choose CSE or ECE' },
  { pattern: /\biit\b.*\b(vs|or)\b.*\bnit\b/i, questionPrefix: 'Which is better' },
  { pattern: /branch.*college|college.*branch/i, questionPrefix: 'Should I prioritize branch or college' },
  { pattern: /\bwhen should i (use|choose) float\b/i, questionPrefix: 'When should I use float' },
  { pattern: /\bwhen to float\b/i, questionPrefix: 'When to float in JoSAA' },
  { pattern: /\bwhen should i freeze\b/i, questionPrefix: 'When should I freeze' },
  { pattern: /\bwhen to freeze\b/i, questionPrefix: 'When to freeze in JoSAA' },
  { pattern: /\bshould i use slide\b/i, questionPrefix: 'Should I use slide' },
  { pattern: /\bwhen should i (use |choose )?slide\b/i, questionPrefix: 'When should I use slide instead of float' },
  { pattern: /\bpasand\b/i, questionPrefix: 'Coding pasand ho to' },
  { pattern: /\bnachite\b/i, questionPrefix: 'Coding nachite' },
  { pattern: /\bcoding\b/i, questionPrefix: 'What if I like coding' },
  { pattern: /\bwhich has better placements\b/i, questionPrefix: 'CSE vs ECE — which has better placements' },
  { pattern: /^placements?\s*[.!?]?$/i, questionPrefix: 'Placements vs interest' },
  { pattern: /\bcircuit branch/i, questionPrefix: 'Should I prefer circuit branches' },
  { pattern: /\bbranch slid/i, questionPrefix: 'Is branch sliding useful' },
  { pattern: /\bcsab\b/i, questionPrefix: 'When should I consider CSAB' },
  { pattern: /\bcommon mistake/i, questionPrefix: 'What are common JoSAA counselling mistakes' },
];

module.exports = {
  ALLOWED_KB_CATEGORIES,
  SHORT_STRATEGY_QUERY_EXPANSIONS,
  TOPIC_FALLBACK_PATTERNS,
};
