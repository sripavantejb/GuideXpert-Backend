/**
 * Build OSVI /callback payload — strict format:
 * { agent_uuid, phone (+91…), person_name, callback_timestamp, additional_data: { biggest_concern } }
 */

const DEFAULT_IIT_AGENT_UUID = 'agent_XIOeYW9_MC5G9vHNsKTnD_dW4w';

function getAgentUuid() {
  const raw = process.env.OSVI_IIT_AGENT_UUID || process.env.OSVI_AGENT_UUID || DEFAULT_IIT_AGENT_UUID;
  const v = typeof raw === 'string' ? raw.trim() : '';
  return v || DEFAULT_IIT_AGENT_UUID;
}

/** E.164-style India: +91XXXXXXXXXX */
function formatPhoneForOsvi(phone10) {
  const digits = String(phone10 || '').replace(/\D/g, '');
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
  if (last10.length !== 10) return null;
  return `+91${last10}`;
}

function buildAdditionalData(biggestConcern) {
  const value =
    typeof biggestConcern === 'string' && biggestConcern.trim()
      ? biggestConcern.trim().slice(0, 500)
      : 'test';
  return { biggest_concern: value };
}

/**
 * @param {object} reminder lean AiCallReminder or mapped fields
 */
function buildOsviPayloadFromReminder(reminder) {
  const phone = formatPhoneForOsvi(reminder.phone);
  const callbackTime = reminder.callbackTime instanceof Date
    ? reminder.callbackTime
    : new Date(reminder.callbackTime);

  return {
    agent_uuid: getAgentUuid(),
    phone,
    person_name: reminder.studentName || reminder.personName || '',
    callback_timestamp: callbackTime.toISOString(),
    additional_data: buildAdditionalData(reminder.biggestConcern),
  };
}

/**
 * @param {{ personName: string, phone: string, callbackTime: Date, notes?: string }} input
 */
function buildOsviPayloadFromTestCall(input) {
  const phone = formatPhoneForOsvi(input.phone);
  const callbackTime = input.callbackTime instanceof Date
    ? input.callbackTime
    : new Date(input.callbackTime);

  return {
    agent_uuid: getAgentUuid(),
    phone,
    person_name: input.personName || '',
    callback_timestamp: callbackTime.toISOString(),
    additional_data: buildAdditionalData(input.notes),
  };
}

module.exports = {
  DEFAULT_IIT_AGENT_UUID,
  getAgentUuid,
  formatPhoneForOsvi,
  buildOsviPayloadFromReminder,
  buildOsviPayloadFromTestCall,
};
