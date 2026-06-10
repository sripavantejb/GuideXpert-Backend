const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_IIT_AGENT_UUID,
  buildOsviPayloadFromReminder,
  buildOsviPayloadFromTestCall,
  formatPhoneForOsvi,
  getAgentUuid,
} = require('../utils/aiCallReminderPayload');
const { mapSubmissionToFormSnapshot } = require('../utils/aiCallReminderFieldMapper');

describe('aiCallReminderPayload', () => {
  const origIit = process.env.OSVI_IIT_AGENT_UUID;

  before(() => {
    delete process.env.OSVI_IIT_AGENT_UUID;
  });

  after(() => {
    if (origIit === undefined) delete process.env.OSVI_IIT_AGENT_UUID;
    else process.env.OSVI_IIT_AGENT_UUID = origIit;
  });

  it('ignores OSVI_AGENT_UUID for IIT callbacks', () => {
    process.env.OSVI_AGENT_UUID = 'agent_WRONG_should_not_use';
    assert.equal(getAgentUuid(), DEFAULT_IIT_AGENT_UUID);
  });

  it('formats phone with +91 prefix', () => {
    assert.equal(formatPhoneForOsvi('9876543210'), '+919876543210');
  });

  it('includes all form fields in reminder additional_data', () => {
    const callbackTime = new Date('2026-06-15T11:30:00.000Z');
    const slotInstant = new Date('2026-06-15T12:30:00.000Z');
    const payload = buildOsviPayloadFromReminder({
      studentName: 'Tej',
      phone: '9876543210',
      class: 'Studying 12th/Intermediate 2nd Year',
      city: 'Hyderabad',
      biggestConcern: 'Course',
      careerGoal: 'Career Counseling with IITian',
      selectedSlot: 'Wednesday 6PM, 2026-06-15',
      selectedSlotInstantUtc: slotInstant,
      callbackTime,
      slotDayIst: '2026-06-15',
      formSnapshot: {
        stream: 'MPC',
        student_or_parent: 'Student',
        preferred_language: 'Telugu',
        top5_colleges: ['IIT Hyderabad', 'NIT Warangal'],
        top5_colleges_text: 'IIT Hyderabad, NIT Warangal',
        help_needed: 'Career Counseling with IITian',
        wants_one_to_one_session: 'Yes',
        expected_budget: '3-6L',
      },
    });

    assert.equal(payload.agent_uuid, DEFAULT_IIT_AGENT_UUID);
    assert.equal(payload.phone, '+919876543210');
    assert.ok(payload.prev_call_summary);
    assert.equal(payload.additional_data.source, 'iitian_career_counselling');
    assert.equal(payload.additional_data.student_name, 'Tej');
    assert.equal(payload.additional_data.stream, 'MPC');
    assert.equal(payload.additional_data.preferred_language, 'Telugu');
    assert.equal(payload.additional_data.top5_colleges_text, 'IIT Hyderabad, NIT Warangal');
    assert.equal(payload.additional_data.biggest_concern, 'Course');
    assert.equal(payload.additional_data.reminder_at, callbackTime.toISOString());
  });

  it('mapSubmissionToFormSnapshot captures all sections', () => {
    const snap = mapSubmissionToFormSnapshot({
      fullName: 'Tej',
      phone: '9876543210',
      occupation: 'Student',
      currentStep: 3,
      isCompleted: true,
      applicationStatus: 'completed',
      counsellingSlotInstantUtc: new Date('2026-06-15T12:30:00.000Z'),
      iitCounselling: {
        section1Data: {
          fullName: 'Tej',
          mobileNumber: '9876543210',
          studentOrParent: 'Student',
          classStatus: 'Studying 12th/Intermediate 2nd Year',
          stream: 'MPC',
          city: 'Hyderabad',
          slotBooking: 'Wednesday 6PM',
          slotBookingDate: '2026-06-15',
          top5Colleges: ['IIT H'],
        },
        section2Data: {
          careerDecisionClarity: 'Somewhat clear',
          collegeDecisionStakeholder: 'Both',
          expectedBudget: '3-6L',
          topCollegePriority: 'Placements',
          preferredLanguage: 'Telugu',
        },
        section3Data: {
          helpNeeded: 'Career Counseling with IITian',
          wantsOneToOneSession: 'Yes',
          biggestConfusion: 'Course',
        },
      },
    });
    assert.equal(snap.stream, 'MPC');
    assert.equal(snap.preferred_language, 'Telugu');
    assert.equal(snap.biggest_concern, 'Course');
    assert.equal(snap.form_completed, true);
  });

  it('builds test call additional_data matching real reminder queue fields', () => {
    const payload = buildOsviPayloadFromTestCall({
      personName: 'Tej',
      phone: '9876543210',
      callbackTime: new Date('2026-06-15T11:30:00.000Z'),
      notes: 'registered for wednesday 6PM',
      selectedSlot: 'Wednesday 6PM, 2026-06-15',
      class: 'Studying 12th/Intermediate 2nd Year',
      city: 'Hyderabad',
      stream: 'MPC',
      preferredLanguage: 'Telugu',
      top5CollegesText: 'IIT Hyderabad, NIT Warangal',
    });
    assert.equal(payload.additional_data.type, 'test_call');
    assert.equal(payload.additional_data.source, 'iitian_career_counselling');
    assert.equal(payload.additional_data.student_name, 'Tej');
    assert.equal(payload.additional_data.biggest_concern, 'registered for wednesday 6PM');
    assert.equal(payload.additional_data.selected_slot, 'Wednesday 6PM, 2026-06-15');
    assert.equal(payload.additional_data.stream, 'MPC');
    assert.equal(payload.additional_data.preferred_language, 'Telugu');
    assert.equal(payload.additional_data.top5_colleges_text, 'IIT Hyderabad, NIT Warangal');
    assert.ok(payload.prev_call_summary.includes('Tej'));
    assert.ok(payload.prev_call_summary.includes('Wednesday 6PM'));
  });

  it('fills default sample fields when test call omits optional inputs', () => {
    const payload = buildOsviPayloadFromTestCall({
      personName: 'Ravi Kumar',
      phone: '9876543210',
      callbackTime: new Date('2026-06-15T11:30:00.000Z'),
    });
    assert.equal(payload.additional_data.class, 'Studying 12th/Intermediate 2nd Year');
    assert.equal(payload.additional_data.city, 'Hyderabad');
    assert.equal(payload.additional_data.stream, 'MPC');
    assert.ok(payload.additional_data.selected_slot);
    assert.equal(payload.additional_data.preferred_language, 'Telugu');
    assert.ok(payload.additional_data.top5_colleges_text);
  });
});
