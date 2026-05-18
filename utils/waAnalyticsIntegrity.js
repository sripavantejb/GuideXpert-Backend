/**
 * Analytics invariant checks for recipient-primary WhatsApp ops payloads.
 */

/**
 * @param {{ recipientTotals?: object, outcomeBreakdown?: object, retryFunnelByAttempt?: object, retryFunnelReconciliation?: object[] }} payload
 * @returns {{ ok: boolean, violations: string[] }}
 */
function validateRecipientAnalyticsInvariants(payload) {
  const violations = [];
  const rt = payload?.recipientTotals || {};
  const ob = payload?.outcomeBreakdown || rt.outcomeBreakdown || {};
  const total = Number(rt.totalRecipients) || 0;

  const sumBuckets =
    (ob.delivered || 0) +
    (ob.permanentFailed || 0) +
    (ob.reconcilePending || 0) +
    (ob.transientUnresolved || 0) +
    (ob.other || 0);

  if (total > 0 && sumBuckets !== total) {
    violations.push(
      `outcomeBreakdown sum ${sumBuckets} !== totalRecipients ${total}`
    );
  }

  if (total > 0 && (rt.delivered || 0) + (rt.transientUnresolved || 0) > total) {
    violations.push('delivered + transientUnresolved exceeds totalRecipients');
  }

  const funnel = payload?.retryFunnelByAttempt || {};
  [1, 2, 3].forEach((n) => {
    const s = funnel[n];
    if (!s) return;
    const t = s.targetedRecipients || 0;
    const parts = (s.delivered || 0) + (s.failed || 0) + (s.inFlight || 0) + (s.excluded || 0);
    if (t > 0 && parts > t * 2) {
      violations.push(`funnel attempt ${n}: stage parts may double-count (targeted=${t}, parts=${parts})`);
    }
  });

  const bridges = payload?.retryFunnelReconciliation || [];
  bridges.forEach((b) => {
    const cf = Number(b.carriedForward) || 0;
    const sum =
      (Number(b.recoveredOnRetry) || 0) +
      (Number(b.stillUnresolved) || 0) +
      (Number(b.excluded) || 0) +
      (Number(b.permanentFailed) || 0) +
      (Number(b.inFlightTolerance) || 0);
    if (cf > 0 && sum > cf + 2) {
      violations.push(
        `reconciliation ${b.fromAttempt}->${b.toAttempt}: bridge sum ${sum} exceeds carriedForward ${cf}`
      );
    }
  });

  if ((rt.excludedTotal || rt.excluded) > total && total > 0) {
    violations.push('excluded count exceeds totalRecipients');
  }

  return { ok: violations.length === 0, violations };
}

module.exports = {
  validateRecipientAnalyticsInvariants
};
