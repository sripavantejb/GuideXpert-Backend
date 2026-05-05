/**
 * Shared human-readable slot strings for SMS and WhatsApp (same shape as MSG91 vars).
 */

function formatSlotDateForSms(date) {
  const d = new Date(date);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dayName = days[d.getDay()];
  const day = d.getDate();
  const month = months[d.getMonth()];

  const suffix = (day === 1 || day === 21 || day === 31) ? 'st'
    : (day === 2 || day === 22) ? 'nd'
      : (day === 3 || day === 23) ? 'rd'
        : 'th';

  return `${dayName}, ${day}${suffix} ${month}`;
}

function formatSlotTimeForSms(slotId) {
  if (!slotId || typeof slotId !== 'string') return '';

  const timeMap = {
    '7PM': '7:00 PM',
    '11AM': '11:00 AM',
    '3PM': '3:00 PM',
    '6PM': '6:00 PM'
  };

  const parts = slotId.split('_');
  const timePart = parts[parts.length - 1];

  return timeMap[timePart] || timePart;
}

const DEFAULT_MEETING_LINK = 'https://guidexpert.co.in/demo';

function getDemoMeetingLink() {
  return process.env.DEMO_MEETING_LINK || DEFAULT_MEETING_LINK;
}

/**
 * Build {{ name, date, time }} (+ optional var / meeting link) from a FormSubmission-like doc.
 */
function buildSlotNotificationVariables(doc, options = {}) {
  const slotDate = doc.step3Data?.slotDate;
  const slotId = doc.step3Data?.selectedSlot || doc.selectedSlot;
  const vars = {
    name: doc.step1Data?.fullName || doc.fullName || 'Counsellor',
    date: formatSlotDateForSms(slotDate),
    time: formatSlotTimeForSms(slotId)
  };
  if (options.withMeetingLink) {
    vars.var = getDemoMeetingLink();
  }
  return vars;
}

module.exports = {
  formatSlotDateForSms,
  formatSlotTimeForSms,
  getDemoMeetingLink,
  buildSlotNotificationVariables
};
