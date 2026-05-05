/**
 * Ordered semantic keys for Gupshup template body variables {{1}}, {{2}}, …
 * Must match each approved template in the Gupshup dashboard.
 *
 * Keys map into objects built like SMS vars:
 *   name, date, time — slotNotificationFormatters
 *   var — DEMO_MEETING_LINK (same as MSG91 ##var## for meet / 30-min)
 */

const SLOT_BOOKED_PARAM_KEYS = ['Name', 'slot date and time'];
const PRE4HR_PARAM_KEYS = ['name', 'date', 'time'];
const MEET_PARAM_KEYS = ['name', 'date', 'time', 'var'];
const REMINDER_30MIN_PARAM_KEYS = ['name', 'date', 'time', 'var'];

function buildParamsFromKeys(obj, orderedKeys) {
  return orderedKeys.map((k) => String(obj[k] ?? ''));
}

module.exports = {
  SLOT_BOOKED_PARAM_KEYS,
  PRE4HR_PARAM_KEYS,
  MEET_PARAM_KEYS,
  REMINDER_30MIN_PARAM_KEYS,
  buildParamsFromKeys
};
