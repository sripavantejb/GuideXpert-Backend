'use strict';

require('../config/mongooseSafety');

/**
 * Migration: WhatsAppOutboundMessage bot-reply uniqueness
 * from single-field inReplyToInboundId → compound (inReplyToInboundId, partIndex).
 *
 * Default: dry-run. Pass --execute to apply.
 *
 * Steps on --execute:
 * 1. Backfill missing partIndex → 0 for bot rows
 * 2. Verify pair uniqueness (fail if duplicates)
 * 3. Create compound unique partial index (by inspected name)
 * 4. Drop old single-field unique index (by inspected key/name)
 * 5. Verify final index
 */

require('dotenv').config();
const mongoose = require('mongoose');
const WhatsAppOutboundMessage = require('../models/WhatsAppOutboundMessage');
const {
  BOT_REPLY_INBOUND_PART_INDEX_NAME,
} = require('../models/WhatsAppOutboundMessage');

const EXECUTE = process.argv.includes('--execute');

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) required');
  // autoIndex OFF: index creation must be an explicit, logged migration step,
  // never a side effect of loading a model in a script.
  await mongoose.connect(uri, { autoIndex: false });
}

function indexKeyString(key) {
  return Object.entries(key || {})
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
}

async function listBotReplyIndexes(collection) {
  const indexes = await collection.indexes();
  return indexes.filter((idx) => {
    const keys = Object.keys(idx.key || {});
    return keys.includes('inReplyToInboundId');
  });
}

