const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_IIT_AGENT_UUID,
  buildOsviPayloadFromReminder,
  buildOsviPayloadFromTestCall,
  formatPhoneForOsvi,
  getAgentUuid,
} = require('../utils/aiCallReminderPayload');

describe('aiCallReminderPayload', () => {
  const origIit = process.env.OSVI_IIT_AGENT_UUID;
  const origAgent = process.env.OSVI_AGENT_UUID;

  before(() => {
    delete process.env.OSVI_IIT_AGENT_UUID;
    delete process.env.OSVI_AGENT_UUID;
  });

  after(() => {
    if (origIit === undefined) delete process.env.OSVI_IIT_AGENT_UUID;
    else process.env.OSVI_IIT_AGENT_UUID = origIit;
    if (origAgent === undefined) delete process.env.OSVI_AGENT_UUID;
    else process.env.OSVI_AGENT_UUID = origAgent;
  });

  it('uses default IIT agent UUID', () => {
    assert.equal(getAgentUuid(), DEFAULT_IIT_AGENT_UUID);
    assert.equal(DEFAULT_IIT_AGENT_UUID, 'agent_XIOeYW9_MC5G9vHNsKTnD_dW4w');
  });

  it('formats phone with +91 prefix', () => {
    assert.equal(formatPhoneForOsvi('9876543210'), '+919876543210');
    assert.equal(formatPhoneForOsvi('+91 9876543210'), '+919876543210');
  });

  it('builds strict reminder payload shape', () => {
    const callbackTime = new Date('2026-06-15T11:30:00.000Z');
    const payload = buildOsviPayloadFromReminder({
      studentName: 'Tej',
      phone: '9876543210',
      biggestConcern: 'Course',
      callbackTime,
    });
    assert.equal(payload.agent_uuid, DEFAULT_IIT_AGENT_UUID);
    assert.equal(payload.phone, '+919876543210');
    assert.equal(payload.person_name, 'Tej');
    assert.equal(payload.callback_timestamp, callbackTime.toISOString());
    assert.deepEqual(payload.additional_data, { biggest_concern: 'Course' });
    assert.equal(payload.prev_call_summary, undefined);
  });

  it('builds strict test call payload', () => {
    const callbackTime = new Date('2026-06-15T11:30:00.000Z');
    const payload = buildOsviPayloadFromTestCall({
      personName: 'Tej',
      phone: '9876543210',
      callbackTime,
      notes: 'registered for wednesday 6PM',
    });
    assert.equal(payload.phone, '+919876543210');
    assert.deepEqual(payload.additional_data, { biggest_concern: 'registered for wednesday 6PM' });
    assert.equal(Object.keys(payload).length, 5);
  });

  it('defaults biggest_concern to test when empty', () => {
    const payload = buildOsviPayloadFromTestCall({
      personName: 'Admin',
      phone: '9876543210',
      callbackTime: new Date('2026-06-15T11:30:00.000Z'),
    });
    assert.deepEqual(payload.additional_data, { biggest_concern: 'test' });
  });
});
