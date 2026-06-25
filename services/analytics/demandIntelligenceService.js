'use strict';

const CollegePredictorSearchEvent = require('../../models/CollegePredictorSearchEvent');
const WhatsAppLeadProfile = require('../../models/WhatsAppLeadProfile');

const TREND_WINDOWS = Object.freeze([7, 30]);

function parseWindowDays(value, fallback = 7) {
  const parsed = parseInt(value, 10);
  if (parsed === 7 || parsed === 30) return parsed;
  return fallback;
}

function sinceDate(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function topCountsFromAggregation(rows, labelKey = 'label') {
  return rows.map((row) => ({
    label: row._id,
    count: row.count,
  }));
}

async function aggregateFieldCounts(field, since) {
  const rows = await CollegePredictorSearchEvent.aggregate([
    { $match: { searchedAt: { $gte: since } } },
    { $unwind: `$${field}` },
    { $match: { [field]: { $nin: [null, ''] } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 15 },
  ]);
  return topCountsFromAggregation(rows);
}

async function aggregateCollegeCounts(since) {
  const rows = await CollegePredictorSearchEvent.aggregate([
    { $match: { searchedAt: { $gte: since } } },
    { $unwind: '$collegeNames' },
    { $match: { collegeNames: { $nin: [null, ''] } } },
    { $group: { _id: '$collegeNames', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 15 },
  ]);
  return topCountsFromAggregation(rows);
}

async function aggregateSearchTrend(since) {
  const rows = await CollegePredictorSearchEvent.aggregate([
    { $match: { searchedAt: { $gte: since } } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$searchedAt', timezone: 'UTC' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((row) => ({ date: row._id, count: row.count }));
}

async function aggregateLeadInterest(field, since) {
  const match = {
    [field]: { $nin: [null, ''] },
    lastInteractionAt: { $gte: since },
  };
  const rows = await WhatsAppLeadProfile.aggregate([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
  return topCountsFromAggregation(rows);
}

function mergeRankedLists(primary = [], secondary = [], limit = 15) {
  const map = new Map();
  for (const row of primary) {
    map.set(row.label, (map.get(row.label) || 0) + row.count);
  }
  for (const row of secondary) {
    map.set(row.label, (map.get(row.label) || 0) + row.count);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

async function getDemandSummary(query = {}) {
  const windowDays = parseWindowDays(query.window ?? query.days, 7);
  const since = sinceDate(windowDays);
  const searchCount = await CollegePredictorSearchEvent.countDocuments({
    searchedAt: { $gte: since },
  });

  const [
    branches,
    categories,
    states,
    colleges,
    trend,
    profileColleges,
    profileBranches,
  ] = await Promise.all([
    aggregateFieldCounts('branchCodes', since),
    aggregateFieldCounts('categories', since),
    aggregateFieldCounts('districts', since),
    aggregateCollegeCounts(since),
    aggregateSearchTrend(since),
    aggregateLeadInterest('collegeInterest', since),
    aggregateLeadInterest('branchInterest', since),
  ]);

  const trends = {};
  for (const days of TREND_WINDOWS) {
    trends[`${days}d`] = await aggregateSearchTrend(sinceDate(days));
  }

  return {
    meta: {
      windowDays,
      since,
      generatedAt: new Date(),
      searchCount,
      sources: [
        'CollegePredictorSearchEvent',
        'WhatsAppLeadProfile.collegeInterest',
        'WhatsAppLeadProfile.branchInterest',
      ],
    },
    mostSearched: {
      colleges: mergeRankedLists(colleges, profileColleges),
      branches: mergeRankedLists(branches, profileBranches),
      categories,
      states,
    },
    trends,
    trend,
  };
}

module.exports = {
  getDemandSummary,
  parseWindowDays,
  mergeRankedLists,
  aggregateSearchTrend,
  TREND_WINDOWS,
};
