const IitSlotConfig = require('../models/IitSlotConfig');
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
 * @returns {Promise<boolean>}
 */
async function isIitSlotBookingEnabled(slotBookingLabel) {
  const label = typeof slotBookingLabel === 'string' ? slotBookingLabel.trim() : '';
  const slotId = IIT_BOOKING_LABEL_TO_SLOT_ID[label];
  if (!slotId) return false;
  const configMap = await ensureIitSlotConfigs();
  return configMap[slotId] !== false;
}

module.exports = {
  getEnabledIitSlotIds,
  getEnabledIitSlotBookings,
  isIitSlotBookingEnabled,
  ensureIitSlotConfigs,
};
