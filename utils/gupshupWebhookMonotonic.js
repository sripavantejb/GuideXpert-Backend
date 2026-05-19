/**
 * Gupshup message-event lifecycle: submitted (API accept / enqueued) < sent < delivered < read;
 * awaiting_final_dlr is soft reconcile grace (same rank band as sent);
 * failed (webhook async) overrides only before device delivery; reconcile-derived failed may recover on late DLR.
 */

const { RECONCILE_PENDING_STATUSES } = require('./whatsappRetryRules');

function rankSuccessStatus(status) {
  const s = status ? String(status).toLowerCase() : '';
  const table = {
    queued: 1,
    retry_pending: 2,
    submitted: 3,
    awaiting_final_dlr: 3,
    sent: 4,
    delivered: 5,
    read: 6
  };
  return table[s] != null ? table[s] : 0;
}

function isTerminalSendFailure(status) {
  const s = status ? String(status).toLowerCase() : '';
  return s === 'failed' || s === 'retry_exhausted';
}

function isReconcilePendingStatus(status) {
  return RECONCILE_PENDING_STATUSES.includes(String(status || '').toLowerCase());
}

function mapStageToDbStatus(stage) {
  if (!stage) return null;
  const v = String(stage).toLowerCase();
  if (v === 'enqueued') return 'submitted';
  if (v === 'sent') return 'sent';
  if (v === 'delivered') return 'delivered';
  if (v === 'read') return 'read';
  if (v === 'failed') return 'failed';
  return null;
}

/**
 * @param {string} currentStatus
 * @param {string} newStatus
 * @param {{ reconcileDerivedFailure?: boolean, terminalFailureKind?: string|null, retryExclusionReason?: string|null }} [opts]
 */
function canApplyWebhookStatus(currentStatus, newStatus, opts = {}) {
  if (!newStatus) return false;
  const cur = String(currentStatus || '').toLowerCase();
  const next = String(newStatus).toLowerCase();
  const reconcileDerived = opts.reconcileDerivedFailure === true;
  const permanentTerminal =
    opts.terminalFailureKind === 'permanent' ||
    opts.retryExclusionReason === 'permanent_failure';

  if (cur === 'retry_exhausted') {
    if (
      opts.allowTerminalRecovery === true &&
      rankSuccessStatus(next) >= 5 &&
      !permanentTerminal
    ) {
      return true;
    }
    return false;
  }

  if (next === 'failed') {
    if (isTerminalSendFailure(cur)) return false;
    if (rankSuccessStatus(cur) >= 5) return false;
    return true;
  }

  if (isTerminalSendFailure(cur)) {
    if (permanentTerminal) return false;
    // Handset DLR (delivered/read) overrides send-time `failed` when failure was not permanent.
    if (rankSuccessStatus(next) >= 5) return true;
    if (reconcileDerived && rankSuccessStatus(next) > rankSuccessStatus(cur)) return true;
    return false;
  }

  if (isReconcilePendingStatus(cur)) {
    if (next === 'failed') return true;
    return rankSuccessStatus(next) > rankSuccessStatus(cur);
  }

  return rankSuccessStatus(next) > rankSuccessStatus(cur);
}

module.exports = {
  rankSuccessStatus,
  isTerminalSendFailure,
  isReconcilePendingStatus,
  mapStageToDbStatus,
  canApplyWebhookStatus
};
