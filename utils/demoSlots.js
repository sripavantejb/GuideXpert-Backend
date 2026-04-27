const {
  getEnabledSlotIdsForISTDate,
  slotIdToStartOnISTCalendarDate,
  addISTCalendarDays
} = require('./slotAvailabilityForDate');

const MAX_FALLBACK_SCAN_DAYS = 90;
const ONE_HOUR_MS = 60 * 60 * 1000;

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

/**
 * Slot is visible only until one hour before its start time.
 * Example: 3:00 PM slot is hidden from 2:00 PM onward.
 */
function isVisibleBeforeOneHourCutoff(slotDateISO, now = new Date()) {
  const slotStart = new Date(slotDateISO);
  if (Number.isNaN(slotStart.getTime())) return false;
  return now.getTime() < (slotStart.getTime() - ONE_HOUR_MS);
}

async function collectTwoAvailableDaysFrom(scanStart, now) {
  let scanDate = scanStart;
  if (!scanDate) return [];

  const daysWithVisibleSlots = [];
  for (let i = 0; i < MAX_FALLBACK_SCAN_DAYS && daysWithVisibleSlots.length < 2; i += 1) {
    const ids = await getEnabledSlotIdsForISTDate(scanDate);
    const daySlots = [];
    for (const slotId of ids) {
      const startDate = slotIdToStartOnISTCalendarDate(slotId, scanDate);
      if (!startDate || Number.isNaN(startDate.getTime())) continue;
      const dateIso = startDate.toISOString();
      if (!isVisibleBeforeOneHourCutoff(dateIso, now)) continue;
      daySlots.push({
        id: slotId,
        label: formatSlotLabel(startDate),
        date: dateIso,
        enabled: true,
        selectionId: `${slotId}_${scanDate}`
      });
    }
    if (daySlots.length > 0) {
      daysWithVisibleSlots.push({ dateStr: scanDate, slots: daySlots });
    }
    const next = addISTCalendarDays(scanDate, 1);
    if (!next) break;
    scanDate = next;
  }
  return daysWithVisibleSlots;
}

async function getDemoSlots() {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const yesterdayStr = addISTCalendarDays(todayStr, -1);
  const [enabledToday, enabledYesterday] = await Promise.all([
    getEnabledSlotIdsForISTDate(todayStr),
    yesterdayStr ? getEnabledSlotIdsForISTDate(yesterdayStr) : Promise.resolve([])
  ]);

  const shouldStartTomorrow = enabledToday.length === 0 && enabledYesterday.length === 0;
  const scanStart = shouldStartTomorrow ? addISTCalendarDays(todayStr, 1) : todayStr;
  const daysWithVisibleSlots = await collectTwoAvailableDaysFrom(scanStart, now);

  const collected = daysWithVisibleSlots.flatMap((d) => d.slots);
  collected.sort((a, b) => new Date(a.date) - new Date(b.date));
  return { slots: collected };
}

module.exports = { getDemoSlots };
