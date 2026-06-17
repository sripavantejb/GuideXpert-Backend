'use strict';

const { describe, test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  integrationBefore,
  integrationBeforeEach,
  integrationAfter,
} = require('./integration/harness/setup');
const OneOnOneCounselor = require('../models/OneOnOneCounselor');
const GuidanceSlot = require('../models/GuidanceSlot');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { CURRENT_CLASS_OPTIONS } = require('../constants/oneOnOneCounseling');
const {
  cancelGuidanceBookingForLead,
  findLeadByMobile,
} = require('../services/guidanceBookingService');

const VALID_CLASS = CURRENT_CLASS_OPTIONS[0];

async function seedCounselorAndSlot({ currentBookings = 1, maxBookings = 5 } = {}) {
  const counselor = await OneOnOneCounselor.create({
    name: 'Test Counselor',
    email: `counselor-${Date.now()}@example.com`,
    isActive: true,
  });
  const slot = await GuidanceSlot.create({
    sessionTitle: 'Test Session',
    slotDate: '2030-06-15',
    slotTime: '10:00 AM TO 11:00 AM',
    maxBookings,
    currentBookings,
    isActive: true,
    oneOnOneCounselorId: counselor._id,
  });
  return { counselor, slot };
}

async function seedConfirmedLead({ slot, counselor, formCompleted = false, mobile = '9876543210' }) {
  return OneOnOneCounselingLead.create({
    studentName: 'Test Student',
    mobileNumber: mobile,
    currentClass: VALID_CLASS,
    city: 'Hyderabad',
    preferredLanguage: 'Telugu',
    collegeBudget: 'Below ₹1 Lakh',
    parentOccupation: 'Teacher',
    preferredColleges: ['IIT Hyderabad'],
    formCompleted,
    bookingConfirmed: true,
    bookingStatus: 'Confirmed',
    selectedSlotId: slot._id,
    oneOnOneCounselorId: counselor._id,
    parentAttendanceConfirmed: true,
    whatsappConsent: true,
    bookingConfirmedAt: new Date(),
    attendanceStatus: 'Confirmed',
  });
}

describe('cancelGuidanceBookingForLead', () => {
  before(integrationBefore);
  beforeEach(integrationBeforeEach);
  after(integrationAfter);

  test('decrements slot currentBookings and deletes guidance-only lead', async () => {
    const { counselor, slot } = await seedCounselorAndSlot({ currentBookings: 2, maxBookings: 5 });
    const lead = await seedConfirmedLead({ slot, counselor, formCompleted: false });

    const result = await cancelGuidanceBookingForLead(String(lead._id));
    assert.equal(result.leadDeleted, true);
    assert.equal(result.slotId, String(slot._id));
    assert.equal(result.spotsLeft, 4);

    const updatedSlot = await GuidanceSlot.findById(slot._id).lean();
    assert.equal(updatedSlot.currentBookings, 1);

    const deletedLead = await OneOnOneCounselingLead.findById(lead._id).lean();
    assert.equal(deletedLead, null);

    const byMobile = await findLeadByMobile('9876543210');
    assert.equal(byMobile, null);
  });

  test('resets booking fields when formCompleted is true', async () => {
    const { counselor, slot } = await seedCounselorAndSlot({ currentBookings: 1, maxBookings: 3 });
    const lead = await seedConfirmedLead({
      slot,
      counselor,
      formCompleted: true,
      mobile: '9123456789',
    });

    const result = await cancelGuidanceBookingForLead(String(lead._id));
    assert.equal(result.leadDeleted, false);

    const kept = await OneOnOneCounselingLead.findById(lead._id).lean();
    assert.ok(kept);
    assert.equal(kept.bookingConfirmed, false);
    assert.equal(kept.bookingStatus, 'Not Booked');
    assert.equal(kept.selectedSlotId, null);
    assert.equal(kept.oneOnOneCounselorId, null);
    assert.equal(kept.formCompleted, true);
    assert.equal(kept.studentName, 'Test Student');
  });

  test('returns 409 when booking is not confirmed', async () => {
    const { counselor, slot } = await seedCounselorAndSlot();
    const lead = await OneOnOneCounselingLead.create({
      studentName: 'Pending Student',
      mobileNumber: '9988776655',
      currentClass: VALID_CLASS,
      city: 'Hyderabad',
      preferredLanguage: 'Telugu',
      formCompleted: false,
      bookingConfirmed: false,
      bookingStatus: 'Not Booked',
    });

    const result = await cancelGuidanceBookingForLead(String(lead._id));
    assert.equal(result.status, 409);
    assert.match(result.error, /not confirmed/i);
  });

  test('cancels pending guidance reminder jobs', async () => {
    const { counselor, slot } = await seedCounselorAndSlot();
    const lead = await seedConfirmedLead({ slot, counselor, mobile: '9111222333' });
    const retryGroup = await WhatsAppRetryGroup.create({
      messageKind: 'guidance_pre30min',
      cronRunId: null,
      trigger: 'scheduled_job',
      status: 'open',
    });
    const slotAt = new Date('2030-06-15T04:30:00.000Z');
    await WhatsAppReminderJob.create({
      oneOnOneCounselingLeadId: lead._id,
      phone: lead.mobileNumber,
      messageKind: 'guidance_pre30min',
      opsProduct: 'guidance_booking',
      slotDate: slotAt,
      slotDayIst: '2030-06-15',
      scheduledSendAt: slotAt,
      firstEligibleAt: slotAt,
      retryGroupId: retryGroup._id,
      state: 'pending',
    });

    await cancelGuidanceBookingForLead(String(lead._id));

    const job = await WhatsAppReminderJob.findOne({
      oneOnOneCounselingLeadId: lead._id,
      messageKind: 'guidance_pre30min',
    }).lean();
    assert.equal(job.state, 'cancelled');
    assert.equal(job.suppressionReason, 'booking_cancelled_admin');
  });
});
