const IST = 'Asia/Kolkata';

const THREE_HOUR_BLOCKS = [
  { startH: 9, timeLabel: '9:00 AM – 12:00 PM' },
  { startH: 12, timeLabel: '12:00 PM – 3:00 PM' },
  { startH: 15, timeLabel: '3:00 PM – 6:00 PM' },
  { startH: 18, timeLabel: '6:00 PM – 9:00 PM' },
];

const pad2 = (n) => String(n).padStart(2, '0');

function makeISTDate(year, month, day, hour, minute = 0) {
  return new Date(
    `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00+05:30`
  );
}

function getISTCalendarParts(utcDate) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = f.formatToParts(utcDate);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

function addCalendarDaysIST(parts, deltaDays) {
  const d = makeISTDate(parts.year, parts.month, parts.day, 12, 0);
  const next = new Date(d.getTime() + deltaDays * 86400000);
  return getISTCalendarParts(next);
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

function slotValue(dayParts, block) {
  return `${dayParts.year}-${pad2(dayParts.month)}-${pad2(dayParts.day)}_${block.startH}`;
}

function getOneOnOneCounselingSlots(currentDate = new Date()) {
  const now = new Date(currentDate);
  const today = getISTCalendarParts(now);
  const days = [addCalendarDaysIST(today, 1), addCalendarDaysIST(today, 2)];
  const slots = [];

  for (const dayParts of days) {
    for (const block of THREE_HOUR_BLOCKS) {
      const date = makeISTDate(dayParts.year, dayParts.month, dayParts.day, block.startH, 0);
      slots.push({
        value: slotValue(dayParts, block),
        label: formatSlotLabel(date, block.timeLabel),
        slotDate: formatDateISTYYYYMMDD(date),
      });
    }
  }

  return slots;
}

function isValidPreferredTimeSlot(value, now = new Date()) {
  const v = String(value ?? '').trim();
  if (!v) return false;
  return getOneOnOneCounselingSlots(now).some((s) => s.value === v);
}

function resolveSlotMeta(value, now = new Date()) {
  const v = String(value ?? '').trim();
  const match = getOneOnOneCounselingSlots(now).find((s) => s.value === v);
  if (!match) return null;
  return { label: match.label, slotDate: match.slotDate };
}

module.exports = {
  getOneOnOneCounselingSlots,
  isValidPreferredTimeSlot,
  resolveSlotMeta,
};
