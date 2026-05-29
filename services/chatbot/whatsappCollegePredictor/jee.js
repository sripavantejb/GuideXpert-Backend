const JEE_CATEGORY_OPTIONS = [
  { id: 1, value: 'OPEN', label: 'OPEN' },
  { id: 2, value: 'OPEN (PwD)', label: 'OPEN (PwD)' },
  { id: 3, value: 'EWS', label: 'EWS' },
  { id: 4, value: 'EWS (PwD)', label: 'EWS (PwD)' },
  { id: 5, value: 'OBC-NCL', label: 'OBC-NCL' },
  { id: 6, value: 'OBC-NCL (PwD)', label: 'OBC-NCL (PwD)' },
  { id: 7, value: 'SC', label: 'SC' },
  { id: 8, value: 'SC (PwD)', label: 'SC (PwD)' },
  { id: 9, value: 'ST', label: 'ST' },
  { id: 10, value: 'ST (PwD)', label: 'ST (PwD)' },
];

const JEE_MAINS_ADVANCE_RESERVATION_QUOTAS = new Set([
  'OPEN_HS', 'OPEN_GIRLS_HS', 'EWS_HS', 'EWS_GIRLS_HS',
  'OBC-NCL_HS', 'OBC-NCL_GIRLS_HS', 'SC_HS', 'SC_GIRLS_HS',
  'OPEN_OS', 'OPEN_GIRLS_OS', 'EWS_OS', 'OBC-NCL_OS', 'OBC-NCL_GIRLS_OS',
  'SC_OS', 'SC_GIRLS_OS', 'ST_OS', 'OBC-NCL (PwD)_GIRLS_OS',
  'OPEN (PwD)_HS', 'OPEN (PwD)_OS', 'EWS_GIRLS_OS', 'ST_GIRLS_OS',
  'EWS (PwD)_OS', 'ST_HS', 'EWS (PwD)_HS', 'SC (PwD)_HS', 'ST_GIRLS_HS',
  'OPEN (PwD)_GIRLS_OS', 'OBC-NCL (PwD)_OS', 'ST (PwD)_OS', 'SC (PwD)_OS',
  'OBC-NCL (PwD)_HS', 'OPEN (PwD)_GIRLS_HS', 'OBC-NCL (PwD)_GIRLS_HS',
  'ST (PwD)_HS', 'EWS (PwD)_GIRLS_OS', 'SC (PwD)_GIRLS_OS',
  'EWS (PwD)_GIRLS_HS', 'ST (PwD)_GIRLS_OS',
  'OPEN_GO', 'OPEN_GIRLS_GO', 'OBC-NCL_GO', 'OBC-NCL_GIRLS_GO',
  'SC_GO', 'ST_GO', 'EWS_GO', 'SC_GIRLS_GO', 'EWS_GIRLS_GO', 'ST_GIRLS_GO',
  'OPEN_JK', 'OPEN_GIRLS_JK', 'SC_JK', 'SC_GIRLS_JK', 'ST_JK', 'ST_GIRLS_JK',
  'EWS_JK', 'OBC-NCL_JK', 'OPEN_LA', 'OPEN (PwD)_JK', 'EWS_GIRLS_JK',
  'OBC-NCL_GIRLS_JK', 'OPEN_GIRLS_LA', 'OBC-NCL (PwD)_JK', 'SC (PwD)_GIRLS_HS',
  'OPEN_AI', 'OPEN_GIRLS_AI', 'OPEN (PwD)_AI', 'EWS_AI', 'EWS_GIRLS_AI',
  'OBC-NCL_AI', 'OBC-NCL_GIRLS_AI', 'OBC-NCL (PwD)_AI',
  'SC_AI', 'SC_GIRLS_AI', 'SC (PwD)_AI', 'ST_AI', 'ST_GIRLS_AI', 'ST (PwD)_AI',
  'OPEN (PwD)_GIRLS_AI', 'EWS (PwD)_AI', 'OBC-NCL (PwD)_GIRLS_AI',
  'EWS (PwD)_GIRLS_AI', 'SC (PwD)_GIRLS_AI',
]);

function getJeeReservationCategoryCodes(examEnum, gender, baseCategory) {
  const isFemale = String(gender || '').toLowerCase() === 'female';
  const base = String(baseCategory || '').trim();
  if (!base) return [];

  if (examEnum === 'JEE_MAINS_2024') {
    const quotas = ['AI', 'GO', 'HS', 'JK', 'LA', 'OS'];
    const codes = [];
    for (const quota of quotas) {
      const code = isFemale ? `${base}_GIRLS_${quota}` : `${base}_${quota}`;
      if (JEE_MAINS_ADVANCE_RESERVATION_QUOTAS.has(code)) {
        codes.push(code);
      }
    }
    return codes.length > 0 ? codes : [base];
  }

  if (examEnum === 'JEE_ADVANCE_2024') {
    return [isFemale ? `${base}_GIRLS_AI` : `${base}_AI`];
  }

  return [base];
}

module.exports = {
  JEE_CATEGORY_OPTIONS,
  getJeeReservationCategoryCodes,
};
