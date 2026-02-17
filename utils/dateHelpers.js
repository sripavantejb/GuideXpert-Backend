const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // IST = UTC+5:30

/**
 * Get the start of the IST calendar day for a given moment, as a UTC Date (for consistent DB queries).
 * e.g. For "2026-02-05" in IST, returns the UTC moment 2026-02-04T18:30:00.000Z (00:00 IST).
 * @param {Date} date - Any Date (e.g. slot datetime)
 * @returns {Date} - Start of that IST calendar day in UTC
 */
function getISTCalendarDateUTC(date) {
  const d = new Date(date);
  const yyyyMmDd = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [y, m, day] = yyyyMmDd.split('-').map(Number);
  const utcMidnightThatDay = Date.UTC(y, m - 1, day, 0, 0, 0, 0);
  return new Date(utcMidnightThatDay - IST_OFFSET_MS);
}

/**
 * Build UTC start/end for one IST calendar day from a YYYY-MM-DD string.
 * Use this for query params to avoid Date parse ambiguity.
 * @param {string} yyyyMmDd - e.g. "2026-02-05"
 * @returns {{ start: Date, end: Date } | null} - start inclusive, end exclusive; null if invalid
 */
function getISTDayRangeFromString(yyyyMmDd) {
  if (!yyyyMmDd || typeof yyyyMmDd !== 'string') return null;
  const trimmed = yyyyMmDd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, day] = trimmed.split('-').map(Number);
  if (m < 1 || m > 12 || day < 1 || day > 31) return null;
  const utcMidnightThatDay = Date.UTC(y, m - 1, day, 0, 0, 0, 0);
  const start = new Date(utcMidnightThatDay - IST_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

module.exports = { getISTCalendarDateUTC, getISTDayRangeFromString };
