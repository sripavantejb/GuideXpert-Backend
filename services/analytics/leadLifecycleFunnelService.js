'use strict';

const { LIFECYCLE_STAGES } = require('../../constants/leadLifecycle');
const {
  parseProductLine,
  buildDateRangeFromQuery,
  pct,
  medianMs,
} = require('./leadLifecycleQueryUtils');
const {
  getOrBuildSnapshot,
  snapshotToFunnelPayload,
} = require('./leadLifecycleSnapshotService');

async function getLifecycleFunnel(query = {}) {
  const productLineParsed = parseProductLine(query.productLine);
  if (productLineParsed?.error) {
    return { error: productLineParsed.error, status: 400 };
  }

  const productLine = productLineParsed || 'all';
  const snapshot = await getOrBuildSnapshot(query, productLine);

  if (!snapshot || snapshot.cohortSize === 0) {
    return {
      meta: {
        productLine,
        cohortSize: 0,
        generatedAt: new Date(),
        rulesVersion: 'leadLifecycle.v1.2',
        countingMethod: 'distinct_phone',
        servedFromSnapshot: false,
      },
      stages: LIFECYCLE_STAGES.map((stage) => ({
        stage,
        count: 0,
        rateFromLeadPct: 0,
        dropOffFromPreviousPct: 0,
      })),
      transitions: [],
      byProductLine: [],
    };
  }

  return snapshotToFunnelPayload(snapshot, productLine);
}

module.exports = {
  getLifecycleFunnel,
  parseProductLine,
  buildDateRangeFromQuery,
  pct,
  medianMs,
};
