'use strict';

const { STAGE_RANK } = require('../../constants/leadLifecycle');

function buildDedupeKey({ productLine, sourceId, stage }) {
  return `${productLine}:${String(sourceId)}:${stage}`;
}

/**
 * @param {object} params
 * @returns {object|null} LeadLifecycleEvent plain object or null if invalid
 */
function buildLifecycleEvent({
  phone10,
  productLine,
  stage,
  previousStage = null,
  sourceCollection,
  sourceId,
  transitionAt,
  meta = {},
}) {
  if (!phone10 || !/^\d{10}$/.test(phone10) || !sourceId || !transitionAt || !stage) {
    return null;
  }
  const at = transitionAt instanceof Date ? transitionAt : new Date(transitionAt);
  if (Number.isNaN(at.getTime())) {
    return null;
  }

  const inferred = meta.inferred === true;
  const proxyField = meta.proxyField || null;
  const confidence = meta.confidence || (inferred ? 'medium' : 'high');

  return {
    dedupeKey: buildDedupeKey({ productLine, sourceId, stage }),
    phone10,
    productLine,
    stage,
    previousStage,
    sourceCollection,
    sourceId,
    transitionAt: at,
    meta: {
      inferred,
      proxyField,
      confidence,
      utm_source: meta.utm_source || null,
      assignedBdaId: meta.assignedBdaId || null,
      leadScore: meta.leadScore ?? null,
      leadStage: meta.leadStage || null,
      note: meta.note || null,
    },
    backfilledAt: new Date(),
  };
}

function inferPreviousStage(stage) {
  const rank = STAGE_RANK[stage];
  if (rank == null || rank <= 0) return null;
  return Object.keys(STAGE_RANK).find((s) => STAGE_RANK[s] === rank - 1) || null;
}

function pushEvent(events, params) {
  const doc = buildLifecycleEvent(params);
  if (doc) {
    events.push(doc);
  }
  return doc;
}

module.exports = {
  buildDedupeKey,
  buildLifecycleEvent,
  inferPreviousStage,
  pushEvent,
};
