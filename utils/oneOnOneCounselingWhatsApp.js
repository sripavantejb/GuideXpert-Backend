/**
 * 1-on-1 counseling form submit — Gupshup template (name body + IMAGE header).
 */

const GUPSHUP_TEMPLATE_ONE_ON_ONE_CONFIRM = 'GUPSHUP_TEMPLATE_ONE_ON_ONE_CONFIRM';
const GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL = 'GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL';

const ONE_ON_ONE_HEADER_MISSING_ERROR = `1-on-1 submit header image URL missing (set ${GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL})`;

function resolveOneOnOneHeaderImageUrl() {
  const url = process.env[GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL];
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

/**
 * @param {{ studentName?: string }} lead
 */
function buildOneOnOneSubmitVars(lead) {
  const name = String(lead?.studentName || '').trim() || 'Student';
  return { name, Name: name };
}

/**
 * Cohort instant for ops analytics (start of preferred slot day IST, noon UTC anchor).
 * @param {{ preferredTimeSlotDate?: string, preferredTimeSlot?: string }} lead
 */
function parsePreferredSlotInstantUtc(lead) {
  const dateIso = String(lead?.preferredTimeSlotDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const slotKey = String(lead?.preferredTimeSlot || '');
  const hourMatch = slotKey.match(/_(\d{1,2})$/);
  const hour = hourMatch ? Math.min(23, parseInt(hourMatch[1], 10)) : 12;
  const d = new Date(`${dateIso}T${String(hour).padStart(2, '0')}:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = {
  GUPSHUP_TEMPLATE_ONE_ON_ONE_CONFIRM,
  GUPSHUP_ONE_ON_ONE_HEADER_IMAGE_URL,
  ONE_ON_ONE_HEADER_MISSING_ERROR,
  resolveOneOnOneHeaderImageUrl,
  buildOneOnOneSubmitVars,
  parsePreferredSlotInstantUtc,
};
