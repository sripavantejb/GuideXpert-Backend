const { IIT_BOOKING_LABEL_TO_SLOT_ID } = require('../constants/iitSlotIds');

const IST = 'Asia/Kolkata';

const IIT_SLOT_SPECS = [
  { value: 'Wednesday 6PM', weekday: 3, hour: 18, minute: 0, timeLabel: '6:00 PM', day: 'Wednesday' },
  { value: 'Saturday 6PM', weekday: 6, hour: 18, minute: 0, timeLabel: '6:00 PM', day: 'Saturday' },
  { value: 'Sunday 11AM', weekday: 0, hour: 11, minute: 0, timeLabel: '11:00 AM', day: 'Sunday' },
];

const pad2 = (n) => String(n).padStart(2, '0');

function makeISTDate(year, month, day, hour, minute = 0) {
  return new Date(`${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00+05:30`);
}

function getISTCalendarParts(utcDate) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = f.formatToParts(utcDate);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: wdMap[map.weekday] ?? 0,
  };
}

function addCalendarDaysIST(parts, deltaDays) {
  const d = makeISTDate(parts.year, parts.month, parts.day, 12, 0);
  const next = new Date(d.getTime() + deltaDays * 86400000);
  return getISTCalendarParts(next);
}

function nextISTWallClockAfterOrEqual(anchorDate, targetWeekday, hour, minute) {
  const p = getISTCalendarParts(anchorDate);
  let addDays = (targetWeekday - p.weekday + 7) % 7;
  let t = addCalendarDaysIST({ year: p.year, month: p.month, day: p.day }, addDays);
  let cand = makeISTDate(t.year, t.month, t.day, hour, minute);
  if (cand.getTime() <= anchorDate.getTime()) {
    t = addCalendarDaysIST(t, 7);
    cand = makeISTDate(t.year, t.month, t.day, hour, minute);
  }
  return cand;
}

function formatDateISTYYYYMMDD(date) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatSlotLabel(date, timeLabel) {
  const dateLabel = new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
  return `${dateLabel} • ${timeLabel}`;
}

function isDateOverrideDisabled(date, slotValue, dateOverrides) {
  if (!Array.isArray(dateOverrides) || dateOverrides.length === 0) return false;
  const dateStr = formatDateISTYYYYMMDD(date);
  const slotId = IIT_BOOKING_LABEL_TO_SLOT_ID[slotValue];
  if (!dateStr || !slotId) return false;
  const match = dateOverrides.find((o) => o.date === dateStr && o.slotId === slotId);
  return match ? !match.enabled : false;
}

function buildSlotOption(spec, date) {
  const slotBookingDate = formatDateISTYYYYMMDD(date);
  return {
    value: `${spec.value}|${slotBookingDate}`,
    slotBooking: spec.value,
    label: formatSlotLabel(date, spec.timeLabel),
    slotBookingDate,
    day: spec.day,
  };
}

function nextEnabledSlotOccurrence(now, spec, dateOverrides) {
  let anchor = now;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const date = nextISTWallClockAfterOrEqual(anchor, spec.weekday, spec.hour, spec.minute);
    if (!isDateOverrideDisabled(date, spec.value, dateOverrides)) {
      return buildSlotOption(spec, date);
    }
    anchor = new Date(date.getTime() + 60_000);
  }
  return null;
}

function nextOccurrencesForSpec(now, spec, dateOverrides, count) {
  const results = [];
  let anchor = now;
  while (results.length < count) {
    const opt = nextEnabledSlotOccurrence(anchor, spec, dateOverrides);
    if (!opt) break;
    if (!results.some((r) => r.slotBookingDate === opt.slotBookingDate)) {
      results.push(opt);
    }
    anchor = makeISTDate(
      Number(opt.slotBookingDate.slice(0, 4)),
      Number(opt.slotBookingDate.slice(5, 7)),
      Number(opt.slotBookingDate.slice(8, 10)),
      spec.hour,
      spec.minute
    );
    anchor = new Date(anchor.getTime() + 60_000);
  }
  return results;
}

/**
 * Bookable IIT counselling demo slots for the public form.
 * When only one weekly slot is enabled (e.g. Saturday), returns the next two occurrences.
 */
function buildIitCounsellingSlotOptions(now, enabledBookingValues, dateOverrides = []) {
  const enabledSet = new Set(
    (enabledBookingValues || []).map((v) => String(v || '').trim()).filter(Boolean)
  );
  const enabledSpecs = IIT_SLOT_SPECS.filter((spec) => enabledSet.has(spec.value));
  if (enabledSpecs.length === 0) return [];

  if (enabledSpecs.length === 1) {
    return nextOccurrencesForSpec(now, enabledSpecs[0], dateOverrides, 2);
  }

  return enabledSpecs
    .map((spec) => nextEnabledSlotOccurrence(now, spec, dateOverrides))
    .filter(Boolean)
    .sort((a, b) => a.slotBookingDate.localeCompare(b.slotBookingDate))
    .slice(0, 2);
}

module.exports = {
  buildIitCounsellingSlotOptions,
};
