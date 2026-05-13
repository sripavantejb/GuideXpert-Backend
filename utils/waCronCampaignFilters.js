/**
 * Mongo $expr helpers for campaign reminder crons: enforce now >= slotDate - offsetMs
 * so no SMS/WA runs before the true T−offset boundary (independent of window math).
 */

/**
 * @param {number} offsetMs
 * @param {Date} [nowDate] evaluated once when building the query
 * @returns {object|null} $expr body fragment or null if offset invalid
 */
function campaignSlotDateNotBeforeSendBoundaryExpr(offsetMs, nowDate = new Date()) {
  if (!Number.isFinite(offsetMs) || offsetMs <= 0) return null;
  return {
    $lte: [{ $subtract: ['$step3Data.slotDate', offsetMs] }, nowDate]
  };
}

/**
 * @param {object} baseFilter
 * @param {object|null} exprFragment
 */
function mergeExprIntoFilter(baseFilter, exprFragment) {
  if (!exprFragment) return baseFilter;
  const existing = baseFilter.$expr;
  if (existing) {
    return { ...baseFilter, $expr: { $and: [existing, exprFragment] } };
  }
  return { ...baseFilter, $expr: exprFragment };
}

module.exports = {
  campaignSlotDateNotBeforeSendBoundaryExpr,
  mergeExprIntoFilter
};
