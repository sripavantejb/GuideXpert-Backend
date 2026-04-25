const FormSubmission = require('../models/FormSubmission');
const SlotConfig = require('../models/SlotConfig');
const SlotDateOverride = require('../models/SlotDateOverride');
const { getISTDayRangeFromString } = require('../utils/dateHelpers');
const { ALL_SLOT_IDS, DAY_NAMES } = require('../constants/slotIds');

function getIstDayOfWeekFromDateRangeStart(start) {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  return new Date(start.getTime() + IST_OFFSET_MS).getUTCDay();
}

async function isSlotEnabledForDate(slotId, dateStartUtc) {
  const [config, override] = await Promise.all([
    SlotConfig.findOne({ slotId }).lean(),
    SlotDateOverride.findOne({ slotId, date: dateStartUtc }).lean(),
  ]);
  if (override && typeof override.enabled === 'boolean') return override.enabled;
  if (config && typeof config.enabled === 'boolean') return config.enabled;
  return true;
}

function validateSlotInput({ slotDate, selectedSlot }) {
  if (!slotDate || typeof slotDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(slotDate.trim())) {
    return { ok: false, status: 400, message: 'slotDate is required in YYYY-MM-DD format' };
  }
  if (!selectedSlot || typeof selectedSlot !== 'string' || !ALL_SLOT_IDS.includes(selectedSlot.trim())) {
    return { ok: false, status: 400, message: 'selectedSlot is invalid' };
  }
  return { ok: true };
}

async function updateLeadSlotByQuery({ query, slotDate, selectedSlot }) {
  const validated = validateSlotInput({ slotDate, selectedSlot });
  if (!validated.ok) return validated;

  const normalizedSlotId = selectedSlot.trim();
  const istDayRange = getISTDayRangeFromString(slotDate.trim());
  if (!istDayRange) {
    return { ok: false, status: 400, message: 'Invalid slotDate. Expected YYYY-MM-DD.' };
  }
  const { start } = istDayRange;

  const slotDayName = normalizedSlotId.split('_')[0];
  const requiredDow = DAY_NAMES.indexOf(slotDayName);
  const istDow = getIstDayOfWeekFromDateRangeStart(start);
  if (requiredDow === -1 || requiredDow !== istDow) {
    return { ok: false, status: 400, message: 'selectedSlot day does not match slotDate day' };
  }

  const enabled = await isSlotEnabledForDate(normalizedSlotId, start);
  if (!enabled) {
    return { ok: false, status: 400, message: 'selectedSlot is not available on the requested date' };
  }

  const updated = await FormSubmission.findOneAndUpdate(
    query,
    {
      $set: {
        selectedSlot: normalizedSlotId,
        'step3Data.selectedSlot': normalizedSlotId,
        'step3Data.slotDate': start,
        reminderSent: false,
        reminderSentAt: null,
        meetLinkSent: false,
        meetLinkSentAt: null,
        reminder30MinSent: false,
        reminder30MinSentAt: null,
      }
    },
    { new: true }
  ).lean();

  if (!updated) {
    return { ok: false, status: 404, message: 'Lead not found' };
  }

  return { ok: true, updated };
}

module.exports = {
  updateLeadSlotByQuery,
  ALL_SLOT_IDS,
};
