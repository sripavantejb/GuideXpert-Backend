const AppSettings = require('../models/AppSettings');

const OSVI_KEY = 'osviEnabled';
const OSVI_ABANDONED_DELAY_KEY = 'osviAbandonedDelayMs';
const DEFAULT_OSVI_ABANDONED_DELAY_MS = Math.max(
  0,
  Number(process.env.OSVI_ABANDONED_DELAY_MS) || 10 * 60 * 1000
);

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

/** Returns abandoned-flow delay in milliseconds (default: env or 10 minutes). */
async function getOsviAbandonedDelayMs() {
  try {
    const doc = await AppSettings.findOne({ key: OSVI_ABANDONED_DELAY_KEY }).lean();
    if (!doc) return DEFAULT_OSVI_ABANDONED_DELAY_MS;
    const n = Number(doc.value);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_OSVI_ABANDONED_DELAY_MS;
    return Math.floor(n);
  } catch (err) {
    console.error('[AppSettings] getOsviAbandonedDelayMs error — using default:', err.message);
    return DEFAULT_OSVI_ABANDONED_DELAY_MS;
  }
}

/** Set abandoned-flow delay (ms). */
async function setOsviAbandonedDelayMs(delayMs) {
  const n = Number(delayMs);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('delayMs must be a non-negative number');
  }
  const value = Math.floor(n);
  await AppSettings.findOneAndUpdate(
    { key: OSVI_ABANDONED_DELAY_KEY },
    { key: OSVI_ABANDONED_DELAY_KEY, value },
    { upsert: true, new: true }
  );
  return value;
}

module.exports = {
  getOsviEnabled,
  setOsviEnabled,
  getOsviAbandonedDelayMs,
  setOsviAbandonedDelayMs,
  DEFAULT_OSVI_ABANDONED_DELAY_MS,
};
