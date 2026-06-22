'use strict';

const TOPIC_RULES = Object.freeze([
  { key: 'scholarship', label: 'Scholarship', patterns: [/\bscholarship\b/i, /\bfinancial aid\b/i] },
  { key: 'fees', label: 'Fees', patterns: [/\bfee?s\b/i, /\bcost\b/i, /\bbudget\b/i, /\btuition\b/i] },
  { key: 'hostel', label: 'Hostel', patterns: [/\bhostel\b/i, /\baccommodation\b/i, /\bhousing\b/i] },
  {
    key: 'placements',
    label: 'Placements',
    patterns: [/\bplacement\b/i, /\bpackage\b/i, /\bsalary\b/i, /\bjob\b/i],
  },
  {
    key: 'branch_selection',
    label: 'Branch selection',
    patterns: [/\bbranch\b/i, /\bcse\b/i, /\bece\b/i, /\bmechanical\b/i, /\bstream choice\b/i],
  },
  {
    key: 'rank_guidance',
    label: 'Rank guidance',
    patterns: [/\brank\b/i, /\bpercentile\b/i, /\bjee\b/i, /\ballotment\b/i],
  },
  {
    key: 'college_selection',
    label: 'College selection',
    patterns: [/\bcollege\b/i, /\buniversity\b/i, /\biit\b/i, /\bnit\b/i],
  },
]);

function extractEditTopic(text) {
  const haystack = String(text || '');
  for (const rule of TOPIC_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return rule.key;
    }
  }
  return 'general';
}

module.exports = {
  TOPIC_RULES,
  extractEditTopic,
};
