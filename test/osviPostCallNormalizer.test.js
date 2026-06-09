const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeOsviPostCallPayload,
  mapOutcomeToReminderStatus,
  isIitianCareerCounsellingCall,
} = require('../utils/osviPostCallNormalizer');

test('normalizeOsviPostCallPayload handles nested OSVI integration body', () => {
  const normalized = normalizeOsviPostCallPayload({
    call_info: {
      call_log_id: 'log_123',
      phone_number: '+919876543210',
      agent_name: 'Demo Reminder IIT session telugu',
      call_status: 'completed',
      duration: 120,
    },
    call_summary: 'Student confirmed attendance for session.',
    transcript: 'Agent: Hello\nStudent: Yes',
    data_extraction: {
      confirmation: 'YES',
      call_outcome: 'Confirmed',
      student_concern: 'College Selection',
      exam_attempted: 'JEE',
      time_confirmed: 'YES',
      reschedule_requested: 'NO',
      callback_time: '',
    },
    call_trigger_data: {
      source: 'iitian_career_counselling',
      student_name: 'Ravi',
      selected_slot: 'Sat 7 PM',
    },
  });

  assert.equal(normalized.callLogId, 'log_123');
  assert.equal(normalized.phone, '9876543210');
  assert.equal(normalized.personName, 'Ravi');
  assert.equal(normalized.callOutcome, 'Confirmed');
  assert.equal(normalized.confirmation, 'YES');
  assert.equal(normalized.summary, 'Student confirmed attendance for session.');
});

test('normalizeOsviPostCallPayload handles legacy flat call-session body', () => {
  const normalized = normalizeOsviPostCallPayload({
    callId: 'legacy_1',
    phone: '9123456789',
    status: 'completed',
    summary: 'Legacy summary',
    additional_data: { source: 'iitian_career_counselling', student_name: 'Priya' },
  });

  assert.equal(normalized.callLogId, 'legacy_1');
  assert.equal(normalized.phone, '9123456789');
  assert.equal(normalized.personName, 'Priya');
});

test('mapOutcomeToReminderStatus maps confirmed to completed', () => {
  assert.equal(mapOutcomeToReminderStatus('Confirmed', 'completed'), 'completed');
  assert.equal(mapOutcomeToReminderStatus('No Answer', 'failed'), 'failed');
});

test('isIitianCareerCounsellingCall detects IIT reminder agent', () => {
  assert.equal(
    isIitianCareerCounsellingCall({ agentName: 'Demo Reminder IIT session telugu', callType: 'outbound' }),
    true,
  );
});
