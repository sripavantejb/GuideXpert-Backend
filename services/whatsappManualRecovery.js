/**
 * Admin-driven recovery for unresolved recipients of a single template.
 *
 * Targets:
 *   - terminal failures (failed | retry_exhausted)
 *   - retry exclusions (any retryExclusionReason set)
 *   - long-lived in-flight rows (queued | submitted | retry_pending) older than threshold
 *
 * Skips:
 *   - phones with delivered/read for same template (within UI window)
 *   - phones with delivered/read for same template within configurable global lookback
 *   - phones with an in-flight (queued/submitted/retry_pending/sent) row newer than the
 *     candidate's last failure (avoids racing automated retry slices)
 *
 * Sends via existing safeSendWhatsApp with source: 'admin_manual' so the audit
 * trail and webhook reconciliation continue to work via WhatsAppMessageEvent.
 */
const mongoose = require('mongoose');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const WhatsAppManualRecoveryJob = require('../models/WhatsAppManualRecoveryJob');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const FormSubmission = require('../models/FormSubmission');
const gupshupService = require('./gupshupService');
const { safeSendWhatsApp } = require('../utils/safeSendWhatsApp');
const { buildSlotNotificationVariables } = require('../utils/slotNotificationFormatters');

const ALLOWED_MESSAGE_KINDS = ['slot_booked', 'pre4hr', 'meet', '30min'];
const TERMINAL_FAILURE_STATUSES = ['failed', 'retry_exhausted'];
const SUCCESS_TERMINAL_STATUSES = ['delivered', 'read'];
const IN_FLIGHT_STATUSES = ['queued', 'submitted', 'sent', 'retry_pending'];

function getInFlightStaleMs() {
  const min = parseInt(process.env.WHATSAPP_RECOVERY_INFLIGHT_STALE_MINUTES || '180', 10) || 180;
  return min * 60 * 1000;
}

function getGlobalLookbackDays() {
  const d = parseInt(process.env.WHATSAPP_MANUAL_RECOVERY_SUCCESS_LOOKBACK_DAYS || '7', 10);
  return Number.isFinite(d) && d > 0 ? d : 7;
}

function dispatchKindToSendFn(kind) {
  switch (kind) {
    case 'slot_booked':
      return gupshupService.sendSlotBookedWhatsApp;
    case 'pre4hr':
      return gupshupService.sendPre4HrReminderWhatsApp;
    case 'meet':
      return gupshupService.sendMeetLinkWhatsApp;
    case '30min':
      return gupshupService.sendReminder30MinWhatsApp;
    default:
      return null;
  }
}

/**
 * Pure aggregation that returns one representative row per unresolved phone.
 * @param {{ messageKind: string, fromAt?: Date|null, toAt?: Date|null }} opts
 */
