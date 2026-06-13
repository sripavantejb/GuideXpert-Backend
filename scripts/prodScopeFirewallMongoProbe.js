'use strict';
/** One-off production audit helper — inspect recent inbound/outbound in MongoDB */
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const inboundCol = db.collection('whatsappinboundmessages');
  const outboundCol = db.collection('whatsappoutboundmessages');

  const recent = await inboundCol
    .find({ text: /Python code for sorting|Generate an image|JoSAA|hostel fees/i })
    .sort({ createdAt: -1 })
    .limit(15)
    .project({ text: 1, phone: 1, createdAt: 1, processStatus: 1, conversationId: 1 })
    .toArray();

  console.log('Recent matching inbounds:', recent.length);
  for (const row of recent) {
    const out = await outboundCol
      .find({ conversationId: row.conversationId })
      .sort({ createdAt: -1 })
      .limit(1)
      .project({ text: 1, createdAt: 1, status: 1 })
      .toArray();
    const reply = out[0]?.text || '(no outbound)';
    const isRefusal = /GuideXpert.*counselling assistant|cannot assist with programming/i.test(reply);
    console.log('---');
    console.log('inbound:', row.text?.slice(0, 80));
    console.log('phone tail:', String(row.phone || '').slice(-4));
    console.log('at:', row.createdAt);
    console.log('processStatus:', row.processStatus);
    console.log('refusal-like reply:', isRefusal);
    console.log('reply preview:', String(reply).slice(0, 160).replace(/\n/g, ' '));
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
