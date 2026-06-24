'use strict';

const { LIFECYCLE_STAGES, PRODUCT_LINES } = require('../../constants/leadLifecycle');
const { resolveStatsDateRange } = require('../../utils/statsDateRange');

function parseProductLine(value) {
  const raw = String(value || 'all').trim();
  if (raw === 'all') return null;
  if (PRODUCT_LINES.includes(raw)) return raw;
  return { error: `Invalid productLine. Expected all or one of: ${PRODUCT_LINES.join(', ')}` };
}

function buildDateRangeFromQuery(query = {}) {
  const fromStr = String(query.from || query.fromDate || '').trim();
  const toStr = String(query.to || query.toDate || '').trim();
  if (fromStr || toStr) {
    const fromDate = fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : null;
    const toDate = toStr ? new Date(`${toStr}T23:59:59.999Z`) : null;
    const range = {};
    if (fromDate && !Number.isNaN(fromDate.getTime())) range.$gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) range.$lte = toDate;
    return Object.keys(range).length ? range : null;
  }
  const istRange = resolveStatsDateRange(query);
  if (!istRange) return null;
  return { $gte: istRange.start, $lt: istRange.end };
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function medianMs(values) {
  const nums = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 0) {
    return Math.round((nums[mid - 1] + nums[mid]) / 2);
  }
  return Math.round(nums[mid]);
}

module.exports = {
  parseProductLine,
  buildDateRangeFromQuery,
  pct,
  medianMs,
  LIFECYCLE_STAGES,
};
