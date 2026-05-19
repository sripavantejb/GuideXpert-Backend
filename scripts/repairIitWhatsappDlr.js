/**
 * Replay quarantined Gupshup webhooks and repair IIT slot_booked message events missing DLR.
 *
 * Usage:
 *   node scripts/repairIitWhatsappDlr.js --from=2024-05-20 --to=2024-05-20
 *   node scripts/repairIitWhatsappDlr.js --from=2024-05-20 --execute
 *   node scripts/repairIitWhatsappDlr.js --from=2026-05-19 --execute --skip-bulk-webhooks
 *   node scripts/repairIitWhatsappDlr.js --from=2026-05-13 --to=2026-05-19 --execute --skip-bulk-webhooks
 */
require('dotenv').config();
const mongoose = require('mongoose');
const WhatsAppWebhookEvent = require('../models/WhatsAppWebhookEvent');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const {
  replayGupshupWebhookBody,
  applyWebhookToMessageEvent,
  extractWebhookFields,
  tryParseMessageEventBody,
  mergeExplicitAndExtracted,
  inferredStatusFromDeliveryHint
} = require('../controllers/gupshupWebhookController');
const { istDayRangeFromIso } = require('../services/whatsappOpsCohortShared');

function parseArgs() {
  const argv = process.argv.slice(2);
  const execute = argv.includes('--execute');
  const skipBulkWebhooks = argv.includes('--skip-bulk-webhooks');
  const bulkWebhooksOnly = argv.includes('--bulk-webhooks-only');
  let from = null;
  let to = null;
  let opsProduct = 'iit_counselling';
  let batchSize = 200;
  for (const a of argv) {
    const fm = /^--from=(.+)$/.exec(a);
    const tm = /^--to=(.+)$/.exec(a);
    const om = /^--ops-product=(.+)$/.exec(a);
    const bm = /^--batch-size=(\d+)$/.exec(a);
    if (fm) from = fm[1].trim();
    if (tm) to = tm[1].trim();
    if (om) opsProduct = om[1].trim().replace(/-/g, '_');
    if (bm) batchSize = Math.min(Math.max(parseInt(bm[1], 10) || 200, 1), 1000);
  }
  if (!from) {
    console.error('Required: --from=YYYY-MM-DD [--to=YYYY-MM-DD]');
    process.exit(1);
  }
  if (!to) to = from;
  return { execute, from, to, opsProduct, batchSize, skipBulkWebhooks, bulkWebhooksOnly };
}

function logProgress(msg) {
  console.error(`[repairIitWhatsappDlr] ${msg}`);
}

/** Inclusive IST calendar-day range (matches WhatsApp ops Overview cohort). */
function parseIstDateRange(fromIso, toIso) {
  const start = istDayRangeFromIso(fromIso);
  const end = istDayRangeFromIso(toIso);
  if (!start || !end) return null;
  if (start.isoDate > end.isoDate) return null;
  return { from: start.from, to: end.to, isoFrom: start.isoDate, isoTo: end.isoDate };
}

function parseWebhookBody(snippet) {
  if (!snippet) return null;
  try {
    return JSON.parse(snippet);
  } catch {
    return null;
  }
}

/**
 * For each undelivered IIT event, replay quarantined webhooks on the same phone (Meta DLR ids often differ from send id).
 */