async function buildPreview({ messageKind, fromAt = null, toAt = null }) {
  if (!ALLOWED_MESSAGE_KINDS.includes(messageKind)) {
    return { error: `Invalid messageKind. Allowed: ${ALLOWED_MESSAGE_KINDS.join(', ')}` };
  }

  const match = { messageKind };
  /** For "delivered in UI window" we still scope success events to the same date bounds. */
  const windowCreatedRange = (fromAt || toAt)
    ? { ...(fromAt ? { $gte: fromAt } : {}), ...(toAt ? { $lte: toAt } : {}) }
    : null;

  const inFlightStaleBefore = new Date(Date.now() - getInFlightStaleMs());

  /**
   * Pick one representative event per phone:
   *   - prefer rows with terminal failure / retry_exhausted (rank 3)
   *   - else rows with retryExclusionReason set (rank 2)
   *   - else stale in-flight rows (rank 1)
   *   - tiebreaker: latest createdAt
   */
  const rows = await WhatsAppMessageEvent.aggregate([
    { $match: match },
    {
      $addFields: {
        lineageId: { $ifNull: ['$canonicalRetryGroupId', '$retryGroupId'] },
        unresolvedRank: {
          $cond: [
            { $in: ['$status', TERMINAL_FAILURE_STATUSES] }, 3,
            { $cond: [
              { $ne: ['$retryExclusionReason', null] }, 2,
              { $cond: [
                {
                  $and: [
                    { $in: ['$status', IN_FLIGHT_STATUSES] },
                    { $lte: ['$createdAt', inFlightStaleBefore] }
                  ]
                }, 1, 0
              ] }
            ] }
          ]
        }
      }
    },
    { $match: { unresolvedRank: { $gt: 0 } } },
    { $sort: { phone: 1, unresolvedRank: -1, createdAt: -1 } },
    {
      $group: {
        _id: '$phone',
        eventId: { $first: '$_id' },
        retryGroupId: { $first: '$retryGroupId' },
        lineageId: { $first: '$lineageId' },
        maxAttemptAtStart: { $max: '$attemptNumber' },
        attemptNumber: { $first: '$attemptNumber' },
        status: { $first: '$status' },
        retryExclusionReason: { $first: '$retryExclusionReason' },
        errorMessage: { $first: '$errorMessage' },
        formSubmissionId: { $first: '$formSubmissionId' },
        createdAt: { $first: '$createdAt' },
        unresolvedRank: { $first: '$unresolvedRank' }
      }
    }
  ]);

  const rowInPreviewWindow = (r) => {
    if (!fromAt && !toAt) return true;
    const t = r.createdAt ? new Date(r.createdAt).getTime() : NaN;
    if (Number.isNaN(t)) return false;
    if (fromAt && t < fromAt.getTime()) return false;
    if (toAt && t > toAt.getTime()) return false;
    return true;
  };
  const rowsFiltered = rows.filter(rowInPreviewWindow);

  if (!rowsFiltered.length) {
    return {
      data: {
        candidates: [],
        candidatesByReason: {},
        targeted: 0,
        skippedAlreadyDelivered: 0,
        skippedGlobalRecentSuccess: 0,
        skippedInFlightDuplicate: 0
      }
    };
  }

  const allPhones = rowsFiltered.map((r) => r._id).filter(Boolean);

  /** Phones already resolved within the same UI window (window-scoped exclusion) */
  const windowSuccess = await WhatsAppMessageEvent.distinct('phone', {
    messageKind,
    ...(windowCreatedRange ? { createdAt: windowCreatedRange } : {}),
    phone: { $in: allPhones },
    status: { $in: SUCCESS_TERMINAL_STATUSES }
  });
  const windowSuccessSet = new Set(windowSuccess);

  /** Phones already resolved globally within lookback (per chosen rule) */
  const lookbackStart = new Date(Date.now() - getGlobalLookbackDays() * 24 * 60 * 60 * 1000);
  const remainingAfterWindow = allPhones.filter((p) => !windowSuccessSet.has(p));
  const globalSuccess = remainingAfterWindow.length
    ? await WhatsAppMessageEvent.distinct('phone', {
        messageKind,
        phone: { $in: remainingAfterWindow },
        status: { $in: SUCCESS_TERMINAL_STATUSES },
        createdAt: { $gte: lookbackStart }
      })
    : [];
  const globalSuccessSet = new Set(globalSuccess);

  /** Phones that already have a fresh in-flight or success row newer than candidate's row */
  const newerInFlight = await WhatsAppMessageEvent.aggregate([
    {
      $match: {
        messageKind,
        phone: { $in: allPhones },
        status: { $in: [...IN_FLIGHT_STATUSES, ...SUCCESS_TERMINAL_STATUSES] }
      }
    },
    { $sort: { phone: 1, createdAt: -1 } },
    {
      $group: {
        _id: '$phone',
        latestStatus: { $first: '$status' },
        latestCreatedAt: { $first: '$createdAt' }
      }
    }
  ]);
  const newerInFlightMap = new Map(newerInFlight.map((r) => [r._id, r]));

  const candidates = [];
  let skippedAlreadyDelivered = 0;
  let skippedGlobalRecentSuccess = 0;
  let skippedInFlightDuplicate = 0;
  const candidatesByReason = {};

  rowsFiltered.forEach((r) => {
    const phone = r._id;
    if (!phone) return;
    if (windowSuccessSet.has(phone)) {
      skippedAlreadyDelivered += 1;
      return;
    }
    if (globalSuccessSet.has(phone)) {
      skippedGlobalRecentSuccess += 1;
      return;
    }
    const newer = newerInFlightMap.get(phone);
    if (
      newer &&
      newer.latestCreatedAt &&
      r.createdAt &&
      new Date(newer.latestCreatedAt).getTime() > new Date(r.createdAt).getTime() &&
      !TERMINAL_FAILURE_STATUSES.includes(newer.latestStatus)
    ) {
      skippedInFlightDuplicate += 1;
      return;
    }

    let reason = 'unresolved';
    if (TERMINAL_FAILURE_STATUSES.includes(r.status)) {
      reason = r.status;
    } else if (r.retryExclusionReason) {
      reason = `excluded:${r.retryExclusionReason}`;
    } else if (IN_FLIGHT_STATUSES.includes(r.status)) {
      reason = `stale_in_flight:${r.status}`;
    }
    candidatesByReason[reason] = (candidatesByReason[reason] || 0) + 1;

    const lineageOid =
      r.lineageId && mongoose.Types.ObjectId.isValid(String(r.lineageId))
        ? new mongoose.Types.ObjectId(String(r.lineageId))
        : r.retryGroupId && mongoose.Types.ObjectId.isValid(String(r.retryGroupId))
          ? new mongoose.Types.ObjectId(String(r.retryGroupId))
          : null;

    candidates.push({
      phone,
      eventId: r.eventId,
      retryGroupId: r.retryGroupId,
      lineageId: lineageOid,
      maxAttemptAtStart: Number(r.maxAttemptAtStart) || Number(r.attemptNumber) || 1,
      attemptNumber: r.attemptNumber,
      status: r.status,
      retryExclusionReason: r.retryExclusionReason,
      errorMessage: r.errorMessage,
      formSubmissionId: r.formSubmissionId,
      createdAt: r.createdAt,
      reason
    });
  });

  return {
    data: {
      candidates,
      candidatesByReason,
      targeted: candidates.length,
      skippedAlreadyDelivered,
      skippedGlobalRecentSuccess,
      skippedInFlightDuplicate,
      lookbackDays: getGlobalLookbackDays(),
      inFlightStaleMinutes: Math.round(getInFlightStaleMs() / 60000)
    }
  };
}

