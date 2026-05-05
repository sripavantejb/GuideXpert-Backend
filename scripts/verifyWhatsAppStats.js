require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const to = new Date();
  const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
  const match = { createdAt: { $gte: from, $lte: to } };

  const [total, byKind, byStatus] = await Promise.all([
    WhatsAppMessageEvent.countDocuments(match),
    WhatsAppMessageEvent.aggregate([
      { $match: match },
      { $group: { _id: '$messageKind', c: { $sum: 1 } } },
      { $sort: { c: -1 } }
    ]),
    WhatsAppMessageEvent.aggregate([
      { $match: match },
      { $group: { _id: '$status', c: { $sum: 1 } } },
      { $sort: { c: -1 } }
    ])
  ]);

  console.log(
    JSON.stringify(
      {
        range: { from: from.toISOString(), to: to.toISOString() },
        total,
        byKind,
        byStatus
      },
      null,
      2
    )
  );
}

run()
  .catch((err) => {
    console.error('[verifyWhatsAppStats] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {
      // noop
    }
  });
