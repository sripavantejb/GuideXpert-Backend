/**
 * Two-phase campaign DLR reconciliation: soft awaiting_final_dlr grace, then terminal failed.
 */
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const { rankSuccessStatus } = require('../utils/gupshupWebhookMonotonic');
const {
  classifyReconcileFinalizeFailure,
  dlrReconcileStaleMs,
  dlrReconcileGraceMs,
  RECONCILE_PENDING_STATUSES,
  RETRY_EXCLUSION_REASON
} = require('../utils/whatsappRetryRules');

/** Message kinds that participate in two-phase DLR reconciliation */
const RECONCILE_MESSAGE_KINDS = ['slot_booked', 'pre4hr', 'meet', '30min'];
/** @deprecated use RECONCILE_MESSAGE_KINDS — kept for existing imports */
const CAMPAIGN_KINDS = ['pre4hr', 'meet', '30min'];
const STALE_SOURCE_STATUSES = ['submitted', 'sent'];
const AWAITING_STATUS = RECONCILE_PENDING_STATUSES[0];

function clampLimit(raw) {
  return Math.min(Math.max(parseInt(String(raw || ''), 10) || 200, 1), 500);
}

function reconcileBatchLimit(opts = {}) {
  if (opts.limit != null) return clampLimit(opts.limit);
  return clampLimit(process.env.WA_DLR_RECONCILE_BATCH_LIMIT);
}

function reconcileMaxPasses() {
  return Math.min(Math.max(parseInt(process.env.WA_DLR_RECONCILE_MAX_PASSES || '', 10) || 3, 1), 10);
}

/**
 * Phase 1: stale submitted/sent → awaiting_final_dlr (not terminal failed).
 * @param {{ now?: Date, limit?: number, afterId?: import('mongoose').Types.ObjectId|null }} [opts]
 */
async function markStaleAwaitingFinalDlr(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const limit = reconcileBatchLimit(opts);
  const staleMs = dlrReconcileStaleMs();
  const graceMs = dlrReconcileGraceMs();
  const staleBefore = new Date(now.getTime() - staleMs);
  const finalityUntil = new Date(now.getTime() + graceMs);

  const query = {
    messageKind: { $in: RECONCILE_MESSAGE_KINDS },
    status: { $in: STALE_SOURCE_STATUSES },
    deliveredAt: null,
    readAt: null,
    $or: [
      { providerAcceptedAt: { $lte: staleBefore } },
      { providerAcceptedAt: null, createdAt: { $lte: staleBefore } }
    ]
  };
  if (opts.afterId) query._id = { $gt: opts.afterId };

  const rows = await WhatsAppMessageEvent.find(query)
    .select('_id status')
    .sort({ _id: 1 })
    .limit(limit)
    .lean();

  const byReason = {};
  let marked = 0;
  let lastId = opts.afterId || null;

  for (const row of rows) {
    lastId = row._id;
    const st = String(row.status || '').toLowerCase();
    if (rankSuccessStatus(st) >= 5) continue;

    const res = await WhatsAppMessageEvent.updateOne(
      { _id: row._id, status: { $in: STALE_SOURCE_STATUSES } },
      {
        $set: {
          status: AWAITING_STATUS,
          reconcilePendingAt: now,
          reconcileFinalityUntil: finalityUntil,
          reconcileDerivedFailure: false,
          updatedAt: now,
          retryEligible: false,
          retryExclusionReason: null,
          retryExclusionAt: null,
          terminalFailureKind: null,
          'retryExclusionMeta.note': 'reconcile_awaiting_final_dlr',
          errorMessage: 'stale_dlr_awaiting_finality'
        }
      }
    );
    if (res.modifiedCount) {
      marked += 1;
      byReason.awaiting_final_dlr = (byReason.awaiting_final_dlr || 0) + 1;
    }
  }

  if (marked > 0) {
    console.log('[WA reconcile] phase1 awaiting_final_dlr', { scanned: rows.length, marked, byReason });
  }

  return { scanned: rows.length, marked, byReason, lastId };
}

/**
 * Phase 2: grace expired → failed with classifier (promotion-eligible per classification).
 * @param {{ now?: Date, limit?: number, afterId?: import('mongoose').Types.ObjectId|null }} [opts]
 */
