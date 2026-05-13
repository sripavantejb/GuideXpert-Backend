/**
 * Ordered semantic keys for Gupshup template body variables {{1}}, {{2}}, …
 * Must match each approved template in the Gupshup dashboard.
 *
 * Keys map into objects built like SMS vars:
 *   name, date, time — slotNotificationFormatters
 *   var — DEMO_MEETING_LINK (same as MSG91 ##var## for meet / 30-min)
 */

// Slot-booked template currently expects 2 params in order:
// {{1}} -> Name, {{2}} -> combined slot date+time
const SLOT_BOOKED_PARAM_KEYS = ['Name', 'slot date and time'];
// IIT counselling slot-booked templates (Wed/Sat/Sun): single body var {{1}} = name
const SLOT_BOOKED_IIT_PARAM_KEYS = ['name'];
const PRE4HR_PARAM_KEYS = ['name', 'date', 'time'];
const MEET_PARAM_KEYS = ['name', 'date', 'time', 'var'];
const REMINDER_30MIN_PARAM_KEYS = ['name', 'date', 'time', 'var'];

const KEY_ALIASES = {
  Name: ['name', 'Name'],
  name: ['name', 'Name'],
  date: ['date'],
  time: ['time'],
  var: ['var'],
  // Legacy templates that used a combined date+time placeholder.
  'slot date and time': ['slot date and time', 'slotDateTime', 'slot_date_time']
};

function resolveParamValue(obj, key) {
  const aliases = KEY_ALIASES[key] || [key];
  for (const alias of aliases) {
    if (obj[alias] != null && obj[alias] !== '') {
      return String(obj[alias]);
    }
  }
  if (key === 'slot date and time') {
    const date = obj.date != null ? String(obj.date) : '';
    const time = obj.time != null ? String(obj.time) : '';
    return [date, time].filter(Boolean).join(' at ');
  }
  return '';
}

function buildParamsFromKeys(obj, orderedKeys) {
  return orderedKeys.map((k) => resolveParamValue(obj || {}, k));
}

module.exports = {
  SLOT_BOOKED_PARAM_KEYS,
  SLOT_BOOKED_IIT_PARAM_KEYS,
  PRE4HR_PARAM_KEYS,
  MEET_PARAM_KEYS,
  REMINDER_30MIN_PARAM_KEYS,
  buildParamsFromKeys
};
