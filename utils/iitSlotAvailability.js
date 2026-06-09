const IitSlotConfig = require('../models/IitSlotConfig');
const IitSlotDateOverride = require('../models/IitSlotDateOverride');
const { getISTDayRangeFromString } = require('./dateHelpers');
const {
  ALL_IIT_SLOT_IDS,
  IIT_SLOT_ID_TO_BOOKING_LABEL,
  IIT_BOOKING_LABEL_TO_SLOT_ID,
} = require('../constants/iitSlotIds');

async function ensureIitSlotConfigs() {
  const configs = await IitSlotConfig.find({ slotId: { $in: ALL_IIT_SLOT_IDS } }).lean();
  const configMap = Object.fromEntries(configs.map((c) => [c.slotId, c.enabled]));

  for (const slotId of ALL_IIT_SLOT_IDS) {
    if (configMap[slotId] === undefined) {
      await IitSlotConfig.findOneAndUpdate(
        { slotId },
        { $set: { enabled: true, updatedAt: new Date() } },
        { upsert: true }
      );
      configMap[slotId] = true;
    }
  }

  return configMap;
}

/**
 * Resolve enabled state for an IIT slot on an IST calendar day (weekly config + date override).
 * @param {string} slotId
 * @param {string} [dateYmd] YYYY-MM-DD in IST
 * @returns {Promise<boolean>}
 */
async function isIitSlotIdEnabledForDate(slotId, dateYmd) {
  const configMap = await ensureIitSlotConfigs();
  const weeklyEnabled = configMap[slotId] !== false;
  const trimmed = typeof dateYmd === 'string' ? dateYmd.trim() : '';
  if (!trimmed) return weeklyEnabled;

  const range = getISTDayRangeFromString(trimmed);
  if (!range) return weeklyEnabled;

  const override = await IitSlotDateOverride.findOne({ date: range.start, slotId }).lean();
  if (override) return override.enabled;
  return weeklyEnabled;
}

/**
 * @returns {Promise<string[]>} enabled IIT slot ids
 */
async function getEnabledIitSlotIds() {
  const configMap = await ensureIitSlotConfigs();
  return ALL_IIT_SLOT_IDS.filter((slotId) => configMap[slotId] !== false);
}

/**
 * @returns {Promise<string[]>} enabled IIT booking labels e.g. "Wednesday 6PM"
 */
async function getEnabledIitSlotBookings() {
  const enabledIds = await getEnabledIitSlotIds();
  return enabledIds.map((id) => IIT_SLOT_ID_TO_BOOKING_LABEL[id]).filter(Boolean);
}

/**
 * @param {string} slotBookingLabel e.g. "Wednesday 6PM"
 * @param {string} [dateYmd] optional IST calendar date
 * @returns {Promise<boolean>}
 */
async function isIitSlotBookingEnabled(slotBookingLabel, dateYmd) {
  const label = typeof slotBookingLabel === 'string' ? slotBookingLabel.trim() : '';
  const slotId = IIT_BOOKING_LABEL_TO_SLOT_ID[label];
  if (!slotId) return false;
  return isIitSlotIdEnabledForDate(slotId, dateYmd);
}

/**
 * Date-specific overrides for IIT slots (for public form filtering).
 * @param {string} fromYmd
 * @param {string} toYmd
 * @returns {Promise<Array<{ date: string, slotId: string, enabled: boolean }>>}
 */
async function getIitSlotDateOverridesInRange(fromYmd, toYmd) {
  const fromRange = getISTDayRangeFromString(fromYmd);
  const toRange = getISTDayRangeFromString(toYmd);
  if (!fromRange || !toRange) return [];

  const endExclusive = new Date(toRange.start.getTime() + 24 * 60 * 60 * 1000);
  const rows = await IitSlotDateOverride.find({
    date: { $gte: fromRange.start, $lt: endExclusive },
    slotId: { $in: ALL_IIT_SLOT_IDS },
  }).lean();

  return rows.map((o) => ({
    date: new Date(o.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    slotId: o.slotId,
    enabled: o.enabled,
  }));
}

module.exports = {
  getEnabledIitSlotIds,
  getEnabledIitSlotBookings,
  isIitSlotBookingEnabled,
  isIitSlotIdEnabledForDate,
  getIitSlotDateOverridesInRange,
  ensureIitSlotConfigs,
};
