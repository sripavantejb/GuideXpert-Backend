'use strict';

const LeadLifecycleEvent = require('../../models/LeadLifecycleEvent');
const {
  LIFECYCLE_STAGES,
  PRODUCT_LINES,
} = require('../../constants/leadLifecycle');
const { buildDateRangeFromQuery, pct, medianMs } = require('./leadLifecycleQueryUtils');

function emptyStageCounts() {
  return Object.fromEntries(LIFECYCLE_STAGES.map((s) => [s, 0]));
}

function buildCohortLeadMatch(query = {}, productLine = null) {
  const transitionAt = buildDateRangeFromQuery(query);
  const leadMatch = { stage: 'lead' };
  if (transitionAt) leadMatch.transitionAt = transitionAt;
  if (productLine && productLine !== 'all') leadMatch.productLine = productLine;
  return leadMatch;
}

async function loadCohortMembers(leadMatch) {
  const rows = await LeadLifecycleEvent.aggregate([
    { $match: leadMatch },
    {
      $group: {
        _id: { phone10: '$phone10', productLine: '$productLine' },
      },
    },
    {
      $project: {
        _id: 0,
        phone10: '$_id.phone10',
        productLine: '$_id.productLine',
      },
    },
  ]);
  return rows;
}

function buildCohortKeySet(cohortMembers) {
  return new Set(cohortMembers.map((c) => `${c.productLine}:${c.phone10}`));
}

async function aggregatePhoneStageTimes(cohortMembers, productLineFilter = null) {
  if (!cohortMembers.length) return [];

  const phones = [...new Set(cohortMembers.map((c) => c.phone10))];
  const match = { phone10: { $in: phones } };
  if (productLineFilter && productLineFilter !== 'all') {
    match.productLine = productLineFilter;
  }

  return LeadLifecycleEvent.aggregate([
    { $match: match },
    { $sort: { transitionAt: 1 } },
    {
      $group: {
        _id: { phone10: '$phone10', productLine: '$productLine', stage: '$stage' },
        firstAt: { $first: '$transitionAt' },
      },
    },
    {
      $group: {
        _id: { phone10: '$_id.phone10', productLine: '$_id.productLine' },
        stageTimes: {
          $push: { stage: '$_id.stage', at: '$firstAt' },
        },
      },
    },
  ]);
}

function countDistinctStages(filteredRows) {
  const counts = emptyStageCounts();
  for (const row of filteredRows) {
    const seen = new Set();
    for (const item of row.stageTimes || []) {
      if (!item?.stage || seen.has(item.stage)) continue;
      seen.add(item.stage);
      if (counts[item.stage] != null) counts[item.stage] += 1;
    }
  }
  return counts;
}

function computeTransitions(filteredRows) {
  const pairs = [];
  for (let i = 0; i < LIFECYCLE_STAGES.length - 1; i += 1) {
    pairs.push({
      from: LIFECYCLE_STAGES[i],
      to: LIFECYCLE_STAGES[i + 1],
      durationsMs: [],
    });
  }

  for (const row of filteredRows) {
    const firstAtByStage = new Map();
    for (const item of row.stageTimes || []) {
      if (!item?.stage || firstAtByStage.has(item.stage)) continue;
      firstAtByStage.set(item.stage, new Date(item.at).getTime());
    }
    for (const pair of pairs) {
      const fromAt = firstAtByStage.get(pair.from);
      const toAt = firstAtByStage.get(pair.to);
      if (fromAt != null && toAt != null && toAt >= fromAt) {
        pair.durationsMs.push(toAt - fromAt);
      }
    }
  }

  return pairs.map((pair) => ({
    from: pair.from,
    to: pair.to,
    sampleSize: pair.durationsMs.length,
    medianMs: medianMs(pair.durationsMs),
  }));
}

function buildStagesArray(stageCounts, cohortSize) {
  const leadCount = stageCounts.lead || cohortSize || 0;
  return LIFECYCLE_STAGES.map((stage, idx) => {
    const count = stageCounts[stage] || 0;
    const prevStage = idx > 0 ? LIFECYCLE_STAGES[idx - 1] : null;
    const prevCount = prevStage ? stageCounts[prevStage] || 0 : leadCount;
    return {
      stage,
      count,
      rateFromLeadPct: pct(count, leadCount),
      dropOffFromPreviousPct: prevStage ? pct(prevCount - count, prevCount) : 0,
    };
  });
}

async function aggregateLifecycleMetrics(query = {}, productLine = 'all') {
  const leadMatch = buildCohortLeadMatch(query, productLine === 'all' ? null : productLine);
  const cohortMembers = await loadCohortMembers(leadMatch);
  const cohortKeySet = buildCohortKeySet(cohortMembers);

  const phoneStageGroups = await aggregatePhoneStageTimes(
    cohortMembers,
    productLine === 'all' ? null : productLine
  );

  const filtered = phoneStageGroups.filter((row) =>
    cohortKeySet.has(`${row._id.productLine}:${row._id.phone10}`)
  );

  const stageCounts = countDistinctStages(filtered);
  const transitions = computeTransitions(filtered);
  const cohortSize = cohortMembers.length;

  return {
    cohortSize,
    stageCounts,
    stages: buildStagesArray(stageCounts, cohortSize),
    transitions,
    cohortMembers,
    filteredRows: filtered,
  };
}

async function aggregateByProductLine(query = {}) {
  const leadMatch = buildCohortLeadMatch(query, null);
  const cohortMembers = await loadCohortMembers(leadMatch);
  const cohortKeySet = buildCohortKeySet(cohortMembers);
  const phoneStageGroups = await aggregatePhoneStageTimes(cohortMembers, null);

  const filtered = phoneStageGroups.filter((row) =>
    cohortKeySet.has(`${row._id.productLine}:${row._id.phone10}`)
  );

  const byLine = {};
  for (const line of PRODUCT_LINES) {
    byLine[line] = { productLine: line, cohortSize: 0, stageCounts: emptyStageCounts() };
  }

  for (const member of cohortMembers) {
    if (byLine[member.productLine]) {
      byLine[member.productLine].cohortSize += 1;
    }
  }

  for (const row of filtered) {
    const line = row._id.productLine;
    if (!byLine[line]) continue;
    const seen = new Set();
    for (const item of row.stageTimes || []) {
      if (!item?.stage || seen.has(item.stage)) continue;
      seen.add(item.stage);
      if (byLine[line].stageCounts[item.stage] != null) {
        byLine[line].stageCounts[item.stage] += 1;
      }
    }
  }

  return Object.values(byLine).map((entry) => ({
    productLine: entry.productLine,
    cohortSize: entry.cohortSize,
    stages: buildStagesArray(entry.stageCounts, entry.cohortSize),
    stageCounts: entry.stageCounts,
  }));
}

module.exports = {
  buildCohortLeadMatch,
  loadCohortMembers,
  aggregateLifecycleMetrics,
  aggregateByProductLine,
  buildStagesArray,
  emptyStageCounts,
  countDistinctStages,
  computeTransitions,
};
