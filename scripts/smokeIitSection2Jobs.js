/**
 * Read-only smoke: recent Section-2 submissions should have expected job counts.
 *
 * Usage: node scripts/smokeIitSection2Jobs.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const IitTeluguSmsReminderJob = require('../models/IitTeluguSmsReminderJob');

const WA_KINDS = ['iit_pre2hr', 'iit_pre45min', 'iit_pre15min'];
const SMS_KINDS = 6;

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const subs = await IitCounsellingSubmission.find({
    'iitCounselling.section2Data.submittedAt': { $gte: since },
  })
    .sort({ 'iitCounselling.section2Data.submittedAt': -1 })
    .limit(20)
    .select('phone iitCounselling.section2Data.preferredLanguage counsellingSlotInstantUtc')
    .lean();

  console.log(`Recent Section-2 submissions (48h): ${subs.length}\n`);
  let ok = 0;
  let fail = 0;

  for (const s of subs) {
    const lang = s.iitCounselling?.section2Data?.preferredLanguage || '?';
    const wa = await WhatsAppReminderJob.countDocuments({
      iitCounsellingSubmissionId: s._id,
      messageKind: { $in: WA_KINDS },
    });
    const sms =
      lang === 'Telugu'
        ? await IitTeluguSmsReminderJob.countDocuments({
            iitCounsellingSubmissionId: s._id,
          })
        : 0;
    const waOk = wa === 3;
    const smsOk = lang === 'Telugu' ? sms === SMS_KINDS : sms === 0;
    const pass = waOk && smsOk;
    if (pass) ok += 1;
    else fail += 1;
    console.log(
      pass ? 'OK' : 'FAIL',
      s.phone?.slice(-4),
      lang,
      `WA jobs ${wa}/3`,
      lang === 'Telugu' ? `SMS jobs ${sms}/${SMS_KINDS}` : 'SMS n/a'
    );
  }

  console.log(`\nSummary: ${ok} pass, ${fail} fail`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
