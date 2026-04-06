const AppSettings = require('../models/AppSettings');

const OSVI_KEY = 'osviEnabled';

/**
 * Returns whether OSVI outbound calls are enabled.
 * Defaults to true if no record exists (on by default).
 */
async function getOsviEnabled() {
  try {
    const doc = await AppSettings.findOne({ key: OSVI_KEY }).lean();
    if (!doc) return true;
    return doc.value === true;
  } catch (err) {
    console.error('[AppSettings] getOsviEnabled error — defaulting to true:', err.message);
    return true;
  }
}

/**
 * Set OSVI outbound calls enabled/disabled.
 * @param {boolean} enabled
 */
async function setOsviEnabled(enabled) {
  const value = Boolean(enabled);
  await AppSettings.findOneAndUpdate(
    { key: OSVI_KEY },
    { key: OSVI_KEY, value },
    { upsert: true, new: true }
  );
  return value;
}

module.exports = { getOsviEnabled, setOsviEnabled };
