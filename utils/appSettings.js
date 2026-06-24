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

const AI_CALLS_SCHEDULING_MODE_KEY = 'aiCallsSchedulingMode';
const AI_CALLS_SCHEDULING_MODES = ['manual_approval', 'automatic'];

async function getAiCallsSchedulingMode() {
  try {
    const doc = await AppSettings.findOne({ key: AI_CALLS_SCHEDULING_MODE_KEY }).lean();
    if (!doc || typeof doc.value !== 'string') return 'manual_approval';
    const v = doc.value.trim();
    return AI_CALLS_SCHEDULING_MODES.includes(v) ? v : 'manual_approval';
  } catch (err) {
    console.error('[AppSettings] getAiCallsSchedulingMode error — defaulting to manual_approval:', err.message);
    return 'manual_approval';
  }
}

async function setAiCallsSchedulingMode(mode) {
  const v = typeof mode === 'string' ? mode.trim() : '';
  if (!AI_CALLS_SCHEDULING_MODES.includes(v)) {
    throw new Error(`schedulingMode must be one of: ${AI_CALLS_SCHEDULING_MODES.join(', ')}`);
  }
  await AppSettings.findOneAndUpdate(
    { key: AI_CALLS_SCHEDULING_MODE_KEY },
    { key: AI_CALLS_SCHEDULING_MODE_KEY, value: v },
    { upsert: true, new: true }
  );
  return v;
}

const ADMIN_SIDEBAR_CONFIG_KEY = 'adminSidebarConfig';
const SIDEBAR_PLACEMENTS = ['counsellors', 'students', 'both'];

function getDefaultAdminSidebarConfig() {
  return {
    sectionsEnabled: { counsellors: true, students: true },
    overrides: {},
  };
}

function normalizeAdminSidebarConfig(raw) {
  const defaults = getDefaultAdminSidebarConfig();
  if (!raw || typeof raw !== 'object') return defaults;

  const sectionsEnabled = {
    counsellors:
      raw.sectionsEnabled && typeof raw.sectionsEnabled.counsellors === 'boolean'
        ? raw.sectionsEnabled.counsellors
        : defaults.sectionsEnabled.counsellors,
    students:
      raw.sectionsEnabled && typeof raw.sectionsEnabled.students === 'boolean'
        ? raw.sectionsEnabled.students
        : defaults.sectionsEnabled.students,
  };

  const overrides = {};
  if (raw.overrides && typeof raw.overrides === 'object') {
    for (const [route, placement] of Object.entries(raw.overrides)) {
      if (typeof route === 'string' && SIDEBAR_PLACEMENTS.includes(placement)) {
        overrides[route] = placement;
      }
    }
  }

  return { sectionsEnabled, overrides };
}

async function getAdminSidebarConfig() {
  try {
    const doc = await AppSettings.findOne({ key: ADMIN_SIDEBAR_CONFIG_KEY }).lean();
    if (!doc || !doc.value) return getDefaultAdminSidebarConfig();
    return normalizeAdminSidebarConfig(doc.value);
  } catch (err) {
    console.error('[AppSettings] getAdminSidebarConfig error — using defaults:', err.message);
    return getDefaultAdminSidebarConfig();
  }
}

async function setAdminSidebarConfig(partial) {
  const current = await getAdminSidebarConfig();
  const next = normalizeAdminSidebarConfig({
    sectionsEnabled: {
      counsellors:
        partial?.sectionsEnabled && typeof partial.sectionsEnabled.counsellors === 'boolean'
          ? partial.sectionsEnabled.counsellors
          : current.sectionsEnabled.counsellors,
      students:
        partial?.sectionsEnabled && typeof partial.sectionsEnabled.students === 'boolean'
          ? partial.sectionsEnabled.students
          : current.sectionsEnabled.students,
    },
    overrides:
      partial?.overrides && typeof partial.overrides === 'object'
        ? { ...current.overrides, ...partial.overrides }
        : current.overrides,
  });

  await AppSettings.findOneAndUpdate(
    { key: ADMIN_SIDEBAR_CONFIG_KEY },
    { key: ADMIN_SIDEBAR_CONFIG_KEY, value: next },
    { upsert: true, new: true }
  );
  return next;
}

module.exports = {
  getOsviEnabled,
  setOsviEnabled,
  getOsviAbandonedDelayMs,
  setOsviAbandonedDelayMs,
  DEFAULT_OSVI_ABANDONED_DELAY_MS,
  getAiCallsSchedulingMode,
  setAiCallsSchedulingMode,
  AI_CALLS_SCHEDULING_MODES,
  getAdminSidebarConfig,
  setAdminSidebarConfig,
  getDefaultAdminSidebarConfig,
};