async function finalizeAwaitingReconcile(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const limit = reconcileBatchLimit(opts);

  const query = {
    messageKind: { $in: RECONCILE_MESSAGE_KINDS },
    status: AWAITING_STATUS,
    reconcileFinalityUntil: { $lte: now }
  };
  if (opts.afterId) query._id = { $gt: opts.afterId };

  const rows = await WhatsAppMessageEvent.find(query)
    .select(
      '_id status messageKind attemptNumber errorMessage webhookErrorCode webhookErrorReason providerAcceptedAt createdAt'
    )
    .sort({ _id: 1 })
    .limit(limit)
    .lean();

  const byReason = {};
  let finalized = 0;
  let lastId = opts.afterId || null;

  for (const row of rows) {
    lastId = row._id;
    const st = String(row.status || '').toLowerCase();
    if (st !== AWAITING_STATUS) continue;

    const classified = classifyReconcileFinalizeFailure(row.messageKind, row, { now });

    let exclusionReason = classified.exclusionReason;
    const wasAccepted = !!row.providerAcceptedAt;
    if (!exclusionReason && !classified.retryable) {
      exclusionReason = wasAccepted
        ? RETRY_EXCLUSION_REASON.dlrFailedAfterAccept
        : RETRY_EXCLUSION_REASON.webhookStaleUnresolved;
    }

    const reasonKey = exclusionReason || (classified.retryable ? 'stale_retryable' : 'stale_finalized');
    byReason[reasonKey] = (byReason[reasonKey] || 0) + 1;

    const res = await WhatsAppMessageEvent.updateOne(
      { _id: row._id, status: AWAITING_STATUS },
      {
        $set: {
          status: 'failed',
          failedAt: now,
          updatedAt: now,
          reconcileDerivedFailure: true,
          retryEligible: classified.retryable,
          terminalFailureKind: classified.terminalFailureKind,
          retryExclusionReason: exclusionReason,
          retryExclusionAt: exclusionReason ? now : null,
          'retryExclusionMeta.note':
            classified.metaNote ||
            (wasAccepted ? 'reconcile_finalize_after_provider_accept' : 'reconcile_finalize_no_dlr'),
          errorMessage: row.errorMessage || 'stale_dlr_no_resolution'
        }
      }
    );
    if (res.modifiedCount) finalized += 1;
  }

  if (finalized > 0) {
    console.log('[WA reconcile] phase2 finalize failed', { scanned: rows.length, finalized, byReason });
  }

  return { scanned: rows.length, finalized, byReason, lastId };
}

/**
 * Run phase 1 then phase 2 (order matters for retry-whatsapp tick).
 * Multi-pass when backlog exceeds batch limit.
 * @param {{ now?: Date, limit?: number }} [opts]
 */
async function reconcileStaleInFlightMessages(opts = {}) {
  const limit = reconcileBatchLimit(opts);
  const maxPasses = reconcileMaxPasses();
  let afterIdP1 = null;
  let afterIdP2 = null;
  let phase1 = { scanned: 0, marked: 0, byReason: {} };
  let phase2 = { scanned: 0, finalized: 0, byReason: {} };

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const p1 = await markStaleAwaitingFinalDlr({ ...opts, afterId: afterIdP1 });
    phase1.scanned += p1.scanned;
    phase1.marked += p1.marked;
    phase1.byReason = { ...phase1.byReason, ...p1.byReason };
    if (p1.lastId) afterIdP1 = p1.lastId;

    const p2 = await finalizeAwaitingReconcile({ ...opts, afterId: afterIdP2 });
    phase2.scanned += p2.scanned;
    phase2.finalized += p2.finalized;
    phase2.byReason = { ...phase2.byReason, ...p2.byReason };
    if (p2.lastId) afterIdP2 = p2.lastId;

    if (p1.marked < limit && p2.finalized < limit) break;
  }

  return {
    scanned: phase1.scanned + phase2.scanned,
    reconciled: phase1.marked + phase2.finalized,
    phase1,
    phase2,
    passes: maxPasses,
    byReason: { ...(phase1.byReason || {}), ...(phase2.byReason || {}) }
  };
}

module.exports = {
  markStaleAwaitingFinalDlr,
  finalizeAwaitingReconcile,
  reconcileStaleInFlightMessages,
  RECONCILE_MESSAGE_KINDS,
  CAMPAIGN_KINDS,
  STALE_SOURCE_STATUSES,
  AWAITING_STATUS,
  reconcileBatchLimit,
  reconcileMaxPasses
};
