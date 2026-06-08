const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOsviPayloadFromReminder,
  buildOsviPayloadFromTestCall,
  formatPhoneForOsvi,
} = require('../utils/aiCallReminderPayload');

describe('aiCallReminderPayload', () => {
  const origAgent = process.env.OSVI_IIT_AGENT_UUID;

  before(() => {
    process.env.OSVI_IIT_AGENT_UUID = 'agent_test_uuid';
  });

  after(() => {
    if (origAgent === undefined) delete process.env.OSVI_IIT_AGENT_UUID;
    else process.env.OSVI_IIT_AGENT_UUID = origAgent;
  });

  it('formats phone with 91 prefix', () => {
    assert.equal(formatPhoneForOsvi('9876543210'), '919876543210');
    assert.equal(formatPhoneForOsvi('+91 9876543210'), '919876543210');
  });

  it('builds reminder payload shape', () => {
    const callbackTime = new Date('2026-06-15T11:30:00.000Z');
    const payload = buildOsviPayloadFromReminder({
      studentName: 'Tej',
      phone: '9876543210',
      class: '12th',
      city: 'Hyderabad',
      biggestConcern: 'Course',
      selectedSlot: 'Wednesday 6PM, 2026-06-15',
      callbackTime,
    });
    assert.equal(payload.agent_uuid, 'agent_test_uuid');
    assert.equal(payload.phone, '919876543210');
    assert.equal(payload.person_name, 'Tej');
    assert.equal(payload.callback_timestamp, callbackTime.toISOString());
    assert.equal(payload.additional_data.source, 'iitian_career_counselling');
    assert.equal(payload.additional_data.biggest_concern, 'Course');
    assert.ok(payload.prev_call_summary);
    assert.match(payload.prev_call_summary, /Booked slot/);
  });

  it('builds test call payload', () => {
    const callbackTime = new Date('2026-06-15T11:30:00.000Z');
    const payload = buildOsviPayloadFromTestCall({
      personName: 'Admin Test',
      phone: '9876543210',
      callbackTime,
      notes: 'hello',
    });
    assert.equal(payload.additional_data.type, 'test_call');
    assert.equal(payload.additional_data.source, 'admin_panel');
    assert.equal(payload.additional_data.notes, 'hello');
    assert.equal(payload.prev_call_summary, 'hello');
  });

  it('uses default prev_call_summary when test notes empty', () => {
    const payload = buildOsviPayloadFromTestCall({
      personName: 'Admin',
      phone: '9876543210',
      callbackTime: new Date('2026-06-15T11:30:00.000Z'),
    });
    assert.ok(payload.prev_call_summary);
    assert.match(payload.prev_call_summary, /No previous call|First IIT/i);
  });
});
