/**
 * Derived UI status for submissions (used in admin aggregates / tables).
 */

function deriveSubmissionWaStatus(doc) {
  if (!doc) return 'unknown';
  const n = Number(doc.whatsappRetryCount || 0);
  if (n >= 3 && doc.whatsappRetryKind) return 'retry_exhausted';
  if (
    doc.whatsappRetryKind &&
    n > 0 &&
    n < 3 &&
    doc.lastWhatsappAttemptAt &&
    Date.now() - new Date(doc.lastWhatsappAttemptAt).getTime() >= 5 * 60 * 1000
  ) {
    return 'retry_pending';
  }
  if (doc.whatsappDeliveryStatus) {
    const s = String(doc.whatsappDeliveryStatus).toLowerCase();
    if (s.includes('read')) return 'read';
    if (s.includes('deliver')) return 'delivered';
    if (s.includes('fail')) return 'failed';
    if (s.includes('sent') || s.includes('submit')) return 'sent';
  }
  if (doc.whatsappLastMessageId && !doc.whatsappLastError) return 'submitted';
  if (doc.whatsappLastError) return 'failed';
  return 'unknown';
}

module.exports = {
  deriveSubmissionWaStatus
};
