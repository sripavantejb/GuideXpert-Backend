#!/usr/bin/env node
/**
 * Smoke-test guidance booking WhatsApp after Gupshup env is configured.
 * Usage: node scripts/test-guidance-booking-whatsapp-local.js [--reset-mobile=XXXXXXXXXX]
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const gupshupLocal = path.join(__dirname, '../.env.gupshup.local');
if (fs.existsSync(gupshupLocal)) {
  require('dotenv').config({ path: gupshupLocal, override: true });
}

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const GuidanceSlot = require('../models/GuidanceSlot');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const { isGupshupConfigured } = require('../services/gupshupService');
const { bookSlotForLead } = require('../services/guidanceBookingService');
const {
  buildGuidanceBookingSubmitVars,
  parseGuidanceSlotInstantUtc,
  GUPSHUP_TEMPLATE_GUIDANCE_BOOKING_CONFIRM,
} = require('../utils/guidanceBookingWhatsApp');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { safeSendWhatsApp } = require('../utils/safeSendWhatsApp');
const { sendGuidanceBookingSubmitWhatsApp } = require('../services/gupshupService');

function parseResetMobile() {
  const arg = process.argv.find((a) => a.startsWith('--reset-mobile='));
  return arg ? arg.split('=')[1].replace(/\D/g, '').slice(-10) : null;
}

async function main() {
  if (!isGupshupConfigured()) {
    console.error('FAIL: Gupshup not configured. Add GUPSHUP_API_KEY and GUPSHUP_SOURCE to .env.gupshup.local');
    process.exit(1);
  }
  console.log('gupshupConfigured:', true, 'WA_INTEGRATION_STUB:', process.env.WA_INTEGRATION_STUB || '0');

  await connectDB();

  const resetMobile = parseResetMobile();
  let lead;
  if (resetMobile) {
    lead = await OneOnOneCounselingLead.findOne({ mobileNumber: resetMobile });
    if (!lead) {
      console.error(`No lead for mobile ${resetMobile}`);
      process.exit(1);
    }
    lead.bookingConfirmed = false;
    lead.bookingStatus = 'Not Booked';
    lead.selectedSlotId = null;
    lead.bookingConfirmedAt = null;
    await lead.save();
    console.log('Reset booking for', resetMobile);
  } else {
    lead = await OneOnOneCounselingLead.findOne({ bookingConfirmed: { $ne: true } })
      .sort({ updatedAt: -1 })
      .exec();
  }

  if (!lead) {
    console.error('No unbooked lead found. Pass --reset-mobile=XXXXXXXXXX for a known lead.');
    process.exit(1);
  }

  const slot = await GuidanceSlot.findOne({ isActive: true, $expr: { $lt: ['$currentBookings', '$maxBookings'] } })
    .sort({ slotDate: 1 })
    .lean();
  if (!slot) {
    console.error('No available active guidance slot');
    process.exit(1);
  }

  const mobile = lead.mobileNumber;
  const result = await bookSlotForLead({
    mobileNumber: mobile,
    slotId: String(slot._id),
    parentAttendanceConfirmed: true,
    whatsappConsent: true,
    collegeBudget: lead.collegeBudget || 'Below 5 Lakhs',
    parentOccupation: lead.parentOccupation || 'Business',
    preferredColleges: lead.preferredColleges?.length
      ? lead.preferredColleges
      : ['Test College'],
  });

  if (result.error) {
    console.error('bookSlotForLead failed:', result.error);
    process.exit(1);
  }

  const bookingGroup = await WhatsAppRetryGroup.create({
    messageKind: 'guidance_booking_submit',
    trigger: 'guidance_booking_submit',
    status: 'open',
  });

  const waResult = await safeSendWhatsApp({
    phone10: mobile,
    formSubmissionId: null,
    vars: buildGuidanceBookingSubmitVars(result.slot),
    retryKind: 'guidance_booking_submit',
    source: 'guidance_booking_submit',
    cronRunId: null,
    cronJobKey: null,
    sendFn: sendGuidanceBookingSubmitWhatsApp,
    retryGroupId: bookingGroup._id,
    attemptNumber: 1,
    opsProduct: 'guidance_booking',
    cohortSlotInstantUtc: parseGuidanceSlotInstantUtc(result.slot),
    oneOnOneCounselingLeadId: result.lead._id,
    explicitTemplateEnvKey: GUPSHUP_TEMPLATE_GUIDANCE_BOOKING_CONFIRM,
  });

  const events = await WhatsAppMessageEvent.find({
    messageKind: 'guidance_booking_submit',
    phone: mobile,
  })
    .sort({ createdAt: -1 })
    .limit(3)
    .lean();

  console.log('whatsappSend:', waResult);
  console.log('auditEvents:', events.length, events.map((e) => ({ status: e.status, attempt: e.attemptNumber })));

  if (!waResult?.success || events.length === 0) {
    process.exit(1);
  }
  console.log('OK — guidance_booking_submit recorded for', mobile);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
