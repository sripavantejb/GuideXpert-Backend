/**
 * Sanity-check WhatsApp ops day cohort: FormSubmission count vs computeRecipientDayOverview.bookedSlotsCount.
 * Usage: node scripts/verify-wa-ops-cohort.js [YYYY-MM-DD] [slotTime e.g. 6PM|all]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const FormSubmission = require('../models/FormSubmission');
const {
  computeRecipientDayOverview,
  normalizeSlotTimeParam,
  istDayRangeFromIso
} = require('../services/whatsappOpsRecipientAnalytics');

function cohortFilter(range, slotTimeNorm) {
  const q = {
    isRegistered: true,
    'step3Data.slotDate': { $gte: range.from, $lte: range.to }
  };
  if (slotTimeNorm && slotTimeNorm !== 'all') {
    q['step3Data.selectedSlot'] = new RegExp(`_${slotTimeNorm}$`);
  }
  return q;
}

(async () => {
  const dateIso = process.argv[2] || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const slotRaw = process.argv[3] != null ? process.argv[3] : 'all';
  const slotTimeNorm = normalizeSlotTimeParam(slotRaw);
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  if (slotTimeNorm === null) {
    console.error('Invalid slotTime');
    process.exit(1);
  }
  const range = istDayRangeFromIso(dateIso);
  if (!range) {
    console.error('Invalid date');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const direct = await FormSubmission.countDocuments(cohortFilter(range, slotTimeNorm));
  const overview = await computeRecipientDayOverview({ dateIso, messageKind: null, slotTime: slotTimeNorm });
  if (overview.error) {
    console.error(overview.error);
    process.exit(1);
  }
  const apiBooked = overview.data.bookedSlotsCount;
  console.log(
    JSON.stringify(
      {
        dateIso,
        slotTime: slotTimeNorm,
        formSubmissionCount: direct,
        apiBookedSlotsCount: apiBooked,
        match: direct === apiBooked
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
  if (direct !== apiBooked) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
