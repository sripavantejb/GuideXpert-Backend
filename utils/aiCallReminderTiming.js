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

function isCallbackTimeInPast(callbackTime, now = new Date()) {
  if (!callbackTime || !(callbackTime instanceof Date) || Number.isNaN(callbackTime.getTime())) {
    return true;
  }
  return callbackTime.getTime() <= now.getTime();
}

module.exports = {
  ONE_HOUR_MS,
  computeCallbackTimeFromSlot,
  isCallbackTimeInPast,
};
