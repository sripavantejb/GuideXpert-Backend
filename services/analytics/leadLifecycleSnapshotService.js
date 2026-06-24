'use strict';

const LeadLifecycleEvent = require('../../models/LeadLifecycleEvent');
const LeadLifecycleSnapshot = require('../../models/LeadLifecycleSnapshot');
const { PRODUCT_LINES } = require('../../constants/leadLifecycle');
const { buildDateRangeFromQuery } = require('./leadLifecycleQueryUtils');
const {
  aggregateLifecycleMetrics,
  aggregateByProductLine,
} = require('./leadLifecycleAggregationService');

const COUNTING_METHOD = 'distinct_phone';

function buildRangeKey(query = {}) {
  const fromStr = String(query.from || query.fromDate || '').trim();
  const toStr = String(query.to || query.toDate || '').trim();
  if (!fromStr && !toStr && !query.preset) return 'all';
  const transitionAt = buildDateRangeFromQuery(query);
  if (!transitionAt) return 'all';
  const from = transitionAt.$gte ? transitionAt.$gte.toISOString().slice(0, 10) : 'start';
  const to = transitionAt.$lte
    ? transitionAt.$lte.toISOString().slice(0, 10)
    : transitionAt.$lt
      ? transitionAt.$lt.toISOString().slice(0, 10)
      : 'end';
  return `${from}|${to}`;
}

function snapshotToFunnelPayload(snapshot, productLine = 'all') {
  if (!snapshot) return null;
  const stageCounts = snapshot.stageCounts || {};
  const leadCount = stageCounts.lead || snapshot.cohortSize || 0;

  const stages = (snapshot.stages || []).length
    ? snapshot.stages
    : Object.entries(stageCounts).map(([stage, count]) => ({
        stage,
        count,
        rateFromLeadPct: leadCount ? Math.round((count / leadCount) * 1000) / 10 : 0,
        dropOffFromPreviousPct: 0,
      }));

  return {
    meta: {
      productLine,
      cohortSize: snapshot.cohortSize || 0,
      dateRange: snapshot.fromDate || snapshot.toDate
        ? { from: snapshot.fromDate, to: snapshot.toDate }
        : null,
      generatedAt: snapshot.generatedAt,
      rulesVersion: 'leadLifecycle.v1.2',
      countingMethod: snapshot.countingMethod || COUNTING_METHOD,
      snapshotId: snapshot._id,
      buildDurationMs: snapshot.buildDurationMs || 0,
      servedFromSnapshot: true,
    },
    stages,
    transitions: snapshot.transitions || [],
    byProductLine: snapshot.byProductLine || [],
    stageCounts,
  };
}

async function isSnapshotStale(snapshot) {
  if (!snapshot) return true;
  const currentCount = await LeadLifecycleEvent.estimatedDocumentCount();
  return Number(snapshot.eventCountAtGeneration) !== Number(currentCount);
}

async function buildSnapshot(query = {}, productLine = 'all') {
  const started = Date.now();
  const rangeKey = buildRangeKey(query);
  const fromDate = String(query.from || query.fromDate || '').trim() || null;
  const toDate = String(query.to || query.toDate || '').trim() || null;
  const eventCountAtGeneration = await LeadLifecycleEvent.estimatedDocumentCount();

  const metrics = await aggregateLifecycleMetrics(query, productLine);
  const byProductLine =
    productLine === 'all' ? await aggregateByProductLine(query) : [];

  const doc = {
    rangeKey,
    productLine,
    fromDate,
    toDate,
    cohortSize: metrics.cohortSize,
    stageCounts: metrics.stageCounts,
    stages: metrics.stages,
    transitions: metrics.transitions,
    byProductLine,
    countingMethod: COUNTING_METHOD,
    eventCountAtGeneration,
    buildDurationMs: Date.now() - started,
    generatedAt: new Date(),
  };

  const saved = await LeadLifecycleSnapshot.findOneAndUpdate(
    { rangeKey, productLine },
    { $set: doc },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return saved;
}

async function getOrBuildSnapshot(query = {}, productLine = 'all') {
  const rangeKey = buildRangeKey(query);
  let snapshot = await LeadLifecycleSnapshot.findOne({ rangeKey, productLine }).lean();
  if (await isSnapshotStale(snapshot)) {
    snapshot = await buildSnapshot(query, productLine);
  }
  return snapshot;
}

async function invalidateAllSnapshots() {
  const result = await LeadLifecycleSnapshot.deleteMany({});
  return result.deletedCount || 0;
}

async function warmDefaultSnapshots(query = {}) {
  const lines = ['all', ...PRODUCT_LINES];
  const snapshots = await Promise.all(lines.map((line) => getOrBuildSnapshot(query, line)));
  return snapshots.length;
}

module.exports = {
  COUNTING_METHOD,
  buildRangeKey,
  snapshotToFunnelPayload,
  isSnapshotStale,
  buildSnapshot,
  getOrBuildSnapshot,
  invalidateAllSnapshots,
  warmDefaultSnapshots,
};
