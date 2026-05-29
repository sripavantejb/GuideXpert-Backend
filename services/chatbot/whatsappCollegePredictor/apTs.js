const EXAM_AP = 'AP_EAMCET';
const EXAM_TS = 'TS_EAMCET';

const AP_TS_CATEGORY_OPTIONS = [
  {
    id: 1,
    label: 'OC',
    byExamGender: {
      AP_EAMCET: { female: 'OC GIRLS', male: null },
      TS_EAMCET: { female: 'OC GIRLS', male: 'OC BOYS' },
    },
  },
  {
    id: 2,
    label: 'BC-A',
    byExamGender: {
      AP_EAMCET: { female: 'BCA GIRLS', male: 'BCA BOYS' },
      TS_EAMCET: { female: 'BCA GIRLS', male: 'BCA BOYS' },
    },
  },
  {
    id: 3,
    label: 'BC-B',
    byExamGender: {
      AP_EAMCET: { female: 'BCB GIRLS', male: 'BCB BOYS' },
      TS_EAMCET: { female: 'BCB GIRLS', male: 'BCB BOYS' },
    },
  },
  {
    id: 4,
    label: 'BC-C',
    byExamGender: {
      AP_EAMCET: { female: 'BCC GIRLS', male: 'BCC BOYS' },
      TS_EAMCET: { female: 'BCC GIRLS', male: 'BCC BOYS' },
    },
  },
  {
    id: 5,
    label: 'BC-D',
    byExamGender: {
      AP_EAMCET: { female: 'BCD GIRLS', male: 'BCD BOYS' },
      TS_EAMCET: { female: 'BCD GIRLS', male: 'BCD BOYS' },
    },
  },
  {
    id: 6,
    label: 'BC-E',
    byExamGender: {
      AP_EAMCET: { female: 'BCE GIRLS', male: 'BCE BOYS' },
      TS_EAMCET: { female: 'BCE GIRLS', male: 'BCE BOYS' },
    },
  },
  {
    id: 7,
    label: 'SC',
    byExamGender: {
      AP_EAMCET: { female: 'SC GIRLS', male: 'SC BOYS' },
      TS_EAMCET: { female: 'SC GIRLS', male: 'SC BOYS' },
    },
  },
  {
    id: 8,
    label: 'ST',
    byExamGender: {
      AP_EAMCET: { female: 'ST GIRLS', male: 'ST BOYS' },
      TS_EAMCET: { female: 'ST GIRLS', male: 'ST BOYS' },
    },
  },
  {
    id: 9,
    label: 'EWS',
    byExamGender: {
      AP_EAMCET: { female: 'OC EWS GIRLS', male: 'OC EWS BOYS' },
      TS_EAMCET: { female: 'EWS GEN OU', male: 'OC EWS BOYS' },
    },
  },
];

const AP_REGION_OPTIONS = [
  { id: 1, value: 'AU', label: 'AU (Andhra University)' },
  { id: 2, value: 'SVU', label: 'SVU (Sri Venkateswara University)' },
];

function isApOcMaleBlocked(categoryId, gender) {
  return Number(categoryId) === 1 && gender === 'male';
}

function resolveApTsReservationCode(exam, categoryId, gender) {
  const option = AP_TS_CATEGORY_OPTIONS.find((it) => it.id === Number(categoryId));
  if (!option) return null;
  if (exam === EXAM_AP && isApOcMaleBlocked(categoryId, gender)) return null;
  const byExam = option.byExamGender?.[exam];
  if (!byExam) return null;
  return byExam[gender] || null;
}

module.exports = {
  EXAM_AP,
  EXAM_TS,
  AP_TS_CATEGORY_OPTIONS,
  AP_REGION_OPTIONS,
  isApOcMaleBlocked,
  resolveApTsReservationCode,
};
