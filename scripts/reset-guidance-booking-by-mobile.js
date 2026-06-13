#!/usr/bin/env node
/**
 * Remove or reset a guidance / 1-on-1 session booking by mobile number.
 *
 * Usage:
 *   node scripts/reset-guidance-booking-by-mobile.js 9347763131
 *   node scripts/reset-guidance-booking-by-mobile.js --mobile=9347763131
 *   node scripts/reset-guidance-booking-by-mobile.js --mobile=9347763131 --reset-only
 *
 * Default: deletes the OneOnOneCounselingLead and frees the booked slot count.
 * --reset-only: keeps the lead but clears booking fields (for partial retest).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const GuidanceSlot = require('../models/GuidanceSlot');

function parseMobile(argv) {
  const flag = argv.find((a) => a.startsWith('--mobile='));
  if (flag) {
    return flag.split('=')[1].replace(/\D/g, '').slice(-10);
  }
  const positional = argv.find((a) => /^\d{10}$/.test(a.replace(/\D/g, '').slice(-10)));
  if (positional) {
    return positional.replace(/\D/g, '').slice(-10);
  }
  return null;
}

function parseResetOnly(argv) {
  return argv.includes('--reset-only');
}

async function freeBookedSlot(lead) {
  if (!lead.selectedSlotId) return null;

  const slot = await GuidanceSlot.findByIdAndUpdate(
    lead.selectedSlotId,
    { $inc: { currentBookings: -1 } },
    { new: true }
  );

  if (slot && slot.currentBookings < 0) {
    slot.currentBookings = 0;
    await slot.save();
  }

  return slot;
}

async function resetBookingFields(lead) {
  lead.bookingConfirmed = false;
  lead.bookingStatus = 'Not Booked';
  lead.selectedSlotId = null;
  lead.oneOnOneCounselorId = null;
  lead.parentAttendanceConfirmed = false;
  lead.whatsappConsent = false;
  lead.bookingConfirmedAt = null;
  lead.attendanceStatus = '';
  await lead.save();
}

async function main() {
  const mobile = parseMobile(process.argv.slice(2));
  const resetOnly = parseResetOnly(process.argv.slice(2));

  if (!mobile || mobile.length !== 10) {
    console.error('Usage: node scripts/reset-guidance-booking-by-mobile.js <10-digit-mobile>');
    console.error('   or: node scripts/reset-guidance-booking-by-mobile.js --mobile=XXXXXXXXXX [--reset-only]');
    process.exit(1);
  }

  await connectDB();

  const lead = await OneOnOneCounselingLead.findOne({ mobileNumber: mobile });
  if (!lead) {
    console.log(`No 1-on-1 / guidance lead found for ${mobile}. Nothing to do.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('Found lead:', {
    id: String(lead._id),
    studentName: lead.studentName,
    bookingConfirmed: lead.bookingConfirmed,
    bookingStatus: lead.bookingStatus,
    selectedSlotId: lead.selectedSlotId ? String(lead.selectedSlotId) : null,
  });

  const slot = await freeBookedSlot(lead);
  if (slot) {
    console.log('Freed slot:', {
      id: String(slot._id),
      sessionTitle: slot.sessionTitle,
      currentBookings: slot.currentBookings,
      maxBookings: slot.maxBookings,
    });
  }

  if (resetOnly) {
    await resetBookingFields(lead);
    console.log(`Reset booking fields for ${mobile}. Lead record kept.`);
  } else {
    await OneOnOneCounselingLead.deleteOne({ _id: lead._id });
    console.log(`Deleted lead for ${mobile}. You can book again from scratch.`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
