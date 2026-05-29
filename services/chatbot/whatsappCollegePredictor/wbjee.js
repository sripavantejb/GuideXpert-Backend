const WBJEE_CATEGORY_OPTIONS = [
  { id: 1, value: 'OPEN', label: 'OPEN' },
  { id: 2, value: 'OBC_A', label: 'OBC - A' },
  { id: 3, value: 'SC', label: 'SC' },
  { id: 4, value: 'ST', label: 'ST' },
  { id: 5, value: 'TUITION_FEE_WAIVER', label: 'Tuition Fee Waiver' },
  { id: 6, value: 'OBC_B', label: 'OBC - B' },
  { id: 7, value: 'OPEN_PWD', label: 'Open (PwD)' },
  { id: 8, value: 'OBC_A_PWD', label: 'OBC - A (PwD)' },
  { id: 9, value: 'SC_PWD', label: 'SC (PwD)' },
  { id: 10, value: 'OBC_B_PWD', label: 'OBC - B (PwD)' },
];

const WBJEE_QUOTA_OPTIONS = [
  { id: 1, value: 'all_india', label: 'All India' },
  { id: 2, value: 'home_state_wb', label: 'Home State (West Bengal)' },
];

const WBJEE_RESERVATION_WHITELIST = new Set([
  'TUITION_FEE_WAIVER_HS',
  'OPEN_AI', 'OBC_B_HS', 'OBC_A_HS', 'OPEN_HS',
  'SC_HS', 'ST_HS', 'OPEN_PWD_HS', 'SC_PWD_HS',
  'OBC_B_PWD_HS', 'OBC_A_PWD_HS', 'ST_AI',
]);

const WBJEE_HOME_STATE_ONLY_CATEGORY_BASES = new Set([
  'TUITION_FEE_WAIVER',
  'OPEN_PWD',
  'OBC_A_PWD',
  'OBC_B_PWD',
  'SC_PWD',
]);

function getWbjeeReservationCategoryCode(categoryBase, quotaKey) {
  const base = String(categoryBase || '').trim();
  if (!base) return null;
  if (WBJEE_HOME_STATE_ONLY_CATEGORY_BASES.has(base) && quotaKey === 'all_india') {
    return null;
  }
  const suffix = quotaKey === 'all_india' ? 'AI' : 'HS';
  const code = `${base}_${suffix}`;
  if (!WBJEE_RESERVATION_WHITELIST.has(code)) return null;
  return code;
}

module.exports = {
  WBJEE_CATEGORY_OPTIONS,
  WBJEE_QUOTA_OPTIONS,
  getWbjeeReservationCategoryCode,
};
