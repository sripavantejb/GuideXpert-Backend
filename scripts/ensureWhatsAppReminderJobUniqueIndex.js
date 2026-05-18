/**
 * One-time: dedupe WhatsAppReminderJob rows and ensure unique (formSubmissionId, messageKind) index.
 *
 *   node scripts/ensureWhatsAppReminderJobUniqueIndex.js           # dry-run
 *   node scripts/ensureWhatsAppReminderJobUniqueIndex.js --execute
 */
require('dotenv').config();
const mongoose = require('mongoose');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');

async function main() {
  const execute = process.argv.includes('--execute');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required');

  await mongoose.connect(uri);
  const dupes = await WhatsAppReminderJob.aggregate([
    { $group: { _id: { formSubmissionId: '$formSubmissionId', messageKind: '$messageKind' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);

  let removed = 0;
  for (const d of dupes) {
    const sorted = d.ids;
    const keep = sorted[sorted.length - 1];
    const drop = sorted.slice(0, -1);
    if (!execute) {
      console.log('would remove', drop.length, 'dupes for', d._id);
      removed += drop.length;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const res = await WhatsAppReminderJob.deleteMany({ _id: { $in: drop } });
    removed += res.deletedCount || 0;
    console.log('kept', keep, 'removed', res.deletedCount);
  }

  if (execute) {
    await WhatsAppReminderJob.collection.createIndex(
      { formSubmissionId: 1, messageKind: 1 },
      { unique: true, background: true }
    );
  }

  console.log(JSON.stringify({ mode: execute ? 'EXECUTE' : 'DRY-RUN', duplicateGroups: dupes.length, removed }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
