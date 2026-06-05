/** Relevant 1-on-1 leads: Inter 1st Year, Inter 2nd Year, and Inter 2nd Year Completed. */
const RELEVANT_CURRENT_CLASSES = [
  'Inter 1st Year',
  'Inter 2nd Year',
  'Inter 2nd Year Completed',
];

const CURRENT_CLASS_FIELD = 'currentClass';

function buildRelevantCurrentClassClause() {
  return { [CURRENT_CLASS_FIELD]: { $in: RELEVANT_CURRENT_CLASSES } };
}

function buildIrrelevantCurrentClassClause() {
  return {
    $or: [
      { [CURRENT_CLASS_FIELD]: { $exists: false } },
      { [CURRENT_CLASS_FIELD]: null },
      { [CURRENT_CLASS_FIELD]: '' },
      { [CURRENT_CLASS_FIELD]: { $nin: RELEVANT_CURRENT_CLASSES } },
    ],
  };
}

/**
 * @param {'relevant' | 'irrelevant' | ''} leadRelevance
 * @returns {object|null} Mongo match fragment or null if no filter
 */
function buildLeadRelevanceMatchClause(leadRelevance) {
  if (leadRelevance === 'relevant') return buildRelevantCurrentClassClause();
  if (leadRelevance === 'irrelevant') return buildIrrelevantCurrentClassClause();
  return null;
}

module.exports = {
  RELEVANT_CURRENT_CLASSES,
  buildLeadRelevanceMatchClause,
};
