/**
 * Build OSVI /callback payload for IIT counselling reminders and test calls.
 */

const DEFAULT_IIT_AGENT_UUID = 'agent_XIOeYW9_MC5G9vHNsKTnD_dW4w';

/** IIT counselling callbacks always use the IIT agent — never OSVI_AGENT_UUID (abandoned-apply flow). */
function getAgentUuid() {
  const raw = process.env.OSVI_IIT_AGENT_UUID || DEFAULT_IIT_AGENT_UUID;
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

function nonEmptyString(v, fallback = 'test') {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 2000);
  return fallback;
}

function mergeFormSnapshot(reminder) {
  const snap = reminder?.formSnapshot && typeof reminder.formSnapshot === 'object'
    ? { ...reminder.formSnapshot }
    : {};

  return {
    source: 'iitian_career_counselling',
    student_name: reminder.studentName || snap.student_name || null,
    phone: reminder.phone || snap.phone || null,
    parent_name: reminder.parentName ?? snap.parent_name ?? null,
    email: reminder.email ?? snap.email ?? null,
    class: reminder.class ?? snap.class ?? null,
    city: reminder.city ?? snap.city ?? null,
    school: reminder.school ?? snap.school ?? null,
    biggest_concern: reminder.biggestConcern ?? snap.biggest_concern ?? null,
    career_goal: reminder.careerGoal ?? snap.career_goal ?? null,
    selected_slot: reminder.selectedSlot ?? snap.selected_slot ?? null,
    slot_booking: snap.slot_booking ?? null,
    slot_booking_date: snap.slot_booking_date ?? null,
    counselling_session_at: reminder.selectedSlotInstantUtc
      ? new Date(reminder.selectedSlotInstantUtc).toISOString()
      : snap.counselling_session_at ?? null,
    reminder_at: reminder.callbackTime
      ? new Date(reminder.callbackTime).toISOString()
      : null,
    slot_day_ist: reminder.slotDayIst ?? snap.slot_day_ist ?? null,
    student_or_parent: snap.student_or_parent ?? null,
    occupation: snap.occupation ?? null,
    stream: snap.stream ?? null,
    top5_colleges: snap.top5_colleges ?? null,
    top5_colleges_text: snap.top5_colleges_text ?? null,
    career_decision_clarity: snap.career_decision_clarity ?? null,
    college_decision_stakeholder: snap.college_decision_stakeholder ?? null,
    expected_budget: snap.expected_budget ?? null,
    top_college_priority: snap.top_college_priority ?? null,
    preferred_language: snap.preferred_language ?? null,
    help_needed: snap.help_needed ?? null,
    wants_one_to_one_session: snap.wants_one_to_one_session ?? null,
    form_step: snap.form_step ?? null,
    form_completed: snap.form_completed ?? null,
    application_status: snap.application_status ?? null,
  };
}

function buildAdditionalDataFromReminder(reminder) {
  return mergeFormSnapshot(reminder);
}

function buildAdditionalDataFromTestCall(input) {
  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  return {
    source: 'admin_panel',
    type: 'test_call',
    student_name: input.personName || null,
    phone: input.phone || null,
    biggest_concern: notes || 'test',
    career_goal: null,
    selected_slot: null,
    notes: notes || null,
    class: null,
    city: null,
    stream: null,
    preferred_language: null,
    help_needed: null,
    wants_one_to_one_session: null,
    top5_colleges: null,
    form_completed: null,
  };
}

function buildPrevCallSummaryFromReminder(reminder) {
  const data = mergeFormSnapshot(reminder);
  const parts = [];
  if (data.student_name) parts.push(`Student ${data.student_name}`);
  if (data.selected_slot) parts.push(`Session ${data.selected_slot}`);
  if (data.biggest_concern) parts.push(`Concern: ${data.biggest_concern}`);
  if (data.career_goal) parts.push(`Goal: ${data.career_goal}`);
  if (data.class) parts.push(`Class: ${data.class}`);
  if (data.city) parts.push(`City: ${data.city}`);
  if (data.preferred_language) parts.push(`Language: ${data.preferred_language}`);
  if (data.top5_colleges_text) parts.push(`Colleges: ${data.top5_colleges_text}`);
  const summary = parts.join('. ').trim();
  return summary || nonEmptyString(data.biggest_concern);
}

function buildPrevCallSummaryFromTest(input) {
  return nonEmptyString(input.notes);
}

/**
 * @param {object} reminder lean AiCallReminder or mapped fields
 */
function buildOsviPayloadFromReminder(reminder) {
  const phone = formatPhoneForOsvi(reminder.phone);
  const callbackTime = reminder.callbackTime instanceof Date
    ? reminder.callbackTime
    : new Date(reminder.callbackTime);

  const additionalData = buildAdditionalDataFromReminder(reminder);
  additionalData.reminder_at = callbackTime.toISOString();

  return {
    agent_uuid: getAgentUuid(),
    phone,
    person_name: reminder.studentName || reminder.personName || '',
    callback_timestamp: callbackTime.toISOString(),
    prev_call_summary: buildPrevCallSummaryFromReminder(reminder),
    additional_data: additionalData,
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

  const additionalData = buildAdditionalDataFromTestCall({
    ...input,
    phone: input.phone,
  });
  additionalData.reminder_at = callbackTime.toISOString();

  return {
    agent_uuid: getAgentUuid(),
    phone,
    person_name: input.personName || '',
    callback_timestamp: callbackTime.toISOString(),
    prev_call_summary: buildPrevCallSummaryFromTest(input),
    additional_data: additionalData,
  };
}

module.exports = {
  DEFAULT_IIT_AGENT_UUID,
  getAgentUuid,
  formatPhoneForOsvi,
  mergeFormSnapshot,
  buildAdditionalDataFromReminder,
  buildAdditionalDataFromTestCall,
  buildOsviPayloadFromReminder,
  buildOsviPayloadFromTestCall,
};
