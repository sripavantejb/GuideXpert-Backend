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

/** Default sample fields for admin test calls — mirrors real IIT counselling reminder queue. */
const DEFAULT_TEST_CALL_SAMPLE = {
  class: 'Studying 12th/Intermediate 2nd Year',
  city: 'Hyderabad',
  stream: 'MPC',
  biggestConcern: 'College selection',
  careerGoal: 'Career Counseling with IITian',
  preferredLanguage: 'Telugu',
  top5Colleges: ['IIT Hyderabad', 'NIT Warangal', 'BITS Pilani'],
  top5CollegesText: 'IIT Hyderabad, NIT Warangal, BITS Pilani',
  studentOrParent: 'Student',
  helpNeeded: 'Career Counseling with IITian',
  wantsOneToOneSession: 'Yes',
  expectedBudget: '3-6L',
  careerDecisionClarity: 'Somewhat clear',
  collegeDecisionStakeholder: 'Both',
  topCollegePriority: 'Placements',
  formCompleted: true,
  applicationStatus: 'completed',
};

function pickStringField(input, ...keys) {
  for (const key of keys) {
    const v = input?.[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Next/upcoming Saturday 7 PM IST label for agent {{additional_data.selected_slot}}. */
function formatUpcomingSaturday7pmSlotLabel(fromDate = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: 'numeric',
    hour12: true,
  });
  const parts = fmt.formatToParts(fromDate);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const weekday = get('weekday');
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const currentDay = dayMap[weekday] ?? 0;
  let daysUntilSat = (6 - currentDay + 7) % 7;
  const hour = Number(get('hour')) || 0;
  const dayPeriod = get('dayPeriod');
  const hour24 = dayPeriod === 'PM' && hour < 12 ? hour + 12 : (dayPeriod === 'AM' && hour === 12 ? 0 : hour);
  if (daysUntilSat === 0 && hour24 >= 19) daysUntilSat = 7;
  if (daysUntilSat === 0 && currentDay === 6) daysUntilSat = 0;

  const base = new Date(fromDate.getTime());
  base.setUTCDate(base.getUTCDate() + (daysUntilSat || 7));
  const dateIst = base.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return `Saturday 7 PM, ${dateIst}`;
}

function buildPrevCallSummaryFromAdditionalData(data) {
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

function buildAdditionalDataFromTestCall(input) {
  const sample = DEFAULT_TEST_CALL_SAMPLE;
  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  const personName = pickStringField(input, 'personName', 'studentName') || 'Ravi Kumar';
  const phone10 = String(input.phone || '').replace(/\D/g, '').slice(-10) || null;
  const selectedSlot = pickStringField(input, 'selectedSlot', 'selected_slot')
    || formatUpcomingSaturday7pmSlotLabel(
      input.callbackTime instanceof Date ? input.callbackTime : new Date(input.callbackTime || Date.now()),
    );
  const top5Colleges = Array.isArray(input.top5Colleges)
    ? input.top5Colleges.filter(Boolean).map((c) => String(c).trim()).filter(Boolean)
    : (pickStringField(input, 'top5CollegesText', 'top5_colleges_text') || sample.top5CollegesText)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const top5CollegesText = pickStringField(input, 'top5CollegesText', 'top5_colleges_text')
    || (top5Colleges.length ? top5Colleges.join(', ') : sample.top5CollegesText);

  const callbackTime = input.callbackTime instanceof Date
    ? input.callbackTime
    : new Date(input.callbackTime || Date.now());
  const slotDayIst = !Number.isNaN(callbackTime.getTime())
    ? callbackTime.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    : null;

  return {
    source: 'iitian_career_counselling',
    type: 'test_call',
    student_name: personName,
    phone: phone10,
    parent_name: null,
    email: null,
    class: pickStringField(input, 'class') || sample.class,
    city: pickStringField(input, 'city') || sample.city,
    school: null,
    biggest_concern: pickStringField(input, 'biggestConcern', 'biggest_concern') || notes || sample.biggestConcern,
    career_goal: pickStringField(input, 'careerGoal', 'career_goal') || sample.careerGoal,
    selected_slot: selectedSlot,
    slot_booking: 'Saturday 7PM',
    slot_booking_date: selectedSlot.includes(',') ? selectedSlot.split(',').pop().trim() : null,
    counselling_session_at: null,
    reminder_at: !Number.isNaN(callbackTime.getTime()) ? callbackTime.toISOString() : null,
    slot_day_ist: slotDayIst,
    student_or_parent: pickStringField(input, 'studentOrParent', 'student_or_parent') || sample.studentOrParent,
    occupation: pickStringField(input, 'occupation') || 'Student',
    stream: pickStringField(input, 'stream') || sample.stream,
    top5_colleges: top5Colleges.length ? top5Colleges : sample.top5Colleges,
    top5_colleges_text: top5CollegesText,
    career_decision_clarity: pickStringField(input, 'careerDecisionClarity', 'career_decision_clarity') || sample.careerDecisionClarity,
    college_decision_stakeholder: pickStringField(input, 'collegeDecisionStakeholder', 'college_decision_stakeholder') || sample.collegeDecisionStakeholder,
    expected_budget: pickStringField(input, 'expectedBudget', 'expected_budget') || sample.expectedBudget,
    top_college_priority: pickStringField(input, 'topCollegePriority', 'top_college_priority') || sample.topCollegePriority,
    preferred_language: pickStringField(input, 'preferredLanguage', 'preferred_language') || sample.preferredLanguage,
    help_needed: pickStringField(input, 'helpNeeded', 'help_needed') || sample.helpNeeded,
    wants_one_to_one_session: pickStringField(input, 'wantsOneToOneSession', 'wants_one_to_one_session') || sample.wantsOneToOneSession,
    form_step: 3,
    form_completed: input.formCompleted ?? sample.formCompleted,
    application_status: pickStringField(input, 'applicationStatus', 'application_status') || sample.applicationStatus,
    notes: notes || null,
  };
}

function buildPrevCallSummaryFromReminder(reminder) {
  return buildPrevCallSummaryFromAdditionalData(mergeFormSnapshot(reminder));
}

function buildPrevCallSummaryFromTest(input) {
  return buildPrevCallSummaryFromAdditionalData(buildAdditionalDataFromTestCall(input));
}

/** Prefill values for the admin Request Test Call form. */
function getDefaultTestCallFormValues() {
  return {
    personName: 'Ravi Kumar',
    phone: '',
    callbackTime: null,
    notes: 'Registered for free IITian career counselling session — college selection guidance.',
    class: DEFAULT_TEST_CALL_SAMPLE.class,
    city: DEFAULT_TEST_CALL_SAMPLE.city,
    stream: DEFAULT_TEST_CALL_SAMPLE.stream,
    selectedSlot: formatUpcomingSaturday7pmSlotLabel(),
    biggestConcern: DEFAULT_TEST_CALL_SAMPLE.biggestConcern,
    preferredLanguage: DEFAULT_TEST_CALL_SAMPLE.preferredLanguage,
    top5CollegesText: DEFAULT_TEST_CALL_SAMPLE.top5CollegesText,
  };
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
  DEFAULT_TEST_CALL_SAMPLE,
  getAgentUuid,
  formatPhoneForOsvi,
  formatUpcomingSaturday7pmSlotLabel,
  mergeFormSnapshot,
  buildAdditionalDataFromReminder,
  buildAdditionalDataFromTestCall,
  buildOsviPayloadFromReminder,
  buildOsviPayloadFromTestCall,
  getDefaultTestCallFormValues,
};
