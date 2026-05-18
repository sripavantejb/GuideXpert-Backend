/**
 * Canonical recipient-primary WhatsApp ops metrics — single source of truth for
 * operator-facing KPIs, funnels, exclusions, and chart series.
 */
const { RETRY_EXCLUSION_REASON, RECONCILE_PENDING_STATUSES } = require('../utils/whatsappRetryRules');

const ANALYTICS_SCHEMA_VERSION = 3;
const METRICS_MODE = 'recipient_primary_v3';
const COHORT_ANCHOR = 'booking_ist_slot_day';

const ACCEPTED_STATUSES = ['submitted', 'sent', 'delivered', 'read'];
const SENT_PLUS = ['sent', 'delivered', 'read'];
const DELIVERED_PLUS = ['delivered', 'read'];
const TERMINAL_FAILURE = ['failed', 'retry_exhausted'];
const IN_FLIGHT = ['queued', 'submitted', 'sent', 'retry_pending', 'awaiting_final_dlr'];
const RECONCILE_PENDING = [...RECONCILE_PENDING_STATUSES];

const STATUS_PRECEDENCE = [
  'delivered',
  'permanent_failed',
  'reconcile_pending',
  'transient_unresolved',
  'excluded',
  'in_flight',
  'other'
];

const OPS_EXCLUSION_TAXONOMY = {
  already_delivered_or_read: 'already_delivered_or_read',
  reconcile_pending: 'reconcile_pending',
  duplicate_prevented: 'duplicate_prevented',
  retry_disabled: 'retry_disabled',
  permanent_failure: 'permanent_failure',
  invalid_whatsapp: 'invalid_whatsapp',
  cooldown_blocked: 'cooldown_blocked',
  manual_recovery_blocked: 'manual_recovery_blocked',
  missing_phone: 'missing_phone',
  missing_registration: 'missing_registration',
  policy_non_retryable: 'policy_non_retryable',
  in_flight_timeout: 'in_flight_timeout',
  promotion_superseded: 'promotion_superseded',
  eligibility_timing_blocked: 'eligibility_timing_blocked',
  dlr_failed_after_accept: 'dlr_failed_after_accept',
  webhook_stale_unresolved: 'webhook_stale_unresolved',
  other: 'other'
};

const RAW_TO_CANONICAL_EXCLUSION = {
  [RETRY_EXCLUSION_REASON.alreadyDeliveredOrRead]: OPS_EXCLUSION_TAXONOMY.already_delivered_or_read,
  [RETRY_EXCLUSION_REASON.duplicateRetryPrevented]: OPS_EXCLUSION_TAXONOMY.duplicate_prevented,
  [RETRY_EXCLUSION_REASON.retryEligibilityDisabled]: OPS_EXCLUSION_TAXONOMY.retry_disabled,
  [RETRY_EXCLUSION_REASON.cooldownBlocked]: OPS_EXCLUSION_TAXONOMY.cooldown_blocked,
  [RETRY_EXCLUSION_REASON.missingPhone]: OPS_EXCLUSION_TAXONOMY.missing_phone,
  [RETRY_EXCLUSION_REASON.missingRegisteredSubmission]: OPS_EXCLUSION_TAXONOMY.missing_registration,
  [RETRY_EXCLUSION_REASON.policyNonRetryable]: OPS_EXCLUSION_TAXONOMY.policy_non_retryable,
  [RETRY_EXCLUSION_REASON.permanentFailure]: OPS_EXCLUSION_TAXONOMY.permanent_failure,
  [RETRY_EXCLUSION_REASON.inFlightTimeout]: OPS_EXCLUSION_TAXONOMY.in_flight_timeout,
  [RETRY_EXCLUSION_REASON.promotionSuperseded]: OPS_EXCLUSION_TAXONOMY.promotion_superseded,
  [RETRY_EXCLUSION_REASON.outsideReminderValidity]: OPS_EXCLUSION_TAXONOMY.eligibility_timing_blocked,
  [RETRY_EXCLUSION_REASON.eligibilityTimingBlocked]: OPS_EXCLUSION_TAXONOMY.eligibility_timing_blocked,
  [RETRY_EXCLUSION_REASON.dlrFailedAfterAccept]: OPS_EXCLUSION_TAXONOMY.dlr_failed_after_accept,
  [RETRY_EXCLUSION_REASON.webhookStaleUnresolved]: OPS_EXCLUSION_TAXONOMY.webhook_stale_unresolved
};

