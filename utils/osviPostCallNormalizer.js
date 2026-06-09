function pickString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function pickNumber(...values) {
  for (const v of values) {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function pickDate(...values) {
  for (const v of values) {
    if (!v) continue;
    const d = v instanceof Date ? v : new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function extractDataExtraction(body) {
  const direct = asObject(body?.data_extraction)
    || asObject(body?.dataExtraction)
    || asObject(body?.data_capture)
    || asObject(body?.dataCapture)
    || asObject(body?.extracted_data)
    || asObject(body?.extractedData);

  if (direct) return direct;

  const structured = asObject(body?.structured_output) || asObject(body?.structuredOutput);
  if (structured) return structured;

  return body && typeof body === 'object' ? body : {};
}

/**
 * Normalize OSVI post-call integration payloads (Auto or flat legacy format).
 * @param {object} body raw webhook body
 */
function normalizeOsviPostCallPayload(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const callInfo = asObject(payload.call_info) || asObject(payload.callInfo) || payload;
  const extraction = extractDataExtraction(payload);

  const callLogId = pickString(
    callInfo.call_log_id,
    callInfo.callLogId,
    payload.call_log_id,
    payload.callLogId,
    payload.callId,
    payload.call_id,
    payload.id,
  );

  const phoneRaw = pickString(
    callInfo.phone_number,
    callInfo.phoneNumber,
    callInfo.phone,
    payload.phone_number,
    payload.phoneNumber,
    payload.phone,
  );

  const summary = pickString(
    payload.call_summary,
    payload.callSummary,
    payload.ai_summary,
    payload.aiSummary,
    payload.summary,
  );

  const transcript = pickString(payload.transcript, payload.conversation, payload.call_transcript);

  const triggerData = asObject(payload.call_trigger_data)
    || asObject(payload.callTriggerData)
    || asObject(payload.additional_data)
    || asObject(payload.additionalData)
    || null;

  return {
    callLogId,
    phone: normalizePhone(phoneRaw),
    personName: pickString(
      callInfo.person_name,
      callInfo.personName,
      payload.person_name,
      payload.personName,
      triggerData?.student_name,
      triggerData?.person_name,
    ),
    agentName: pickString(callInfo.agent_name, callInfo.agentName, payload.agent_name, payload.agentName),
    callStatus: pickString(callInfo.call_status, callInfo.callStatus, payload.call_status, payload.status),
    callType: pickString(callInfo.call_type, callInfo.callType, payload.call_type, payload.callType),
    duration: pickNumber(callInfo.duration, payload.duration),
    recordingUrl: pickString(callInfo.recording_url, callInfo.recordingUrl, payload.recording_url, payload.recordingUrl),
    callTime: pickDate(callInfo.call_time, callInfo.callTime, payload.call_time, payload.callTime),
    summary,
    transcript,
    confirmation: pickString(extraction.confirmation),
    callOutcome: pickString(extraction.call_outcome, extraction.callOutcome),
    studentConcern: pickString(extraction.student_concern, extraction.studentConcern),
    examAttempted: pickString(extraction.exam_attempted, extraction.examAttempted),
    timeConfirmed: pickString(extraction.time_confirmed, extraction.timeConfirmed),
    rescheduleRequested: pickString(extraction.reschedule_requested, extraction.rescheduleRequested),
    preferredCallbackTime: pickString(extraction.callback_time, extraction.callbackTime),
    structuredOutput: asObject(payload.structured_output) || asObject(payload.structuredOutput),
    triggerData,
    rawPayload: payload,
  };
}

function isIitianCareerCounsellingCall(normalized) {
  const source = normalized?.triggerData?.source;
  if (source === 'iitian_career_counselling') return true;
  const agent = String(normalized?.agentName || '').toLowerCase();
  if (agent.includes('iit') && (agent.includes('reminder') || agent.includes('counselling') || agent.includes('counseling'))) {
    return true;
  }
  return normalized?.callType === 'callback';
}

function mapOutcomeToReminderStatus(callOutcome, callStatus) {
  const outcome = String(callOutcome || '').toLowerCase();
  if (outcome.includes('confirmed')) return 'completed';
  if (outcome.includes('undecided')) return 'completed';
  if (outcome.includes('not interested')) return 'completed';
  if (outcome.includes('reschedule')) return 'completed';
  if (outcome.includes('no answer')) return 'failed';

  const status = String(callStatus || '').toLowerCase();
  if (['completed', 'success', 'done'].includes(status)) return 'completed';
  if (['failed', 'failure', 'error', 'no_answer', 'no-answer', 'busy', 'unanswered'].includes(status)) {
    return 'failed';
  }
  if (['processing', 'in_progress', 'ringing', 'active'].includes(status)) return 'processing';
  return null;
}

module.exports = {
  normalizeOsviPostCallPayload,
  isIitianCareerCounsellingCall,
  mapOutcomeToReminderStatus,
  normalizePhone,
};
