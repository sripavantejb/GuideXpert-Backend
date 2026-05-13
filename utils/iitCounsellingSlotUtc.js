/**
 * IST-aligned instant for IIT counselling cohorts (parity with FormSubmission.step3Data.slotDate).
 * @param {string} slotBooking e.g. "Wednesday 6PM"
 * @param {string} ymd ISO date YYYY-MM-DD (validated against IST weekday upstream)
 * @returns {Date|null}
 */
function computeIitCounsellingSlotInstantUtc(slotBooking, ymd) {
  const label = typeof slotBooking === 'string' ? slotBooking.trim() : '';
  const day = typeof ymd === 'string' ? ymd.trim() : '';
  if (!label || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  /** @type {[number,number]|null} */
  let hm = null;
  if (label.endsWith('11AM')) hm = [11, 0];
  else if (label.endsWith('6PM')) hm = [18, 0];
  if (!hm) return null;
  const hh = String(hm[0]).padStart(2, '0');
  const mm = String(hm[1]).padStart(2, '0');
  return new Date(`${day}T${hh}:${mm}:00+05:30`);
}

module.exports = {
  computeIitCounsellingSlotInstantUtc
};
