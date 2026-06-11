'use strict';

const ALLOWED_KB_CATEGORIES = new Set(['iit_counselling', 'niit_counselling']);

const SHORT_IIT_QUERY_EXPANSIONS = {
  float: 'JoSAA float option seat allocation upgrade',
  slide: 'JoSAA slide option branch change downgrade',
  freeze: 'JoSAA freeze option accept allotted seat',
  rounds: 'JoSAA counselling rounds how many',
  round: 'JoSAA counselling round process',
  quota: 'JEE counselling quota home state other state',
  josaa: 'JoSAA joint seat allocation authority IIT NIT IIIT',
  csab: 'CSAB special round counselling NIT IIIT CFTI',
  crl: 'CRL common rank list JEE Main rank',
  'obc ncl': 'OBC-NCL rank category reserved seat allocation JoSAA',
  'obc-ncl': 'OBC-NCL rank category reserved seat allocation JoSAA',
  ews: 'GEN-EWS rank economically weaker section reservation JoSAA',
  'gen ews': 'GEN-EWS rank economically weaker section reservation JoSAA',
  sc: 'SC rank scheduled caste category rank JoSAA',
  st: 'ST rank scheduled tribe category rank JoSAA',
  'home state': 'home state quota JoSAA seat allocation domicile',
  'other state': 'other state quota JoSAA seat allocation',
  'float ante enti': 'JoSAA float option seat allocation Telugu',
  'slide ante enti': 'JoSAA slide option branch allocation Telugu',
  'rounds kitne': 'JoSAA counselling rounds how many Hindi',
  'josaa kya hai': 'JoSAA joint seat allocation authority Hindi',
};

const TOPIC_FALLBACK_PATTERNS = [
  { pattern: /\bobc[\s-]?ncl\b/i, questionPrefix: 'What is OBC-NCL rank' },
  { pattern: /\bcrl\b/i, questionPrefix: 'What is CRL rank' },
  { pattern: /\bgen[\s-]?ews\b|\bews rank\b/i, questionPrefix: 'What is GEN-EWS rank' },
  { pattern: /\bsc rank\b/i, questionPrefix: 'What is SC rank' },
  { pattern: /\bst rank\b/i, questionPrefix: 'What is ST rank' },
  { pattern: /home state quota/i, questionPrefix: 'What is home state quota' },
  { pattern: /other state quota/i, questionPrefix: 'What is other state quota' },
  { pattern: /\bfloat\b/i, questionPrefix: 'What is float' },
  { pattern: /\bslide\b/i, questionPrefix: 'What is slide' },
  { pattern: /\bfreeze\b/i, questionPrefix: 'What is freezing and floating' },
  { pattern: /\bcsab\b/i, questionPrefix: 'What is CSAB' },
  { pattern: /\bjosaa\b.*\bround/i, questionPrefix: 'How many rounds are there in JoSAA' },
  { pattern: /\brounds?\b/i, questionPrefix: 'How many rounds are there in JoSAA' },
];

module.exports = {
  ALLOWED_KB_CATEGORIES,
  SHORT_IIT_QUERY_EXPANSIONS,
  TOPIC_FALLBACK_PATTERNS,
};
