const MHT_CET_ADMISSION_OPTIONS = [
  { id: 1, value: 'STATE_LEVEL', label: 'State Level', apiValue: 'SL' },
  { id: 2, value: 'HOME_UNIVERSITY', label: 'Home University', apiValue: 'HU' },
  { id: 3, value: 'OTHER_THAN_HOME_UNIVERSITY', label: 'Other than Home University', apiValue: 'OHU' },
];

const MHT_CET_STATE_LEVEL_CATEGORY_OPTIONS = [
  'DEFOBCS', 'DEFOPENS', 'DEFRNT1S', 'DEFRNT2S', 'DEFRNT3S', 'DEFROBCS',
  'DEFRSCS', 'DEFRSEBCS', 'DEFSCS', 'DEFSEBCS', 'EWS', 'GOBCS', 'GOPENS',
  'GSCS', 'GSEBCS', 'GSTS', 'GNT1S', 'GNT2S', 'GNT3S', 'GVJS', 'LOBCS',
  'LOPENS', 'LSCS', 'LSEBCS', 'LSTS', 'LNT1S', 'LNT2S', 'LNT3S', 'LVJS',
  'MI', 'ORPHAN', 'PWDOBCS', 'PWDOPENS', 'PWDROBCS', 'PWDRSCS', 'PWDRSTS',
  'PWDSCS', 'PWDSTS', 'PWDRNT2S', 'PWDRNT3S', 'TFWS',
].sort();

const MHT_CET_HOME_CATEGORY_OPTIONS = [
  'GNT1H', 'GNT2H', 'GNT3H', 'GOBCH', 'GOPENH', 'GSCH', 'GSEBCH', 'GSTH',
  'GVJH', 'LOBCH', 'LOPENH', 'LSCH', 'LSEBCH', 'LSTH', 'LNT1H', 'LVJH',
  'PWDOBCH', 'PWDOPENH',
].sort();

const MHT_CET_OTHER_CATEGORY_OPTIONS = [
  'GOBCO', 'GOPENO', 'GNT2O', 'GNT3O', 'GSCO', 'LOPENO', 'LSEBCO', 'LSTO',
  'LNT2O', 'LVJO', 'PWDOPENS', 'PWDOBCS', 'PWDROBCS',
].sort();

function toNumberedOptions(codes) {
  return codes.map((code, index) => ({ id: index + 1, value: code, label: code }));
}

function getMhtCategoryOptionsByAdmissionType(admissionType) {
  if (admissionType === 'HOME_UNIVERSITY') {
    return toNumberedOptions(MHT_CET_HOME_CATEGORY_OPTIONS);
  }
  if (admissionType === 'OTHER_THAN_HOME_UNIVERSITY') {
    return toNumberedOptions(MHT_CET_OTHER_CATEGORY_OPTIONS);
  }
  return toNumberedOptions(MHT_CET_STATE_LEVEL_CATEGORY_OPTIONS);
}

const OHU_RESERVATION_CODE_ALIASES = {
  PWDSEBCH: 'PWDROBCS',
  PWDROBCH: 'PWDROBCS',
  PWDSEBCO: 'PWDROBCS',
  PWDROBCO: 'PWDROBCS',
  PWDOBCO: 'PWDOBCS',
  PWDOPENO: 'PWDOPENS',
  PWDSEBCS: 'PWDROBCS',
};

const HU_FROM_STATE_LEVEL_ALIASES = {
  GOPENS: 'GOPENH',
  GOBCS: 'GOBCH',
  LOPENS: 'LOPENH',
  LOBCS: 'LOBCH',
  GSCS: 'GSCH',
  LSCS: 'LSCH',
  GSEBCS: 'GSEBCH',
  LSEBCS: 'LSEBCH',
  GSTS: 'GSTH',
  LSTS: 'LSTH',
  GNT1S: 'GNT1H',
  GNT2S: 'GNT2H',
  GNT3S: 'GNT3H',
  LNT1S: 'LNT1H',
  GVJS: 'GVJH',
  LVJS: 'LVJH',
  PWDOBCS: 'PWDOBCH',
  PWDOPENS: 'PWDOPENH',
};

function normalizeMhtReservationCodeForApi(admissionType, code) {
  const raw = String(code || '').trim();
  if (!raw) return raw;
  if (admissionType === 'OTHER_THAN_HOME_UNIVERSITY') {
    const mapped = OHU_RESERVATION_CODE_ALIASES[raw];
    if (mapped) return mapped;
  }
  if (admissionType === 'HOME_UNIVERSITY') {
    const mapped = HU_FROM_STATE_LEVEL_ALIASES[raw];
    if (mapped) return mapped;
  }
  if (raw === 'PWDSEBCS' || raw === 'PWDSEBCO' || raw === 'PWDSEBCH') {
    return 'PWDROBCS';
  }
  return raw;
}

function percentileToMhtCutoffRange(percentile) {
  const p = Number(percentile);
  if (!Number.isFinite(p) || p < 1 || p > 100) return [0, 0];
  const pad = 30;
  const from = Math.max(1, Math.floor(p - pad));
  const to = Math.min(100, Math.ceil(p + pad));
  if (from >= to) return [1, 100];
  return [from, to];
}

module.exports = {
  MHT_CET_ADMISSION_OPTIONS,
  getMhtCategoryOptionsByAdmissionType,
  normalizeMhtReservationCodeForApi,
  percentileToMhtCutoffRange,
};
