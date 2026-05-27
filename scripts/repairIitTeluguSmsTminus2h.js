/**
 * Re-open T−2h jobs wrongly skipped as expired when Section 2 was saved after the 10m window.
 *
 * Usage:
 *   node scripts/repairIitTeluguSmsTminus2h.js              # dry-run
 *   node scripts/repairIitTeluguSmsTminus2h.js --execute  # repair + dispatch
 */
require('dotenv').config();
const mongoose = require('mongoose');
const IitTeluguSmsReminderJob = require('../models/IitTeluguSmsReminderJob');
const {
  dispatchDueJobsForIitTeluguSmsSubmission,
} = require('../services/iitTeluguSmsReminderScheduler');

async function main() {
  const execute = process.argv.includes('--execute');
  const now = new Date();

  await mongoose.connect(process.env.MONGODB_URI);

  const broken = await IitTeluguSmsReminderJob.find({
    messageKind: 'iit_sms_tminus_2h',
    state: 'skipped',
    suppressionReason: 'expired',
    slotDate: { $gt: now },
  }).lean();

  console.log(`Found ${broken.length} expired-skipped T−2h job(s) with future slot`);

  for (const job of broken) {
    console.log(
      execute ? '[repair]' : '[dry-run]',
      job.phone,
      String(job.iitCounsellingSubmissionId),
      'slot',
      job.slotDate
    );
    if (!execute) continue;

    await IitTeluguSmsReminderJob.updateOne(
      { _id: job._id },
      {
        $set: {
          state: 'pending',
          suppressionReason: null,
          sendImmediately: true,
          expiresAt: job.slotDate,
          expiredAt: null,
          completedAt: null,
          updatedAt: now,
          claimedUntil: null,
          leaseExpiresAt: null,
          claimToken: null,
          claimedAt: null,
          claimedBy: null,
        },
      }
    );

    const dispatch = await dispatchDueJobsForIitTeluguSmsSubmission(job.iitCounsellingSubmissionId, {
      now: new Date(),
      cronJobKey: 'repair_iit_telugu_sms_tminus_2h',
    });
    console.log('  dispatch', JSON.stringify(dispatch));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
