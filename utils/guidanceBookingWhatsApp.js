/**
 * Guidance booking confirmation (/guidance-booking-confirmation) — Gupshup template (date + time body).
 */

const GUPSHUP_TEMPLATE_GUIDANCE_BOOKING_CONFIRM = 'GUPSHUP_TEMPLATE_GUIDANCE_BOOKING_CONFIRM';
const GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER = 'GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER';
const GUPSHUP_TEMPLATE_GUIDANCE_COUNSELLOR_BOOKING_NOTIFY =
  'GUPSHUP_TEMPLATE_GUIDANCE_COUNSELLOR_BOOKING_NOTIFY';

const GUIDANCE_BOOKING_CONFIRM_PARAM_KEYS = ['date', 'time'];
const GUIDANCE_PRE30MIN_REMINDER_PARAM_KEYS = ['name', 'slottime'];
// Order matches Gupshup template: {{1}} counsellor greeting, {{2}} date, {{3}} time, {{4}} student
const GUIDANCE_COUNSELLOR_BOOKING_NOTIFY_PARAM_KEYS = ['counsellor', 'date', 'time', 'name'];
const GUIDANCE_REMINDER_MESSAGE_KIND = 'guidance_pre30min';

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

/**
 * @param {{ studentName?: string }} lead
 * @param {{ slotTime?: string }} slot
 */
function buildGuidancePre30MinReminderVars(lead, slot) {
  const name = String(lead?.studentName || '').trim() || 'Student';
  const slottime = String(slot?.slotTime || '').trim() || '—';
  return { name, slottime };
}

/**
 * @param {{ studentName?: string }} lead
 * @param {{ slotDate?: string, slotTime?: string }} slot
 * @param {{ name?: string }} counselor
 */
function buildGuidanceCounsellorBookingNotifyVars(lead, slot, counselor) {
  return {
    name: String(lead?.studentName || '').trim() || 'Student',
    date: formatGuidanceBookingDate(slot?.slotDate),
    time: String(slot?.slotTime || '').trim() || '—',
    counsellor: String(counselor?.name || '').trim() || 'Counsellor',
  };
}

function isGuidanceReminderMessageKind(kind) {
  return kind === GUIDANCE_REMINDER_MESSAGE_KIND;
}

module.exports = {
  GUPSHUP_TEMPLATE_GUIDANCE_BOOKING_CONFIRM,
  GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER,
  GUPSHUP_TEMPLATE_GUIDANCE_COUNSELLOR_BOOKING_NOTIFY,
  GUIDANCE_BOOKING_CONFIRM_PARAM_KEYS,
  GUIDANCE_PRE30MIN_REMINDER_PARAM_KEYS,
  GUIDANCE_COUNSELLOR_BOOKING_NOTIFY_PARAM_KEYS,
  GUIDANCE_REMINDER_MESSAGE_KIND,
  formatGuidanceBookingDate,
  buildGuidanceBookingSubmitVars,
  buildGuidancePre30MinReminderVars,
  buildGuidanceCounsellorBookingNotifyVars,
  parseGuidanceSlotInstantUtc,
  isGuidanceReminderMessageKind,
};
