const {
  getEnabledSlotIdsForISTDate,
  slotIdToStartOnISTCalendarDate,
  addISTCalendarDays
} = require('./slotAvailabilityForDate');

const MAX_SCAN_DAYS = 90;
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

/**
 * First `maxDays` IST calendar days starting at `scanStart`, each with ≥1 bookable slot
 * (admin-enabled + post–1h cutoff). Stops after `targetDayCount` such days.
 */
async function collectFirstNBookableDays(now, scanStart, targetDayCount, maxIterations) {
  let scanDate = scanStart;
  if (!scanDate) return [];

  const daysWithVisibleSlots = [];

  for (let i = 0; i < maxIterations && daysWithVisibleSlots.length < targetDayCount; i++) {
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

/**
 * Always returns slots from the first two IST calendar days (from scan anchor) that each
 * have at least one visible bookable slot, using the same enable rules as admin.
 *
 * Scan anchor: if yesterday and today have no admin-enabled slot ids, start at tomorrow;
 * otherwise start at today.
 */
async function getDemoSlots() {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const yesterdayStr = addISTCalendarDays(todayStr, -1);

  const [enabledYesterday, enabledToday] = await Promise.all([
    yesterdayStr ? getEnabledSlotIdsForISTDate(yesterdayStr) : Promise.resolve([]),
    getEnabledSlotIdsForISTDate(todayStr)
  ]);

  const yesterdayAndTodayEmpty =
    enabledYesterday.length === 0 && enabledToday.length === 0;

  const scanStart = yesterdayAndTodayEmpty
    ? addISTCalendarDays(todayStr, 1)
    : todayStr;

  if (!scanStart) {
    return { slots: [] };
  }

  const daysWithVisibleSlots = await collectFirstNBookableDays(
    now,
    scanStart,
    2,
    MAX_SCAN_DAYS
  );

  const collected = daysWithVisibleSlots.flatMap((d) => d.slots);
  collected.sort((a, b) => new Date(a.date) - new Date(b.date));
  return { slots: collected };
}

module.exports = { getDemoSlots };
