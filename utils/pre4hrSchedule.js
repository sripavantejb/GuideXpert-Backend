/**
 * T−4h pre4hr cron eligibility facade (implementation in waSlotRelativeSchedule.js).
 *
 * Env:
 *   WA_PRE4HR_OFFSET_MS — ms from "now" until ideal slot start for this cron tick (default 4h).
 *   WA_PRE4HR_CRON_WINDOW_MS — total width of the slotDate band (default 10m).
 */

const {
  getReminderCronConfigFromEnv,
  getSlotDateBoundsForCron,
  isSlotDateInCronWindow,
  MIN_WINDOW_MS,
  DEFAULT_CRON_WINDOW_MS,
  DEFAULT_PRE4HR_OFFSET_MS
} = require('./waSlotRelativeSchedule');

const DEFAULT_OFFSET_MS = DEFAULT_PRE4HR_OFFSET_MS;
const DEFAULT_WINDOW_MS = DEFAULT_CRON_WINDOW_MS;

function getPre4hrCronConfigFromEnv() {
  return getReminderCronConfigFromEnv({
    offsetEnvKey: 'WA_PRE4HR_OFFSET_MS',
    windowEnvKey: 'WA_PRE4HR_CRON_WINDOW_MS',
    defaultOffsetMs: DEFAULT_OFFSET_MS,
    defaultWindowMs: DEFAULT_WINDOW_MS
  });
}

function getPre4hrSlotDateBoundsForCron(now = new Date(), configOverride = null) {
  return getSlotDateBoundsForCron(now, configOverride || getPre4hrCronConfigFromEnv());
}

function isSlotDateInPre4hrCronWindow(slotDate, now = new Date(), configOverride = null) {
  const cfg = configOverride || getPre4hrCronConfigFromEnv();
  return isSlotDateInCronWindow(slotDate, now, cfg);
}

module.exports = {
  getPre4hrCronConfigFromEnv,
  getPre4hrSlotDateBoundsForCron,
  isSlotDateInPre4hrCronWindow,
  DEFAULT_OFFSET_MS,
  DEFAULT_WINDOW_MS,
  MIN_WINDOW_MS
};
