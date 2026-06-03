/** Current studying values that count as relevant IIT counselling leads (12th passed out only). */
const RELEVANT_IIT_CLASS_STATUSES = ['Completed 12th/Intermediate 2nd Year'];

/** Legacy value still stored on some submissions. */
const LEGACY_RELEVANT_CLASS_STATUSES = ['12th Passed'];

const RELEVANT_CLASS_STATUS_QUERY_VALUES = [
  ...RELEVANT_IIT_CLASS_STATUSES,
  ...LEGACY_RELEVANT_CLASS_STATUSES,
];

const CLASS_STATUS_FIELD = 'iitCounselling.section1Data.classStatus';

function buildRelevantClassStatusClause() {
  return { [CLASS_STATUS_FIELD]: { $in: RELEVANT_CLASS_STATUS_QUERY_VALUES } };
}

function buildIrrelevantClassStatusClause() {
  return {
    $or: [
      { [CLASS_STATUS_FIELD]: { $exists: false } },
      { [CLASS_STATUS_FIELD]: null },
      { [CLASS_STATUS_FIELD]: '' },
      { [CLASS_STATUS_FIELD]: { $nin: RELEVANT_CLASS_STATUS_QUERY_VALUES } },
    ],
  };
}

/**
 * @param {'relevant' | 'irrelevant' | ''} leadRelevance
 * @returns {object|null} Mongo match fragment or null if no filter
 */
function buildLeadRelevanceMatchClause(leadRelevance) {
  if (leadRelevance === 'relevant') return buildRelevantClassStatusClause();
  if (leadRelevance === 'irrelevant') return buildIrrelevantClassStatusClause();
  return null;
}

module.exports = {
  RELEVANT_IIT_CLASS_STATUSES,
  RELEVANT_CLASS_STATUS_QUERY_VALUES,
  buildLeadRelevanceMatchClause,
};
