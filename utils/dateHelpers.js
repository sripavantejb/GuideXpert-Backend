/**
 * Get the calendar date in IST for a given moment, as UTC midnight (for consistent DB queries).
 * @param {Date} date - Any Date (e.g. slot datetime)
 * @returns {Date} - UTC midnight representing that IST calendar day (YYYY-MM-DD)
 */
function getISTCalendarDateUTC(date) {
  const d = new Date(date);
  const yyyyMmDd = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return new Date(yyyyMmDd + 'T00:00:00.000Z');
}

module.exports = { getISTCalendarDateUTC };
