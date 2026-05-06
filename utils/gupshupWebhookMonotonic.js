/**
 * Gupshup message-event lifecycle: submitted (API accept / enqueued) < sent < delivered < read;
 * failed (webhook async) overrides only before device delivery; send-time failed uses WhatsAppMessageEvent.failed / retry_exhausted.
 */

function rankSuccessStatus(status) {
  const s = status ? String(status).toLowerCase() : '';
  const table = {
    queued: 1,
    retry_pending: 2,
    submitted: 3,
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

function canApplyWebhookStatus(currentStatus, newStatus) {
  if (!newStatus) return false;
  const cur = String(currentStatus || '').toLowerCase();
  const next = String(newStatus).toLowerCase();
  if (cur === 'retry_exhausted') return false;
  if (next === 'failed') {
    if (isTerminalSendFailure(cur)) return false;
    if (rankSuccessStatus(cur) >= 5) return false;
    return true;
  }
  if (isTerminalSendFailure(cur)) return false;
  return rankSuccessStatus(next) > rankSuccessStatus(cur);
}

module.exports = {
  rankSuccessStatus,
  isTerminalSendFailure,
  mapStageToDbStatus,
  canApplyWebhookStatus
};