/**
 * Re-check a phone right before sending; returns false if it should NOT be sent now
 * (delivered/read globally within lookback, or in-flight row newer than candidate).
 */
async function isStillUnresolved(messageKind, phone, candidateCreatedAt) {
  const lookbackStart = new Date(Date.now() - getGlobalLookbackDays() * 24 * 60 * 60 * 1000);
  const success = await WhatsAppMessageEvent.findOne({
    messageKind,
    phone,
    status: { $in: SUCCESS_TERMINAL_STATUSES },
    createdAt: { $gte: lookbackStart }
  })
    .select('_id')
    .lean();
  if (success) return { ok: false, reason: 'already_delivered_or_read' };

  if (candidateCreatedAt) {
    const newer = await WhatsAppMessageEvent.findOne({
      messageKind,
      phone,
      status: { $in: IN_FLIGHT_STATUSES },
      createdAt: { $gt: new Date(candidateCreatedAt) }
    })
      .sort({ createdAt: -1 })
      .select('_id status')
      .lean();
    if (newer) return { ok: false, reason: 'newer_in_flight' };
  }
  return { ok: true };
}

/**
 * Recompute recovered / inFlight counters from rows created after `job.startedAt` for
 * the candidate phones. Cheap: bounded by job size and a simple aggregate.
 *
 * - recovered = phones with delivered/read row post-start
 * - inFlight = phones with queued/submitted/sent row post-start (and NOT yet recovered or terminal-failed post-start)
 */
