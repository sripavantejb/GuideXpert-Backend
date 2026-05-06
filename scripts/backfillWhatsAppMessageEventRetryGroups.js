/**
 * One-off: legacy WhatsAppMessageEvent rows get attempt metadata + a matching WhatsAppRetryGroup
 * document (same _id as the message row) so retryGroupId refs resolve.
 *
 *   node scripts/backfillWhatsAppMessageEventRetryGroups.js
 *
 * Requires MONGODB_URI in .env from GuideXpert-Backend directory.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');

const BATCH = 400;

function mapTrigger(source) {
  if (source === 'cron' || source === 'retry_cron') return 'cron';
  if (source === 'save_step3') return 'save_step3';
  if (source === 'retry_api') return 'retry_api';
  return 'manual';
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing');
    process.exitCode = 1;
    return;
  }
  await mongoose.connect(uri);

  const filter = {
    $or: [{ retryGroupId: { $exists: false } }, { retryGroupId: null }]
  };

  let scanned = 0;
  let updated = 0;
  let inserted = 0;

  for (;;) {
    const batch = await WhatsAppMessageEvent.find(filter)
      .sort({ _id: 1 })
      .limit(BATCH)
      .select('_id messageKind cronRunId source createdAt status')
      .lean();
    if (!batch.length) break;

    for (const doc of batch) {
      scanned += 1;
      try {
        await WhatsAppRetryGroup.collection.insertOne({
          _id: doc._id,
          messageKind: doc.messageKind || 'slot_booked',
          cronRunId: doc.cronRunId || null,
          trigger: mapTrigger(doc.source || ''),
          status: 'open',
          createdAt: doc.createdAt || new Date(),
          updatedAt: new Date()
        });
        inserted += 1;
      } catch (e) {
        if (e && e.code === 11000) {
          /* duplicate group id — treat as already migrated */
        } else {
          console.warn('[backfill] group insert', String(doc._id), e.message || e);
          continue;
        }
      }

      const elig = doc.status === 'failed';
      const r = await WhatsAppMessageEvent.collection.updateOne(
        { _id: doc._id, $or: [{ retryGroupId: { $exists: false } }, { retryGroupId: null }] },
        {
          $set: {
            retryGroupId: doc._id,
            attemptNumber: 1,
            retrySource: 'initial',
            retryEligible: elig
          }
        }
      );
      if (r.modifiedCount) updated += 1;
    }

    if (batch.length < BATCH) break;
  }

  /* Second pass: eligibility from stored status (not selected in first pass) */
  await WhatsAppMessageEvent.collection.updateMany(
    { status: 'failed', retryGroupId: { $ne: null } },
    { $set: { retryEligible: true } }
  );

  console.log(
    '[backfillWhatsAppMessageEventRetryGroups]',
    'scanned:',
    scanned,
    'groupsInserted:',
    inserted,
    'eventsUpdated:',
    updated
  );

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
