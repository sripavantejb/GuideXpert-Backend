/**
 * Guidance booking confirmation (/guidance-booking-confirmation) — Gupshup template (date + time body).
 */

const GUPSHUP_TEMPLATE_GUIDANCE_BOOKING_CONFIRM = 'GUPSHUP_TEMPLATE_GUIDANCE_BOOKING_CONFIRM';

const GUIDANCE_BOOKING_CONFIRM_PARAM_KEYS = ['date', 'time'];

const IST_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * @param {string} slotDate YYYY-MM-DD
 * @returns {string}
 */
function formatGuidanceBookingDate(slotDate) {
  const iso = String(slotDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '—';
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const monthIdx = m - 1;
  if (!Number.isFinite(d) || monthIdx < 0 || monthIdx > 11) return iso;
  return `${d} ${IST_MONTHS[monthIdx]} ${y}`;
}

/**
 * @param {{ slotDate?: string, slotTime?: string }} slot
 */
function buildGuidanceBookingSubmitVars(slot) {
  return {
    date: formatGuidanceBookingDate(slot?.slotDate),
    time: String(slot?.slotTime || '').trim() || '—',
  };
}

/**
 * Cohort instant for ops analytics (slot day IST, hour from leading time digits if present).
 * @param {{ slotDate?: string, slotTime?: string }} slot
 */
function parseGuidanceSlotInstantUtc(slot) {
  const dateIso = String(slot?.slotDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const timeStr = String(slot?.slotTime || '');
  const ampmMatch = timeStr.match(/(\d{1,2})\s*(?::\d{2})?\s*(AM|PM|am|pm)/);
  let hour = 12;
  if (ampmMatch) {
    hour = parseInt(ampmMatch[1], 10);
    const isPm = ampmMatch[2].toUpperCase() === 'PM';
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  } else {
    const hourMatch = timeStr.match(/(\d{1,2})\s*(?::|\s|$)/) || timeStr.match(/^(\d{1,2})/);
    if (hourMatch) hour = parseInt(hourMatch[1], 10);
  }
  hour = Math.min(23, Math.max(0, hour));
  const d = new Date(`${dateIso}T${String(hour).padStart(2, '0')}:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = {
  GUPSHUP_TEMPLATE_GUIDANCE_BOOKING_CONFIRM,
  GUIDANCE_BOOKING_CONFIRM_PARAM_KEYS,
  formatGuidanceBookingDate,
  buildGuidanceBookingSubmitVars,
  parseGuidanceSlotInstantUtc,
};