async function repairIitEventsByPhone({ execute, opsProduct, range, stats }) {
  const events = await WhatsAppMessageEvent.find({
    opsProduct,
    messageKind: 'slot_booked',
    deliveredAt: null,
    readAt: null,
    status: { $in: ['failed', 'queued', 'submitted', 'sent', 'awaiting_final_dlr', 'retry_exhausted'] },
    createdAt: { $gte: range.from, $lte: range.to }
  })
    .select('_id phone status createdAt')
    .sort({ createdAt: 1 })
    .limit(5000)
    .lean();

  stats.iitEventsTargeted = events.length;
  stats.iitEventsRepaired = 0;
  stats.iitEventReplayAttempts = 0;

  logProgress(`IIT-by-phone: ${events.length} undelivered event(s) to process`);

  let evIdx = 0;
  for (const ev of events) {
    evIdx += 1;
    if (evIdx === 1 || evIdx % 25 === 0 || evIdx === events.length) {
      logProgress(`IIT-by-phone progress ${evIdx}/${events.length} (repaired so far: ${stats.iitEventsRepaired})`);
    }
    const windowStart = new Date(new Date(ev.createdAt).getTime() - 2 * 60 * 60 * 1000);
    const windowEnd = new Date(
      Math.min(range.to.getTime(), new Date(ev.createdAt).getTime() + 72 * 60 * 60 * 1000)
    );
    const phoneInPayload = new RegExp(
      String(ev.phone || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    const webhooks = await WhatsAppWebhookEvent.find({
      isQuarantined: true,
      receivedAt: { $gte: windowStart, $lte: windowEnd },
      $or: [{ phone: ev.phone }, { rawPayloadSnippet: phoneInPayload }]
    })
      .sort({ receivedAt: -1 })
      .limit(40)
      .lean();

    const webhookStatusRank = (merged) => {
      const s =
        merged?.dbStatusFromStage ||
        inferredStatusFromDeliveryHint(merged?.deliveryHint) ||
        merged?.stage;
      const v = String(s || '').toLowerCase();
      if (v === 'read') return 4;
      if (v === 'delivered') return 3;
      if (v === 'sent' || v === 'enqueued' || v === 'submitted') return 2;
      return 1;
    };

    webhooks.sort((a, b) => {
      const ba = parseWebhookBody(a.rawPayloadSnippet);
      const bb = parseWebhookBody(b.rawPayloadSnippet);
      const ma = ba && mergeExplicitAndExtracted(tryParseMessageEventBody(ba), extractWebhookFields(ba));
      const mb = bb && mergeExplicitAndExtracted(tryParseMessageEventBody(bb), extractWebhookFields(bb));
      return webhookStatusRank(mb) - webhookStatusRank(ma);
    });

    for (const wh of webhooks) {
      stats.iitEventReplayAttempts += 1;
      const body = parseWebhookBody(wh.rawPayloadSnippet);
      if (!body) continue;

      const explicit = tryParseMessageEventBody(body);
      const extracted = extractWebhookFields(body);
      const merged = mergeExplicitAndExtracted(explicit, extracted);
      const newStatus =
        merged.dbStatusFromStage || inferredStatusFromDeliveryHint(merged.deliveryHint);
      if (!newStatus || !['sent', 'delivered', 'read', 'submitted'].includes(newStatus)) {
        continue;
      }

      if (!execute) {
        const { canApplyWebhookStatus } = require('../utils/gupshupWebhookMonotonic');
        const freshDry = await WhatsAppMessageEvent.findById(ev._id)
          .select('status reconcileDerivedFailure terminalFailureKind retryExclusionReason')
          .lean();
        if (
          freshDry &&
          canApplyWebhookStatus(freshDry.status, newStatus, {
            reconcileDerivedFailure: freshDry.reconcileDerivedFailure === true,
            terminalFailureKind: freshDry.terminalFailureKind,
            retryExclusionReason: freshDry.retryExclusionReason,
            allowTerminalRecovery: true
          })
        ) {
          stats.iitEventsRepaired += 1;
          break;
        }
        continue;
      }

      const fresh = await WhatsAppMessageEvent.findById(ev._id).lean();
      if (!fresh) continue;

      const receivedAt = wh.receivedAt || new Date();
      const transitionTs = receivedAt;
      const applyResult = await applyWebhookToMessageEvent(fresh, newStatus, {
        receivedAt,
        transitionTs,
        failureCode: merged.failureCode,
        failureReason: merged.failureReason,
        gsId: merged.gsId,
        outerId: merged.payloadId,
        whatsappMessageFromInner: merged.whatsappMessageFromInner,
        stage: merged.stage,
        allowTerminalRecovery: true
      });

      if (applyResult.modified) {
        stats.iitEventsRepaired += 1;
        await WhatsAppWebhookEvent.updateOne(
          { _id: wh._id },
          {
            $set: {
              isQuarantined: false,
              quarantineReason: null,
              quarantineCandidateEventIds: [],
              resolvedMessageEventId: ev._id,
              resolvedBy: 'repair_script:iit_direct'
            }
          }
        );
        break;
      }
    }
  }
}

async function promoteFailedWithoutIds({ execute, opsProduct, range, stats }) {
  const match = {
    opsProduct,
    messageKind: 'slot_booked',
    status: { $in: ['failed', 'queued'] },
    deliveredAt: null,
    readAt: null,
    gupshupMessageId: null,
    gupshupInternalMessageId: null,
    whatsappWaMessageId: null,
    createdAt: { $gte: range.from, $lte: range.to }
  };
  const rows = await WhatsAppMessageEvent.find(match)
    .select('_id phone status createdAt')
    .sort({ createdAt: 1 })
    .limit(5000)
    .lean();
  stats.failedWithoutIds = rows.length;
  for (const row of rows) {
    if (!execute) {
      stats.promoteDryRun += 1;
      continue;
    }
    const res = await WhatsAppMessageEvent.updateOne(
      { _id: row._id, status: { $in: ['failed', 'queued'] } },
      {
        $set: {
          status: 'submitted',
          providerAcceptedAt: row.createdAt || new Date(),
          errorMessage: 'repair_promoted_ambiguous_send',
          retryEligible: false,
          updatedAt: new Date()
        }
      }
    );
    if (res.modifiedCount) stats.promoted += 1;
  }
}

async function replayBulkQuarantinedWebhooks({ execute, range, batchSize, stats }) {
  logProgress(
    execute
      ? 'Bulk quarantined webhook replay starting (slow; use --skip-bulk-webhooks for IIT-only)'
      : 'Bulk quarantined webhook dry-run starting'
  );
  let lastId = null;
  /* eslint-disable no-constant-condition */
  while (true) {
    const q = {
      receivedAt: { $gte: range.from, $lte: range.to },
      isQuarantined: true,
      quarantineReason: { $in: ['provider_id_no_exact_match', 'missing_provider_id'] }
    };
    if (lastId) q._id = { $gt: lastId };
    const webhooks = await WhatsAppWebhookEvent.find(q)
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();
    if (!webhooks.length) break;
    lastId = webhooks[webhooks.length - 1]._id;

    for (const wh of webhooks) {
      stats.webhooksScanned += 1;
      const body = parseWebhookBody(wh.rawPayloadSnippet);
      if (!body) {
        stats.webhooksSkippedParse += 1;
        continue;
      }
      if (!execute) {
        stats.webhooksReplayed += 1;
        continue;
      }
      const r = await replayGupshupWebhookBody(body, wh.receivedAt || new Date());
      stats.webhooksReplayed += 1;
      if (r.updatedEventCount > 0) {
        stats.webhooksUpdated += 1;
        await WhatsAppWebhookEvent.updateOne(
          { _id: wh._id },
          {
            $set: {
              isQuarantined: false,
              quarantineReason: null,
              quarantineCandidateEventIds: [],
              resolvedMessageEventId:
                r.resolvedMatchId && mongoose.Types.ObjectId.isValid(r.resolvedMatchId)
                  ? new mongoose.Types.ObjectId(r.resolvedMatchId)
                  : null,
              resolvedBy: `repair_script:${r.updatePath}`
            }
          }
        );
      }
    }
    if (stats.webhooksScanned % 1000 === 0 || webhooks.length < batchSize) {
      logProgress(
        `Bulk progress scanned=${stats.webhooksScanned} updated=${stats.webhooksUpdated} skippedParse=${stats.webhooksSkippedParse}`
      );
    }
    if (webhooks.length < batchSize) break;
  }
}

async function run() {
  const { execute, from, to, opsProduct, batchSize, skipBulkWebhooks, bulkWebhooksOnly } =
    parseArgs();
  const range = parseIstDateRange(from, to);
  if (!range) {
    console.error('Invalid --from/--to; use YYYY-MM-DD (IST slot-day, same as Overview)');
    process.exit(1);
  }
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const stats = {
    mode: execute ? 'execute' : 'dry-run',
    database: mongoose.connection.db.databaseName,
    opsProduct,
    from: range.isoFrom,
    to: range.isoTo,
    istRangeUtc: { from: range.from.toISOString(), to: range.to.toISOString() },
    webhooksScanned: 0,
    webhooksReplayed: 0,
    webhooksUpdated: 0,
    webhooksSkippedParse: 0,
    failedWithoutIds: 0,
    promoteDryRun: 0,
    promoted: 0
  };

  if (!bulkWebhooksOnly) {
    await repairIitEventsByPhone({
      execute,
      opsProduct,
      range: { from: range.from, to: range.to },
      stats
    });

    await promoteFailedWithoutIds({
      execute,
      opsProduct,
      range: { from: range.from, to: range.to },
      stats
    });
  }

  if (!skipBulkWebhooks) {
    await replayBulkQuarantinedWebhooks({
      execute,
      range: { from: range.from, to: range.to },
      batchSize,
      stats
    });
  } else {
    stats.bulkWebhooksSkipped = true;
  }

  console.log(JSON.stringify(stats, null, 2));
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
