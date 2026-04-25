const SlotConfig = require('../models/SlotConfig');
const SlotDateOverride = require('../models/SlotDateOverride');
const { getISTDayRangeFromString } = require('./dateHelpers');
const { ALL_SLOT_IDS, DAY_NAMES } = require('../constants/slotIds');

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const TIME_SUFFIX_TO_MINUTES = {
  '6PM': 18 * 60,
  '7PM': 19 * 60,
  '11AM': 11 * 60,
  '3PM': 15 * 60
};

/**
 * Slot ids enabled for this IST calendar day (config + date override), same rules as admin getSlotsForDate.
 * @param {string} yyyyMmDd
 * @returns {Promise<string[]>}
 */
async function getEnabledSlotIdsForISTDate(yyyyMmDd) {
  const trimmed = typeof yyyyMmDd === 'string' ? yyyyMmDd.trim() : '';
  const istDayRange = getISTDayRangeFromString(trimmed);
  if (!istDayRange) return [];
  const { start } = istDayRange;
  const istDayOfWeek = new Date(start.getTime() + IST_OFFSET_MS).getUTCDay();

  const candidateSlotIds = ALL_SLOT_IDS.filter((slotId) => {
    const dayName = slotId.split('_')[0];
    return DAY_NAMES.indexOf(dayName) === istDayOfWeek;
  });

  const [configs, overrides] = await Promise.all([
    SlotConfig.find({ slotId: { $in: candidateSlotIds } }).lean(),
    SlotDateOverride.find({ date: start, slotId: { $in: candidateSlotIds } }).lean()
  ]);

  const configMap = Object.fromEntries(configs.map((c) => [c.slotId, c.enabled]));
  const overrideMap = Object.fromEntries(overrides.map((o) => [o.slotId, o.enabled]));

  return candidateSlotIds.filter((slotId) => {
    const override = overrideMap[slotId];
    const config = configMap[slotId];
    const enabled = override !== undefined ? override : (config !== undefined ? config : true);
    return enabled;
  });
}

/**
 * Absolute start Date for slotId on the given IST calendar date (YYYY-MM-DD).
 * @param {string} slotId
 * @param {string} yyyyMmDd
 * @returns {Date | null}
 */
function slotIdToStartOnISTCalendarDate(slotId, yyyyMmDd) {
  if (!slotId || typeof slotId !== 'string') return null;
  const trimmed = typeof yyyyMmDd === 'string' ? yyyyMmDd.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  const underscore = slotId.indexOf('_');
  if (underscore === -1) return null;
  const dayName = slotId.slice(0, underscore);
  const suffix = slotId.slice(underscore + 1);
  const totalMinutes = TIME_SUFFIX_TO_MINUTES[suffix];
  if (totalMinutes === undefined) return null;

  const range = getISTDayRangeFromString(trimmed);
  if (!range) return null;
  const { start } = range;
  const istDow = new Date(start.getTime() + IST_OFFSET_MS).getUTCDay();
  if (DAY_NAMES.indexOf(dayName) !== istDow) return null;

  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return new Date(start.getTime() + hour * 60 * 60 * 1000 + minute * 60 * 1000);
}

/**
 * @param {string} yyyyMmDd
 * @param {number} deltaDays
 * @returns {string | null} YYYY-MM-DD in IST
 */
function addISTCalendarDays(yyyyMmDd, deltaDays) {
  const range = getISTDayRangeFromString(String(yyyyMmDd).trim());
  if (!range) return null;
  const nextStart = new Date(range.start.getTime() + deltaDays * 24 * 60 * 60 * 1000);
  return nextStart.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

module.exports = {
  getEnabledSlotIdsForISTDate,
  slotIdToStartOnISTCalendarDate,
  addISTCalendarDays
};
