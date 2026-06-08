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

function defaultPrevCallSummary() {
  const env = process.env.OSVI_DEFAULT_PREV_CALL_SUMMARY;
  if (typeof env === 'string' && env.trim()) return env.trim().slice(0, 2000);
  return 'No previous call with this student. First IIT career counselling reminder.';
}

function buildPrevCallSummaryForReminder(reminder) {
  const parts = [];
  if (reminder.selectedSlot) parts.push(`Booked slot: ${reminder.selectedSlot}`);
  if (reminder.biggestConcern) parts.push(`Main concern: ${reminder.biggestConcern}`);
  if (reminder.careerGoal) parts.push(`Career goal: ${reminder.careerGoal}`);
  if (reminder.class) parts.push(`Class: ${reminder.class}`);
  if (reminder.city) parts.push(`City: ${reminder.city}`);
  const summary = parts.join('. ').trim();
  return summary || defaultPrevCallSummary();
}

function buildPrevCallSummaryForTest(input) {
  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  if (notes) return notes.slice(0, 2000);
  return defaultPrevCallSummary();
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
    prev_call_summary: buildPrevCallSummaryForReminder(reminder),
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
    prev_call_summary: buildPrevCallSummaryForTest(input),
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
  buildPrevCallSummaryForReminder,
  buildPrevCallSummaryForTest,
  buildOsviPayloadFromReminder,
  buildOsviPayloadFromTestCall,
};
