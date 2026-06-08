const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Reminder call fires 1 hour before counselling session start.
 * @param {Date} slotInstantUtc
 * @returns {Date|null}
 */
function computeCallbackTimeFromSlot(slotInstantUtc) {
  if (!slotInstantUtc || !(slotInstantUtc instanceof Date) || Number.isNaN(slotInstantUtc.getTime())) {
    return null;
  }
  return new Date(slotInstantUtc.getTime() - ONE_HOUR_MS);
}

const MIN_SCHEDULE_LEAD_MS = 60 * 1000;

function isCallbackTimeInPast(callbackTime, now = new Date()) {
  if (!callbackTime || !(callbackTime instanceof Date) || Number.isNaN(callbackTime.getTime())) {
    return true;
  }
  return callbackTime.getTime() <= now.getTime();
}

/** OSVI requires callback_timestamp far enough in the future. */
function isCallbackTimeTooSoon(callbackTime, now = new Date(), leadMs = MIN_SCHEDULE_LEAD_MS) {
  if (!callbackTime || !(callbackTime instanceof Date) || Number.isNaN(callbackTime.getTime())) {
    return true;
  }
  return callbackTime.getTime() < now.getTime() + leadMs;
}

function defaultTestCallbackTime(now = new Date()) {
  return new Date(now.getTime() + 2 * MIN_SCHEDULE_LEAD_MS);
}

module.exports = {
  ONE_HOUR_MS,
  MIN_SCHEDULE_LEAD_MS,
  computeCallbackTimeFromSlot,
  isCallbackTimeInPast,
  isCallbackTimeTooSoon,
  defaultTestCallbackTime,
};
