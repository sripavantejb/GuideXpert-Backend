const { getISTDayRangeFromString } = require('./dateHelpers');

/**
 * Resolve IST date range from preset or fromDate/toDate query params.
 * @returns {{ start: Date, end: Date } | null} end exclusive; null = all time
 */
function resolveStatsDateRange(query = {}) {
  const preset = String(query.preset || '').trim();
  const fromStr = String(query.fromDate || '').trim();
  const toStr = String(query.toDate || '').trim();
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const dayAgoStr = (days) => {
    const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  };

  if (preset === 'today') {
    return getISTDayRangeFromString(todayStr);
  }
  if (preset === 'yesterday') {
    return getISTDayRangeFromString(dayAgoStr(1));
  }
  if (preset === 'last7') {
    const end = getISTDayRangeFromString(todayStr);
    const start = getISTDayRangeFromString(dayAgoStr(6));
    if (!end || !start) return null;
    return { start: start.start, end: end.end };
  }
  if (preset === 'last30') {
    const end = getISTDayRangeFromString(todayStr);
    const start = getISTDayRangeFromString(dayAgoStr(29));
    if (!end || !start) return null;
    return { start: start.start, end: end.end };
  }

  if (fromStr && /^\d{4}-\d{2}-\d{2}$/.test(fromStr)) {
    const start = getISTDayRangeFromString(fromStr);
    const endDay = toStr && /^\d{4}-\d{2}-\d{2}$/.test(toStr) ? toStr : todayStr;
    const end = getISTDayRangeFromString(endDay);
    if (start && end) {
      return { start: start.start, end: end.end };
    }
  }

  return null;
}

function createdAtInRange(field = 'createdAt') {
  return (dateRange) => {
    if (!dateRange) return {};
    return { [field]: { $gte: dateRange.start, $lt: dateRange.end } };
  };
}

module.exports = { resolveStatsDateRange, createdAtInRange };
