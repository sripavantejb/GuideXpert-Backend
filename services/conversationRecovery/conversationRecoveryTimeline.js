'use strict';

/**
 * Build full delivery / recovery timeline for a case.
 */

function pushStep(steps, key, label, at, meta = {}) {
  steps.push({
    key,
    label,
    at: at ? new Date(at).toISOString() : null,
    completed: Boolean(at),
    ...meta,
  });
}

function buildDeliveryTimeline({ caseDoc, attempts = [], snapshot = null } = {}) {
  const steps = [];
  const sorted = [...attempts].sort(
    (a, b) => Number(a.attemptNumber || 0) - Number(b.attemptNumber || 0)
  );
  const latest = sorted[sorted.length - 1] || null;

  if (latest) {
    pushStep(steps, 'queued', 'Queued', latest.queuedAt || latest.createdAt, {
      attemptNumber: latest.attemptNumber,
    });
    pushStep(steps, 'sent', 'Sent', latest.sentAt, {
      attemptNumber: latest.attemptNumber,
      gupshupMessageId: latest.gupshupMessageId || null,
    });
    pushStep(steps, 'delivered', 'Delivered', latest.deliveredAt, {
      attemptNumber: latest.attemptNumber,
    });
    pushStep(steps, 'read', 'Read', latest.readAt, {
      attemptNumber: latest.attemptNumber,
    });
    pushStep(steps, 'reply', 'Reply', latest.repliedAt, {
      attemptNumber: latest.attemptNumber,
    });
  } else {
    pushStep(steps, 'queued', 'Queued', null);
    pushStep(steps, 'sent', 'Sent', null);
    pushStep(steps, 'delivered', 'Delivered', null);
    pushStep(steps, 'read', 'Read', null);
    pushStep(steps, 'reply', 'Reply', null);
  }

  pushStep(steps, 'recovered', 'Recovered', caseDoc?.recoveredAt || null);
  pushStep(
    steps,
    'journey_completed',
    'Journey Completed',
    caseDoc?.journeyCompletedAfterRecovery
      ? caseDoc.updatedAt || caseDoc.recoveredAt
      : null,
    { bookingCompleted: Boolean(caseDoc?.bookingCompletedAfterRecovery) }
  );

  return {
    caseId: caseDoc?._id ? String(caseDoc._id) : null,
    phone: caseDoc?.phone || null,
    lastPhase: caseDoc?.lastPhase ?? snapshot?.lastPhase ?? null,
    status: caseDoc?.status || null,
    attempts: sorted.map((a) => ({
      attemptNumber: a.attemptNumber,
      idempotencyKey: a.idempotencyKey || null,
      deliveryStatus: a.deliveryStatus,
      failureReason: a.failureReason,
      queuedAt: a.queuedAt,
      sentAt: a.sentAt,
      deliveredAt: a.deliveredAt,
      readAt: a.readAt,
      repliedAt: a.repliedAt,
      failedAt: a.failedAt,
      messageBody: a.messageBody,
    })),
    steps,
  };
}

module.exports = {
  buildDeliveryTimeline,
};
