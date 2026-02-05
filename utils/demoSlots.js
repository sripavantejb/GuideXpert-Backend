const SlotConfig = require('../models/SlotConfig');
const SlotDateOverride = require('../models/SlotDateOverride');
const { getISTCalendarDateUTC } = require('./dateHelpers');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/**
 * Get current date/time components in IST (Asia/Kolkata).
 * Uses UTC + 5:30 so that UTC components of the shifted date equal IST components.
 */
function getCurrentISTTime() {
  const d = new Date();
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth(),
    date: ist.getUTCDate(),
    dayOfWeek: ist.getUTCDay(),
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes()
  };
}

/**
 * Get the next occurrence of a given weekday at given time in IST.
 * Reference is current IST time components.
 */
function getNextSlotDate(reference, dayOfWeek, hour, minute) {
  let daysToAdd = (dayOfWeek - reference.dayOfWeek + 7) % 7;
  const nowMins = reference.hours * 60 + reference.minutes;
  const slotMins = hour * 60 + minute;
  if (daysToAdd === 0 && nowMins >= slotMins) {
    daysToAdd = 7;
  }
  // Midnight IST on reference day, then add days and time
  const midnightIST = new Date(Date.UTC(reference.year, reference.month, reference.date) - IST_OFFSET_MS);
  const slotTime = midnightIST.getTime() + daysToAdd * 24 * 60 * 60 * 1000 + (hour * 60 + minute) * 60 * 1000;
  return new Date(slotTime);
}

function formatSlotLabel(date) {
  const datePart = date.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'short'
  });
  const timePart = date.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return `${datePart} — ${timePart}`;
}

function createSlot(dayName, timeKey, hour, minute, ref) {
  const dayIndex = DAY_NAMES.indexOf(dayName);
  if (dayIndex === -1) return null;
  const date = getNextSlotDate(ref, dayIndex, hour, minute);
  const id = `${dayName}_${timeKey}`;
  const label = formatSlotLabel(date);
  return { id, label, date: date.toISOString() };
}

async function getDemoSlots() {
  const ref = getCurrentISTTime();
  const slots = [];

  const add = (dayName, timeKey, hour, minute) => {
    const slot = createSlot(dayName, timeKey, hour, minute, ref);
    if (slot) slots.push(slot);
  };

  switch (ref.dayOfWeek) {
    case 5: { // Friday — cutoff 6:00 PM
      if (ref.hours < 18) {
        add('FRIDAY', '7PM', 19, 0);
        add('SATURDAY', '7PM', 19, 0);
      } else {
        add('SATURDAY', '7PM', 19, 0);
        add('SUNDAY', '11AM', 11, 0);
        add('SUNDAY', '7PM', 19, 0);
      }
      break;
    }
    case 6: { // Saturday — cutoff 6:00 PM
      if (ref.hours < 18) {
        add('SATURDAY', '7PM', 19, 0);
        add('SUNDAY', '11AM', 11, 0);
        add('SUNDAY', '7PM', 19, 0);
      } else {
        add('SUNDAY', '11AM', 11, 0);
        add('SUNDAY', '7PM', 19, 0);
        add('MONDAY', '7PM', 19, 0);
      }
      break;
    }
    case 0: { // Sunday — cutoff 10:00 AM
      if (ref.hours < 10) {
        add('SUNDAY', '11AM', 11, 0);
        add('SUNDAY', '7PM', 19, 0);
        add('MONDAY', '7PM', 19, 0);
      } else {
        add('SUNDAY', '7PM', 19, 0);
        add('MONDAY', '7PM', 19, 0);
      }
      break;
    }
    case 1: // Monday
    case 2: // Tuesday
    case 3: // Wednesday
    case 4: { // Thursday — cutoff 6:00 PM for all
      if (ref.hours < 18) {
        add(DAY_NAMES[ref.dayOfWeek], '7PM', 19, 0);
        add(DAY_NAMES[(ref.dayOfWeek + 1) % 7], '7PM', 19, 0);
      } else {
        add(DAY_NAMES[(ref.dayOfWeek + 1) % 7], '7PM', 19, 0);
        add(DAY_NAMES[(ref.dayOfWeek + 2) % 7], '7PM', 19, 0);
      }
      break;
    }
    default:
      break;
  }

  const configs = await SlotConfig.find({ slotId: { $in: slots.map((s) => s.id) } }).lean();
  const configMap = Object.fromEntries(configs.map((c) => [c.slotId, c.enabled]));
  const slotsWithEnabled = slots.map((s) => ({
    ...s,
    enabled: configMap[s.id] !== undefined ? configMap[s.id] : true
  }));

  const slotDates = slotsWithEnabled.map((s) => ({
    date: getISTCalendarDateUTC(new Date(s.date)),
    slotId: s.id
  }));
  const overridePairs = await SlotDateOverride.find({
    $or: slotDates.map(({ date, slotId }) => ({ date, slotId }))
  }).lean();
  const overrideMap = new Map(overridePairs.map((o) => [`${o.date.toISOString().slice(0, 10)}_${o.slotId}`, o.enabled]));

  const slotsWithOverrides = slotsWithEnabled.map((s) => {
    const calendarDate = getISTCalendarDateUTC(new Date(s.date));
    const key = `${calendarDate.toISOString().slice(0, 10)}_${s.id}`;
    const override = overrideMap.get(key);
    const enabled = override !== undefined ? override : s.enabled;
    return { ...s, enabled };
  });

  const slotsFiltered = slotsWithOverrides.filter((s) => s.enabled);
  return { slots: slotsFiltered };
}

module.exports = { getDemoSlots };
