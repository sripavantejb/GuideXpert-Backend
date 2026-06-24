const BDA_LEAD_TYPES = Object.freeze(['iit_counselling', 'counsellor', 'one_on_one']);

const BDA_LEAD_TYPE_LABELS = Object.freeze({
  iit_counselling: 'IIT Counselling',
  counsellor: 'Counsellor Program',
  one_on_one: 'One-on-One Counseling',
});

const BDA_LEAD_TYPE_SET = new Set(BDA_LEAD_TYPES);

function isValidBdaLeadType(value) {
  return typeof value === 'string' && BDA_LEAD_TYPE_SET.has(value.trim());
}

function normalizeBdaLeadType(value, fallback = 'iit_counselling') {
  const v = typeof value === 'string' ? value.trim() : '';
  return isValidBdaLeadType(v) ? v : fallback;
}

module.exports = {
  BDA_LEAD_TYPES,
  BDA_LEAD_TYPE_LABELS,
  BDA_LEAD_TYPE_SET,
  isValidBdaLeadType,
  normalizeBdaLeadType,
};
