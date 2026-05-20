/**
 * Replay quarantined / unmatched Gupshup DLR webhooks onto IIT reminder events (delivered/read).
 *
 * Usage:
 *   node scripts/replayIitWebhookDlr.js
 *   node scripts/replayIitWebhookDlr.js --since=2026-05-20
 */
require('dotenv').config();
const mongoose = require('mongoose');
const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const { replayGupshupWebhookBody } = require('../controllers/gupshupWebhookController');

async function main() {
  const sinceArg = process.argv.find((a) => a.startsWith('--since='));
  const sinceIso = sinceArg ? sinceArg.split('=')[1] : '2026-05-20';
  const since = new Date(`${sinceIso}T00:00:00.000Z`);

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const webhooks = await WhatsAppWebhookEvent.find({
    receivedAt: { $gte: since },
    $or: [
      { isQuarantined: true },
      { resolvedMessageEventId: null },
      { resolvedBy: null }
    ],
    rawPayloadSnippet: /gs_id|iit_pre|GUPSHUP_TEMPLATE_IIT_PRE/i
  })
    .sort({ receivedAt: 1 })
    .limit(5000)
    .lean();

  let replayed = 0;
  let updated = 0;
  let failed = 0;

  /* eslint-disable no-await-in-loop */
  for (const w of webhooks) {
    if (!w.rawPayloadSnippet) continue;
    let body;
    try {
      body = JSON.parse(w.rawPayloadSnippet);
    } catch {
      failed += 1;
      continue;
    }
    replayed += 1;
    const r = await replayGupshupWebhookBody(body, new Date(w.receivedAt));
    if (r.updatedEventCount > 0) updated += r.updatedEventCount;
  }
  /* eslint-enable no-await-in-loop */

  const tel45 = await WhatsAppMessageEvent.aggregate([
    {
      $match: {
        messageKind: 'iit_pre45min',
        opsProduct: 'iit_counselling',
        templateIdEnvKey: /TELUGU/i,
        cohortSlotInstantUtc: new Date('2026-05-20T12:30:00.000Z')
      }
    },
    { $group: { _id: '$status', n: { $sum: 1 } } }
  ]);

  console.log(
    JSON.stringify(
      {
        since: sinceIso,
        webhooksScanned: webhooks.length,
        replayed,
        eventsUpdated: updated,
        parseFailed: failed,
        teluguPre45Status: tel45
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