async function computePostStartCounters(job) {
  if (!job?.startedAt || !Array.isArray(job.candidatePhones) || !job.candidatePhones.length) {
    return {
      recovered: 0,
      inFlight: 0,
      failed: 0,
      excluded: 0,
      delivered: 0
    };
  }
  const rows = await WhatsAppMessageEvent.aggregate([
    {
      $match: {
        messageKind: job.messageKind,
        phone: { $in: job.candidatePhones },
        createdAt: { $gte: job.startedAt }
      }
    },
    {
      $group: {
        _id: '$phone',
        delivered: { $max: { $cond: [{ $in: ['$status', SUCCESS_TERMINAL_STATUSES] }, 1, 0] } },
        terminalFail: { $max: { $cond: [{ $in: ['$status', TERMINAL_FAILURE_STATUSES] }, 1, 0] } },
        excluded: {
          $max: {
            $cond: [
              {
                $and: [
                  { $ne: ['$retryExclusionReason', null] },
                  { $ne: ['$retryExclusionReason', ''] }
                ]
              },
              1,
              0
            ]
          }
        },
        inFlight: { $max: { $cond: [{ $in: ['$status', IN_FLIGHT_STATUSES] }, 1, 0] } }
      }
    }
  ]);
  let recovered = 0;
  let inFlight = 0;
  let failed = 0;
  let excluded = 0;
  rows.forEach((r) => {
    if (r.delivered) {
      recovered += 1;
    } else if (r.excluded) {
      excluded += 1;
    } else if (r.terminalFail) {
      failed += 1;
    } else if (r.inFlight) {
      inFlight += 1;
    }
  });
  return {
    recovered,
    inFlight,
    failed,
    excluded,
    delivered: recovered
  };
}

