/**
 * Upsert a FormSubmission so /meet demo-eligibility sees a booked slot.
 *
 * Usage (from GuideXpert-Backend):
 *   node scripts/seedDemoSlotForPhone.js [phone] [YYYY-MM-DD]
 *
 * Default date: today (Asia/Kolkata). Slot time: 18:00 IST.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const FormSubmission = require('../models/FormSubmission');

const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function slotDateAt6pmIST(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${ymd}`);
  return new Date(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T18:00:00+05:30`);
}

function todayYmdIST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const mo = parts.find((p) => p.type === 'month').value;
  const da = parts.find((p) => p.type === 'day').value;
  return `${y}-${mo}-${da}`;
}

function weekday6pmSlotId(ymd) {
  const date = slotDateAt6pmIST(ymd);
  const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const idx = map[dow];
  if (idx === undefined) throw new Error(`Unknown weekday: ${dow}`);
  return `${DAY_NAMES[idx]}_6PM`;
}

async function main() {
  const phoneArg = process.argv[2] || '9347763131';
  const ymd = process.argv[3] || todayYmdIST();
  const phone = String(phoneArg).replace(/\D/g, '').slice(-10);
  if (phone.length !== 10) {
    console.error('Phone must be 10 digits.');
    process.exit(1);
  }

  const slotDate = slotDateAt6pmIST(ymd);
  if (Number.isNaN(slotDate.getTime())) {
    console.error('Invalid slot date');
    process.exit(1);
  }

  const selectedSlot = weekday6pmSlotId(ymd);
  const now = new Date();

  await connectDB();

  const displayName = 'Seeded Demo User';
  const payload = {
    fullName: displayName,
    phone,
    occupation: 'Demo (seeded)',
    demoInterest: 'YES_SOON',
    selectedSlot,
    step1Data: {
      fullName: displayName,
      whatsappNumber: phone,
      occupation: 'Demo (seeded)',
      step1CompletedAt: now
    },
    step2Data: {
      otpVerified: true,
      step2CompletedAt: now
    },
    step3Data: {
      selectedSlot,
      slotDate,
      step3CompletedAt: now
    },
    currentStep: 3,
    applicationStatus: 'registered',
    isRegistered: true,
    registeredAt: now
  };

  const doc = await FormSubmission.findOneAndUpdate({ phone }, { $set: payload }, { upsert: true, new: true, runValidators: true });

  console.log('OK — FormSubmission upserted for phone ending', phone.slice(-4));
  console.log('  slotDate (ISO):', doc.step3Data.slotDate.toISOString());
  console.log('  selectedSlot:', doc.step3Data.selectedSlot);
  console.log('  isRegistered:', doc.isRegistered, 'currentStep:', doc.currentStep);

  await mongoose.connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