const METRIC_DEFINITIONS = {
  totalRecipients:
    'Unique recipients (lineage + phone + template, or phone for all-templates) with at least one WhatsApp event in the IST slot-day cohort.',
  accepted: 'Recipients with provider-accepted status (submitted/sent/delivered/read) on any attempt.',
  delivered: 'Recipients with handset delivered or read on any attempt.',
  read: 'Recipients with read status on any attempt.',
  permanent_failed:
    'Recipients with permanent terminal failure or retry exhausted, without delivery — final bucket.',
  reconcile_pending:
    'Recipients in awaiting_final_dlr reconciliation grace — not final failed; retries blocked.',
  transient_unresolved:
    'Recipients still unresolved (in-flight, retryable fail, or ambiguous) — not permanent or reconcile grace.',
  excluded: 'Recipients with at least one retry exclusion reason (canonical taxonomy, one reason per recipient).',
  finalFailed: 'Alias for permanent_failed only — never includes reconcile pending or transient unresolved.'
};

function divPct(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

function aggFlag(v) {
  return v === 1 || v === true;
}

/**
 * @param {{ status?: string, retryExclusionReason?: string|null, anyReconcilePending?: unknown }} row
 */
function toCanonicalExclusionReason(row) {
  if (!row) return OPS_EXCLUSION_TAXONOMY.other;
  const st = String(row.status || row.lastStatus || '').toLowerCase();
  if (RECONCILE_PENDING.includes(st) || row.anyReconcilePending) {
    return OPS_EXCLUSION_TAXONOMY.reconcile_pending;
  }
  const raw = row.retryExclusionReason || row.lastExclusionReason;
  if (!raw) return null;
  return RAW_TO_CANONICAL_EXCLUSION[String(raw)] || OPS_EXCLUSION_TAXONOMY.other;
}

/**
 * @param {object} row — recipient rollup row from aggregation
 * @returns {string} STATUS_PRECEDENCE bucket id
 */
function assignRecipientBucket(row) {
  if (!row) return 'other';
  if (aggFlag(row.everDelivered)) return 'delivered';
  if (aggFlag(row.finalPermanentFailed)) return 'permanent_failed';
  if (aggFlag(row.anyReconcilePending)) return 'reconcile_pending';
  if (aggFlag(row.finalUnresolved) && !aggFlag(row.anyReconcilePending) && !aggFlag(row.finalPermanentFailed)) {
    return 'transient_unresolved';
  }
  if (aggFlag(row.anyExcluded) || row.retryExclusionReason || row.lastExclusionReason) return 'excluded';
  if (aggFlag(row.anyInFlight)) return 'in_flight';
  return 'other';
}

/**
 * Mongo $group stages after baseAfterAnnotate pipeline prefix.
 * @param {boolean} singleTemplate — when true, group by lineage+phone+kind
 */
function buildRecipientRollupPipelineStages(singleTemplate) {
  const recipientGroupId = singleTemplate
    ? { lineageId: '$lineageId', phone: '$phone', messageKind: '$messageKind' }
    : { phone: '$phone' };

  return [
    {
      $group: {
        _id: recipientGroupId,
        maxAttempt: { $max: '$attemptNumber' },
        everDelivered: {
          $max: { $cond: [{ $in: ['$status', DELIVERED_PLUS] }, 1, 0] }
        },
        everRead: { $max: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
        everAccepted: {
          $max: { $cond: [{ $in: ['$status', ACCEPTED_STATUSES] }, 1, 0] }
        },
        anyTerminalFail: {
          $max: { $cond: [{ $in: ['$status', TERMINAL_FAILURE] }, 1, 0] }
        },
        anyExhausted: { $max: { $cond: [{ $eq: ['$status', 'retry_exhausted'] }, 1, 0] } },
        anyPermanent: {
          $max: {
            $cond: [
              {
                $or: [
                  { $eq: ['$terminalFailureKind', 'permanent'] },
                  { $eq: ['$retryExclusionReason', 'permanent_failure'] },
                  { $eq: ['$retryExclusionReason', 'policy_non_retryable'] }
                ]
              },
              1,
              0
            ]
          }
        },
        anyExcluded: { $max: { $cond: [{ $ne: ['$retryExclusionReason', null] }, 1, 0] } },
        lastExclusionReason: { $last: '$retryExclusionReason' },
        lastStatus: { $last: '$status' },
        lastWebhookErrorReason: { $last: '$webhookErrorReason' },
        lastErrorMessage: { $last: '$errorMessage' },
        anyInFlight: {
          $max: { $cond: [{ $in: ['$status', IN_FLIGHT] }, 1, 0] }
        },
        anyReconcilePending: {
          $max: { $cond: [{ $in: ['$status', RECONCILE_PENDING] }, 1, 0] }
        },
        cohortFallback: { $max: { $cond: [{ $eq: ['$cohortFallback', true] }, 1, 0] } },
        firstDeliveredAttempt: {
          $min: {
            $cond: [{ $in: ['$status', DELIVERED_PLUS] }, '$attemptNumber', null]
          }
        },
        anyFailAttempt1: {
          $max: {
            $cond: [
              {
                $and: [
                  { $eq: ['$attemptNumber', 1] },
                  { $in: ['$status', TERMINAL_FAILURE] }
                ]
              },
              1,
              0
            ]
          }
        }
      }
    },
    {
      $addFields: {
        finalPermanentFailed: {
          $cond: [
            {
              $and: [
                { $eq: ['$everDelivered', 0] },
                {
                  $or: [{ $eq: ['$anyPermanent', 1] }, { $eq: ['$anyExhausted', 1] }]
                }
              ]
            },
            1,
            0
          ]
        }
      }
    },
    {
      $addFields: {
        finalUnresolved: {
          $cond: [
            {
              $and: [
                { $eq: ['$everDelivered', 0] },
                { $eq: ['$finalPermanentFailed', 0] },
                {
                  $or: [
                    { $eq: ['$anyReconcilePending', 1] },
                    { $eq: ['$anyInFlight', 1] },
                    { $eq: ['$anyTerminalFail', 1] }
                  ]
                }
              ]
            },
            1,
            0
          ]
        }
      }
    }
  ];
}

function buildRecipientOutcomeBreakdown(recipientRows) {
  const rows = Array.isArray(recipientRows) ? recipientRows : [];
  const out = {
    delivered: 0,
    permanentFailed: 0,
    reconcilePending: 0,
    transientUnresolved: 0,
    other: 0
  };
  for (const r of rows) {
    const bucket = assignRecipientBucket(r);
    if (bucket === 'delivered') out.delivered += 1;
    else if (bucket === 'permanent_failed') out.permanentFailed += 1;
    else if (bucket === 'reconcile_pending') out.reconcilePending += 1;
    else if (bucket === 'transient_unresolved') out.transientUnresolved += 1;
    else out.other += 1;
  }
  const total = rows.length;
  const sumCheck =
    out.delivered + out.permanentFailed + out.reconcilePending + out.transientUnresolved + out.other;
  return {
    ...out,
    unresolved: out.transientUnresolved,
    total,
    sumCheck
  };
}

function rollupRecipientTotals(recipientRows) {
  const recipients = Array.isArray(recipientRows) ? recipientRows : [];
  const outcomeBreakdown = buildRecipientOutcomeBreakdown(recipients);
  const totals = recipients.reduce(
    (acc, r) => ({
      totalRecipients: acc.totalRecipients + 1,
      accepted: acc.accepted + (r.everAccepted ? 1 : 0),
      delivered: acc.delivered + (r.everDelivered ? 1 : 0),
      read: acc.read + (r.everRead ? 1 : 0),
      finalUnresolved: acc.finalUnresolved + (r.finalUnresolved ? 1 : 0),
      finalPermanentFailed: acc.finalPermanentFailed + (r.finalPermanentFailed ? 1 : 0),
      reconcilePending: acc.reconcilePending + (r.anyReconcilePending ? 1 : 0),
      transientUnresolved:
        acc.transientUnresolved +
        (r.finalUnresolved && !r.anyReconcilePending && !r.finalPermanentFailed ? 1 : 0),
      cohortFallbackCount: acc.cohortFallbackCount + (r.cohortFallback ? 1 : 0)
    }),
    {
      totalRecipients: 0,
      accepted: 0,
      delivered: 0,
      read: 0,
      finalUnresolved: 0,
      finalPermanentFailed: 0,
      reconcilePending: 0,
      transientUnresolved: 0,
      cohortFallbackCount: 0
    }
  );
  return {
    ...totals,
    finalFailed: totals.finalPermanentFailed,
    outcomeBreakdown
  };
}

/**
 * One canonical exclusion reason per recipient (from rollup row).
 * @param {Array<object>} recipientRows
 */
/**
 * Classify terminal failure text into operator-facing buckets (one per recipient).
 * @param {object} row
 * @returns {string|null}
 */
function toCanonicalFailureReason(row) {
  if (!row || aggFlag(row.everDelivered)) return null;
  const webhook = String(row.lastWebhookErrorReason || '');
  const err = String(row.lastErrorMessage || '');
  const combined = `${webhook} ${err}`;
  if (/invalid|no whatsapp|not whatsapp|disabled/i.test(combined)) {
    return 'invalid_whatsapp';
  }
  if (/blocked|opt.?out/i.test(combined)) {
    return 'user_blocked';
  }
  if (/timeout|network|temporar/i.test(combined)) {
    return 'transient';
  }
  const excl = row.lastExclusionReason || row.retryExclusionReason;
  if (excl === 'dlr_failed_after_accept') return OPS_EXCLUSION_TAXONOMY.dlr_failed_after_accept;
  if (excl === 'webhook_stale_unresolved') return OPS_EXCLUSION_TAXONOMY.webhook_stale_unresolved;
  if (excl === 'permanent_failure' || excl === 'policy_non_retryable') {
    return OPS_EXCLUSION_TAXONOMY.permanent_failure;
  }
  if (aggFlag(row.finalPermanentFailed)) return OPS_EXCLUSION_TAXONOMY.permanent_failure;
  if (aggFlag(row.finalUnresolved)) return 'transient';
  return OPS_EXCLUSION_TAXONOMY.other;
}

/**
 * Recipient-level failure reason chart rows (not event-inflated).
 * @param {Array<object>} recipientRows
 * @returns {Array<{ _id: string, count: number }>}
 */
function buildRecipientFailureReasonBreakdown(recipientRows) {
  const counts = {};
  for (const r of recipientRows || []) {
    const bucket = assignRecipientBucket(r);
    if (bucket !== 'permanent_failed' && bucket !== 'transient_unresolved') continue;
    const reason = toCanonicalFailureReason(r) || OPS_EXCLUSION_TAXONOMY.other;
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([_id, count]) => ({ _id, count }))
    .sort((a, b) => b.count - a.count);
}

function buildRecipientExclusionBreakdown(recipientRows) {
  const byReason = {};
  for (const r of recipientRows || []) {
    if (!aggFlag(r.anyExcluded) && !r.lastExclusionReason) continue;
    const canon = toCanonicalExclusionReason(r) || OPS_EXCLUSION_TAXONOMY.other;
    byReason[canon] = (byReason[canon] || 0) + 1;
  }
  const excludedTotal = Object.values(byReason).reduce((a, b) => a + b, 0);
  return { exclusionBreakdown: byReason, excludedTotal };
}

/**
 * Per-attempt recipient funnel from event-level flags grouped by attempt.
 * @param {Array<{ _id: { attempt?: number, lineageId?: unknown, phone?: string, messageKind?: string } }, accepted?: number, sent?: number, delivered?: number, read?: number, failed?: number, inFlight?: number, excluded?: number }>} perRecipientAttemptRows
 */
function buildRetryFunnelFromPerAttemptRows(perRecipientAttemptRows) {
  const byAttempt = { 1: {}, 2: {}, 3: {} };
  const stageAgg = { 1: {}, 2: {}, 3: {} };
  for (const row of perRecipientAttemptRows || []) {
    const att = Number(row._id?.attempt) || 0;
    if (att < 1 || att > 3) continue;
    if (!stageAgg[att]) stageAgg[att] = { targeted: 0, accepted: 0, sent: 0, delivered: 0, read: 0, failed: 0, inFlight: 0, excluded: 0 };
    stageAgg[att].targeted += 1;
    if (row.accepted) stageAgg[att].accepted += 1;
    if (row.sent) stageAgg[att].sent += 1;
    if (row.delivered) stageAgg[att].delivered += 1;
    if (row.read) stageAgg[att].read += 1;
    if (row.failed) stageAgg[att].failed += 1;
    if (row.inFlight) stageAgg[att].inFlight += 1;
    if (row.excluded) stageAgg[att].excluded += 1;
  }
  [1, 2, 3].forEach((n) => {
    const s = stageAgg[n] || {};
    const t = s.targeted || 0;
    byAttempt[n] = {
      targetedRecipients: t,
      accepted: s.accepted || 0,
      sent: s.sent || 0,
      delivered: s.delivered || 0,
      read: s.read || 0,
      failed: s.failed || 0,
      inFlight: s.inFlight || 0,
      excluded: s.excluded || 0,
      successRatePct: divPct(s.delivered || 0, t)
    };
  });
  return byAttempt;
}

/**
 * Build stage reconciliation bridges from recipient rollup rows.
 * @param {Array<object>} recipientRows
 */
function buildRetryFunnelReconciliation(recipientRows) {
  const bridges = [];
  const rows = recipientRows || [];

  const a1Unresolved = rows.filter(
    (r) =>
      aggFlag(r.anyFailAttempt1) &&
      !aggFlag(r.everDelivered) &&
      Number(r.firstDeliveredAttempt || 99) > 1
  );
  const carriedForward = rows.filter(
    (r) => !aggFlag(r.everDelivered) && (aggFlag(r.anyFailAttempt1) || aggFlag(r.finalUnresolved))
  ).length;

  const recoveredOnRetry1 = rows.filter(
    (r) => aggFlag(r.everDelivered) && Number(r.firstDeliveredAttempt) === 2
  ).length;
  const recoveredOnRetry2 = rows.filter(
    (r) => aggFlag(r.everDelivered) && Number(r.firstDeliveredAttempt) === 3
  ).length;

  const stillUnresolved = rows.filter(
    (r) =>
      !aggFlag(r.everDelivered) &&
      aggFlag(r.finalUnresolved) &&
      !aggFlag(r.anyReconcilePending) &&
      !aggFlag(r.finalPermanentFailed)
  ).length;

  const excluded = rows.filter((r) => assignRecipientBucket(r) === 'excluded').length;
  const permanentFailed = rows.filter((r) => aggFlag(r.finalPermanentFailed)).length;

  if (carriedForward > 0 || recoveredOnRetry1 > 0) {
    bridges.push({
      fromAttempt: 1,
      toAttempt: 2,
      carriedForward,
      recoveredOnRetry: recoveredOnRetry1,
      stillUnresolved,
      excluded,
      permanentFailed,
      inFlightTolerance: Math.max(0, carriedForward - recoveredOnRetry1 - stillUnresolved - excluded - permanentFailed)
    });
  }

  bridges.push({
    fromAttempt: 2,
    toAttempt: 3,
    carriedForward: stillUnresolved,
    recoveredOnRetry: recoveredOnRetry2,
    stillUnresolved: rows.filter(
      (r) => !aggFlag(r.everDelivered) && aggFlag(r.anyExhausted)
    ).length,
    excluded: 0,
    permanentFailed: 0
  });

  return bridges;
}

/**
 * Mongo stages for per-recipient-per-attempt funnel (after baseAfterAnnotate).
 * @param {boolean} singleTemplate
 */
function buildFunnelPerAttemptGroupStages(singleTemplate) {
  const funnelRowId = singleTemplate
    ? { attempt: '$attemptNumber', lineageId: '$lineageId', phone: '$phone', messageKind: '$messageKind' }
    : { attempt: '$attemptNumber', phone: '$phone' };
  return [
    {
      $group: {
        _id: funnelRowId,
        accepted: {
          $max: { $cond: [{ $in: ['$status', ACCEPTED_STATUSES] }, 1, 0] }
        },
        sent: { $max: { $cond: [{ $in: ['$status', SENT_PLUS] }, 1, 0] } },
        delivered: { $max: { $cond: [{ $in: ['$status', DELIVERED_PLUS] }, 1, 0] } },
        read: { $max: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
        failed: { $max: { $cond: [{ $in: ['$status', TERMINAL_FAILURE] }, 1, 0] } },
        inFlight: { $max: { $cond: [{ $in: ['$status', IN_FLIGHT] }, 1, 0] } },
        excluded: { $max: { $cond: [{ $ne: ['$retryExclusionReason', null] }, 1, 0] } }
      }
    }
  ];
}

/**
 * Collapse per-recipient attempt rows into byAttempt totals (from aggregate with $group by attempt).
 * @param {Array<{ _id: number, targetedRecipients?: number, accepted?: number, ... }>} funnelStages
 */
function collapseFunnelStagesByAttempt(funnelStages) {
  const byAttempt = { 1: {}, 2: {}, 3: {} };
  [1, 2, 3].forEach((n) => {
    const row = (funnelStages || []).find((x) => x._id === n) || {};
    const t = row.targetedRecipients || 0;
    byAttempt[n] = {
      targetedRecipients: t,
      accepted: row.accepted || 0,
      sent: row.sent || 0,
      delivered: row.delivered || 0,
      read: row.read || 0,
      failed: row.failed || 0,
      inFlight: row.inFlight || 0,
      excluded: row.excluded || 0,
      successRatePct: divPct(row.delivered || 0, t)
    };
  });
  return byAttempt;
}

function buildAnalyticsMeta(extra = {}) {
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    metricsMode: METRICS_MODE,
    cohortAnchor: COHORT_ANCHOR,
    metricDefinitions: METRIC_DEFINITIONS,
    ...extra
  };
}

module.exports = {
  ANALYTICS_SCHEMA_VERSION,
  METRICS_MODE,
  COHORT_ANCHOR,
  STATUS_PRECEDENCE,
  OPS_EXCLUSION_TAXONOMY,
  METRIC_DEFINITIONS,
  ACCEPTED_STATUSES,
  SENT_PLUS,
  DELIVERED_PLUS,
  TERMINAL_FAILURE,
  IN_FLIGHT,
  RECONCILE_PENDING,
  divPct,
  aggFlag,
  toCanonicalExclusionReason,
  toCanonicalFailureReason,
  assignRecipientBucket,
  buildRecipientRollupPipelineStages,
  buildRecipientOutcomeBreakdown,
  rollupRecipientTotals,
  buildRecipientExclusionBreakdown,
  buildRecipientFailureReasonBreakdown,
  buildRetryFunnelFromPerAttemptRows,
  buildRetryFunnelReconciliation,
  buildFunnelPerAttemptGroupStages,
  collapseFunnelStagesByAttempt,
  buildAnalyticsMeta
};