async function executeJob(jobId) {
  const job = await WhatsAppManualRecoveryJob.findById(jobId);
  if (!job) return;
  if (job.status !== 'queued') return;

  job.status = 'running';
  job.startedAt = new Date();
  job.lastProgressAt = new Date();
  await job.save();

  const sendFn = dispatchKindToSendFn(job.messageKind);
  if (typeof sendFn !== 'function') {
    job.status = 'failed';
    job.finishedAt = new Date();
    job.errorSummary = 'Unknown messageKind / sendFn missing';
    await job.save();
    return;
  }

  let batchRetryGroupId = job.batchRetryGroupId;
  if (!batchRetryGroupId) {
    const g = await WhatsAppRetryGroup.create({
      messageKind: job.messageKind,
      trigger: 'manual',
      status: 'open'
    });
    batchRetryGroupId = g._id;
    await WhatsAppManualRecoveryJob.updateOne({ _id: jobId }, { $set: { batchRetryGroupId } });
  }

  const lineageByPhone = new Map();
  (Array.isArray(job.candidateLineage) ? job.candidateLineage : []).forEach((e) => {
    if (e && e.phone) lineageByPhone.set(e.phone, e);
  });

  try {
    const phones = Array.isArray(job.candidatePhones) ? [...job.candidatePhones] : [];
    let attempted = 0;
    let apiAccepted = 0;
    let sendFailed = 0;
    let skippedAlreadyDelivered = job.counters?.skippedAlreadyDelivered || 0;
    let skippedInFlightDuplicate = job.counters?.skippedInFlightDuplicate || 0;
    const skippedGlobalRecentSuccess = job.counters?.skippedGlobalRecentSuccess || 0;

    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < phones.length; i += 1) {
      const fresh = await WhatsAppManualRecoveryJob.findById(jobId).select('cancelRequested').lean();
      if (fresh?.cancelRequested) {
        await WhatsAppManualRecoveryJob.updateOne(
          { _id: jobId },
          {
            $set: {
              status: 'cancelled',
              finishedAt: new Date(),
              lastProgressAt: new Date()
            }
          }
        );
        return;
      }

      const phone = phones[i];
      if (!phone) continue;

      const sub = await FormSubmission.findOne({ phone }).lean();
      if (!sub) {
        sendFailed += 1;
        await WhatsAppManualRecoveryJob.updateOne(
          { _id: jobId },
          {
            $set: {
              'counters.sendFailed': sendFailed,
              'counters.remaining': Math.max(0, phones.length - (i + 1)),
              lastProgressAt: new Date()
            }
          }
        );
        continue;
      }

      const lineage = lineageByPhone.get(phone) || {};
      const candidateCreatedAt = lineage.candidateCreatedAt || null;
      const guard = await isStillUnresolved(job.messageKind, phone, candidateCreatedAt);
      if (!guard.ok) {
        if (guard.reason === 'already_delivered_or_read') skippedAlreadyDelivered += 1;
        else if (guard.reason === 'newer_in_flight') skippedInFlightDuplicate += 1;
        await WhatsAppManualRecoveryJob.updateOne(
          { _id: jobId },
          {
            $set: {
              'counters.skippedAlreadyDelivered': skippedAlreadyDelivered,
              'counters.skippedInFlightDuplicate': skippedInFlightDuplicate,
              'counters.remaining': Math.max(0, phones.length - (i + 1)),
              lastProgressAt: new Date()
            }
          }
        );
        continue;
      }

      const withMeetingLink = job.messageKind === 'meet' || job.messageKind === '30min';
      const vars = buildSlotNotificationVariables(sub, { withMeetingLink });

      const maxA = Number(lineage.maxAttemptAtStart);
      const maxAttemptStart = Number.isFinite(maxA) && maxA > 0 ? maxA : 1;
      const nextAttempt = Math.min(6, maxAttemptStart + 1);
      const parentId =
        lineage.lastEventId && mongoose.Types.ObjectId.isValid(String(lineage.lastEventId))
          ? lineage.lastEventId
          : null;
      const canon =
        lineage.lineageId && mongoose.Types.ObjectId.isValid(String(lineage.lineageId))
          ? lineage.lineageId
          : null;

      attempted += 1;
      const r = await safeSendWhatsApp({
        phone10: phone,
        formSubmissionId: sub._id,
        vars,
        retryKind: job.messageKind,
        source: 'admin_manual',
        cronRunId: null,
        cronJobKey: null,
        sendFn,
        retryGroupId: batchRetryGroupId,
        attemptNumber: nextAttempt,
        parentMessageEventId: parentId,
        canonicalRetryGroupId: canon
      });
      if (r && r.success) apiAccepted += 1;
      else sendFailed += 1;

      /** Recompute recovered/inFlight from post-start rows so the UI sees live updates as
       *  webhooks arrive even before the job loop finishes. */
      const post = await computePostStartCounters({
        startedAt: job.startedAt,
        messageKind: job.messageKind,
        candidatePhones: phones
      });

      await WhatsAppManualRecoveryJob.updateOne(
        { _id: jobId },
        {
          $set: {
            'counters.attempted': attempted,
            'counters.apiAccepted': apiAccepted,
            'counters.sendFailed': sendFailed,
            'counters.skippedAlreadyDelivered': skippedAlreadyDelivered,
            'counters.skippedInFlightDuplicate': skippedInFlightDuplicate,
            'counters.skippedGlobalRecentSuccess': skippedGlobalRecentSuccess,
            'counters.remaining': Math.max(0, phones.length - (i + 1)),
            'counters.recovered': post.recovered,
            'counters.inFlight': post.inFlight,
            'counters.delivered': post.delivered,
            'counters.failed': post.failed,
            'counters.excluded': post.excluded,
            lastProgressAt: new Date()
          }
        }
      );
    }
    /* eslint-enable no-await-in-loop */

    /** Final post-start counter refresh after the loop completes; webhooks may
     *  continue to land for a while, so the controller endpoint also recomputes
     *  these on read. */
    const finalPost = await computePostStartCounters({
      startedAt: job.startedAt,
      messageKind: job.messageKind,
      candidatePhones: phones
    });
    await WhatsAppManualRecoveryJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'completed',
          finishedAt: new Date(),
          lastProgressAt: new Date(),
          'counters.remaining': 0,
          'counters.recovered': finalPost.recovered,
          'counters.inFlight': finalPost.inFlight,
          'counters.delivered': finalPost.delivered,
          'counters.failed': finalPost.failed,
          'counters.excluded': finalPost.excluded
        }
      }
    );
  } catch (e) {
    await WhatsAppManualRecoveryJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'failed',
          finishedAt: new Date(),
          errorSummary: (e && e.message ? String(e.message) : 'unknown error').slice(0, 2000),
          lastProgressAt: new Date()
        }
      }
    );
  }
}

/**
 * Helper used by the controller to kick a job off without blocking the request.
 */
function startJobAsync(jobId) {
  setImmediate(() => {
    executeJob(jobId).catch((e) => {
      console.error('[whatsappManualRecovery] executeJob failed', e && e.message ? e.message : e);
    });
  });
}

module.exports = {
  ALLOWED_MESSAGE_KINDS,
  buildPreview,
  executeJob,
  startJobAsync,
  isStillUnresolved,
  computePostStartCounters
};
