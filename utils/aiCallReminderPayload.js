/**
 * Build OSVI callback payload from reminder or test-call input.
 */

function getAgentUuid() {
  const raw = process.env.OSVI_IIT_AGENT_UUID || process.env.OSVI_AGENT_UUID || '';
  return typeof raw === 'string' ? raw.trim() : '';
}

function formatPhoneForOsvi(phone10) {
  const digits = String(phone10 || '').replace(/\D/g, '');
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
  if (last10.length !== 10) return null;
  return `91${last10}`;
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
    additional_data: {
      source: 'iitian_career_counselling',
      student_name: reminder.studentName || null,
      parent_name: reminder.parentName || null,
      class: reminder.class || null,
      city: reminder.city || null,
      biggest_concern: reminder.biggestConcern || null,
      selected_slot: reminder.selectedSlot || null,
    },
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
    additional_data: {
      type: 'test_call',
      source: 'admin_panel',
      notes: input.notes || null,
    },
  };
}

module.exports = {
  getAgentUuid,
  formatPhoneForOsvi,
  buildOsviPayloadFromReminder,
  buildOsviPayloadFromTestCall,
};