async function main() {
  await connect();
  const collection = WhatsAppOutboundMessage.collection;

  console.log(JSON.stringify({ event: 'migrate_start', execute: EXECUTE }));

  const missingPartIndex = await collection.countDocuments({
    senderType: 'bot',
    inReplyToInboundId: { $type: 'objectId' },
    $or: [{ partIndex: { $exists: false } }, { partIndex: null }],
  });

  // Historical rows are NOT all unique per inbound: where no index (or only the
  // application-level guard) was enforcing it, one inbound can already own
  // several bot rows. Backfilling every row to 0 would therefore violate the new
  // compound unique index, so multi-row inbounds get sequential indexes in
  // createdAt order — which is also their true delivery order. No row is deleted.
  const multiRowInbounds = await collection
    .aggregate([
      { $match: { senderType: 'bot', inReplyToInboundId: { $type: 'objectId' } } },
      { $group: { _id: '$inReplyToInboundId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $group: { _id: null, inbounds: { $sum: 1 }, extraRows: { $sum: { $subtract: ['$count', 1] } }, maxParts: { $max: '$count' } } },
    ])
    .toArray();
  const multi = multiRowInbounds[0] || { inbounds: 0, extraRows: 0, maxParts: 1 };

  console.log(
    JSON.stringify({
      event: 'backfill_candidates',
      rowsMissingPartIndex: missingPartIndex,
      multiRowInbounds: multi.inbounds,
      extraRows: multi.extraRows,
      maxPartsOnOneInbound: multi.maxParts,
    })
  );

  if (EXECUTE && missingPartIndex > 0) {
    const cursor = collection.aggregate([
      { $match: { senderType: 'bot', inReplyToInboundId: { $type: 'objectId' } } },
      { $sort: { inReplyToInboundId: 1, createdAt: 1, _id: 1 } },
      { $group: { _id: '$inReplyToInboundId', ids: { $push: '$_id' } } },
    ]);

    let modified = 0;
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      await collection.bulkWrite(batch, { ordered: false });
      modified += batch.length;
      batch = [];
    };

    for await (const group of cursor) {
      group.ids.forEach((id, index) => {
        batch.push({ updateOne: { filter: { _id: id }, update: { $set: { partIndex: index } } } });
      });
      if (batch.length >= 500) await flush();
    }
    await flush();
    console.log(JSON.stringify({ event: 'backfill_done', modified }));
  }

  const dupes = await collection
    .aggregate([
      {
        $match: {
          senderType: 'bot',
          inReplyToInboundId: { $type: 'objectId' },
          partIndex: { $type: 'number' },
        },
      },
      {
        $group: {
          _id: { inbound: '$inReplyToInboundId', part: '$partIndex' },
          count: { $sum: 1 },
          ids: { $push: '$_id' },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 20 },
    ])
    .toArray();

  if (dupes.length) {
    console.error(JSON.stringify({ event: 'duplicate_pairs', sample: dupes }));
    throw new Error(`Cannot migrate: ${dupes.length} duplicate (inbound, partIndex) pairs`);
  }
  console.log(JSON.stringify({ event: 'uniqueness_ok' }));

  const before = await listBotReplyIndexes(collection);
  console.log(
    JSON.stringify({
      event: 'indexes_before',
      indexes: before.map((i) => ({ name: i.name, key: i.key, unique: i.unique })),
    })
  );

  const compoundSpec = {
    name: BOT_REPLY_INBOUND_PART_INDEX_NAME,
    unique: true,
    // Rolling/background build so a live collection keeps serving during creation.
    background: true,
    partialFilterExpression: {
      senderType: 'bot',
      inReplyToInboundId: { $type: 'objectId' },
      partIndex: { $type: 'number' },
    },
  };

  const hasCompound = before.some(
    (i) =>
      i.name === BOT_REPLY_INBOUND_PART_INDEX_NAME ||
      indexKeyString(i.key) === 'inReplyToInboundId:1,partIndex:1'
  );

  // ORDER IS LOAD-BEARING: create + verify the compound index BEFORE dropping the
  // old one. Dropping first opens a window with no duplicate protection at all.
  if (EXECUTE && !hasCompound) {
    await collection.createIndex({ inReplyToInboundId: 1, partIndex: 1 }, compoundSpec);
    console.log(JSON.stringify({ event: 'compound_index_created', name: BOT_REPLY_INBOUND_PART_INDEX_NAME }));
  } else {
    console.log(JSON.stringify({ event: 'compound_index_skip', hasCompound, execute: EXECUTE }));
  }

  const afterCreate = await listBotReplyIndexes(collection);
  const compoundLive = afterCreate.find(
    (i) =>
      (i.name === BOT_REPLY_INBOUND_PART_INDEX_NAME ||
        indexKeyString(i.key) === 'inReplyToInboundId:1,partIndex:1') &&
      i.unique === true
  );

  if (EXECUTE && !compoundLive) {
    throw new Error('Refusing to drop old index: compound unique index is not live yet');
  }

  const oldSingle = afterCreate.find(
    (i) =>
      Object.keys(i.key || {}).length === 1 &&
      i.key.inReplyToInboundId === 1 &&
      i.unique === true
  );

  if (EXECUTE && oldSingle) {
    await collection.dropIndex(oldSingle.name);
    console.log(JSON.stringify({ event: 'old_index_dropped', name: oldSingle.name }));
  } else {
    console.log(
      JSON.stringify({
        event: 'old_index_skip',
        found: oldSingle ? oldSingle.name : null,
        execute: EXECUTE,
        note: oldSingle
          ? 'old single-field unique index present — it alone still enforces one-bot-reply-per-inbound'
          : 'no old single-field unique index found',
      })
    );
  }

  const finalIndexes = await listBotReplyIndexes(collection);
  const compoundOk = finalIndexes.some(
    (i) =>
      (i.name === BOT_REPLY_INBOUND_PART_INDEX_NAME ||
        indexKeyString(i.key) === 'inReplyToInboundId:1,partIndex:1') &&
      i.unique === true
  );
  const oldGone = !finalIndexes.some(
    (i) => Object.keys(i.key || {}).length === 1 && i.key.inReplyToInboundId === 1 && i.unique
  );

  console.log(
    JSON.stringify({
      event: 'migrate_done',
      execute: EXECUTE,
      compoundOk,
      oldGone: EXECUTE ? oldGone : 'n/a_dry_run',
      indexes: finalIndexes.map((i) => ({ name: i.name, key: i.key, unique: i.unique })),
    })
  );

  if (EXECUTE && !compoundOk) {
    throw new Error('Compound unique index missing after migration');
  }

  // HARD PRECONDITION: if the old single-field unique index survives it still
  // enforces one-bot-reply-per-inbound and the compound index changes nothing.
  if (EXECUTE && !oldGone) {
    const survivor = finalIndexes.find(
      (i) => Object.keys(i.key || {}).length === 1 && i.key.inReplyToInboundId === 1 && i.unique
    );
    throw new Error(
      `Old single-field unique index "${survivor && survivor.name}" survived — multipart replies are STILL blocked. Drop it before canary.`
    );
  }

  const remainingCandidates = await collection.countDocuments({
    senderType: 'bot',
    inReplyToInboundId: { $type: 'objectId' },
    $or: [{ partIndex: { $exists: false } }, { partIndex: null }],
  });
  console.log(
    JSON.stringify({
      event: 'post_verify',
      execute: EXECUTE,
      rowsStillMissingPartIndex: remainingCandidates,
      note: 'rows without a numeric partIndex fall outside the compound partial filter',
    })
  );
  if (EXECUTE && remainingCandidates > 0) {
    throw new Error(
      `${remainingCandidates} bot rows still lack a numeric partIndex — they are not covered by the compound index`
    );
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
