'use strict';

const ExecutiveReportSnapshot = require('../../models/ExecutiveReportSnapshot');
const { getExecutiveSummary } = require('./analyticsExecutiveService');
const { getLifecycleFunnel } = require('./leadLifecycleFunnelService');
const { listAlerts } = require('./smartAlertsService');
const { getCounsellorPerformance } = require('./counsellorPerformanceService');
const { getFollowupEffectiveness } = require('./followupEffectivenessService');

function resolveReportDate(input) {
  const raw = String(input || '').trim();
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10))) {
    return raw.slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function previousReportDate(reportDate) {
  const d = new Date(`${reportDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function dayQuery(reportDate) {
  return { from: reportDate, to: reportDate, sinceDays: 1 };
}

function extractKpis(payload = {}) {
  const summary = payload.executiveSummary || {};
  return {
    lifecycleCohort: summary.leadVolume?.lifecycleCohort ?? 0,
    qualifiedLeads: summary.qualifiedAndHot?.qualifiedLeads ?? 0,
    hotLeads: summary.qualifiedAndHot?.hotLeads ?? 0,
    lifecycleBooked: summary.bookings?.lifecycleBooked ?? 0,
    lifecycleAdmission: summary.conversions?.lifecycleAdmission ?? 0,
    openAlerts: payload.alertsMeta?.openCount ?? (payload.alerts || []).length,
    followupsSent: payload.followupEffectiveness?.followupsSent ?? 0,
    replyRate: payload.followupEffectiveness?.replyRate ?? 0,
    conversionRate: payload.followupEffectiveness?.conversionRate ?? 0,
  };
}

function compareKpis(current = {}, previous = {}) {
  const keys = new Set([...Object.keys(current), ...Object.keys(previous)]);
  const comparison = {};
  for (const key of keys) {
    const cur = Number(current[key]) || 0;
    const prev = Number(previous[key]) || 0;
    comparison[key] = {
      current: cur,
      previous: prev,
      delta: Math.round((cur - prev) * 10) / 10,
    };
  }
  return comparison;
}

async function buildReportPayload(reportDate) {
  const query = dayQuery(reportDate);

  const [
    executiveSummary,
    alertsResult,
    lifecycleFunnel,
    counsellorPerformance,
    followupEffectiveness,
  ] = await Promise.all([
    getExecutiveSummary(query),
    listAlerts({ status: 'open,acknowledged', limit: 50 }),
    getLifecycleFunnel({ ...query, productLine: 'all' }),
    getCounsellorPerformance({ sinceDays: 1 }),
    getFollowupEffectiveness({ sinceDays: 1 }),
  ]);

  return {
    reportDate,
    generatedAt: new Date().toISOString(),
    executiveSummary,
    alerts: alertsResult.items || [],
    alertsMeta: alertsResult.meta || {},
    lifecycleFunnel,
    counsellorPerformance,
    followupEffectiveness,
    summary: extractKpis({
      executiveSummary,
      alertsMeta: alertsResult.meta,
      alerts: alertsResult.items,
      followupEffectiveness,
    }),
  };
}

async function generateDailyReport({ reportDate: inputDate, force = false, deliveryStatus = 'generated' } = {}) {
  const reportDate = resolveReportDate(inputDate);
  const existing = await ExecutiveReportSnapshot.findOne({ reportDate }).lean();

  if (existing && !force) {
    return {
      action: 'exists',
      report: existing,
      comparison: await module.exports.buildComparisonForReport(existing),
    };
  }

  const payload = await module.exports.buildReportPayload(reportDate);
  const saved = await ExecutiveReportSnapshot.findOneAndUpdate(
    { reportDate },
    {
      $set: {
        payload,
        generatedAt: new Date(),
        deliveryStatus,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return {
    action: existing ? 'regenerated' : 'created',
    report: saved,
    comparison: await module.exports.buildComparisonForReport(saved),
  };
}

async function buildComparisonForReport(report) {
  if (!report?.reportDate) return null;
  const prevDate = previousReportDate(report.reportDate);
  const previous = await ExecutiveReportSnapshot.findOne({ reportDate: prevDate }).lean();
  const currentKpis = report.payload?.summary || extractKpis(report.payload || {});
  const previousKpis = previous?.payload?.summary || extractKpis(previous?.payload || {});

  return {
    previousReportDate: prevDate,
    hasPrevious: Boolean(previous),
    kpis: compareKpis(currentKpis, previousKpis),
  };
}

async function getLatestReport() {
  const report = await ExecutiveReportSnapshot.findOne({})
    .sort({ reportDate: -1 })
    .lean();
  if (!report) return null;

  return {
    report,
    comparison: await module.exports.buildComparisonForReport(report),
  };
}

async function getReportByDate(reportDate) {
  const date = resolveReportDate(reportDate);
  const report = await ExecutiveReportSnapshot.findOne({ reportDate: date }).lean();
  if (!report) return null;
  return {
    report,
    comparison: await module.exports.buildComparisonForReport(report),
  };
}

async function getReportHistory(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 30, 1), 100);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    ExecutiveReportSnapshot.find({})
      .sort({ reportDate: -1 })
      .skip(skip)
      .limit(limit)
      .select('reportDate generatedAt deliveryStatus payload.summary')
      .lean(),
    ExecutiveReportSnapshot.countDocuments({}),
  ]);

  return {
    meta: { page, limit, total, generatedAt: new Date() },
    items: rows.map((row) => ({
      _id: row._id,
      reportDate: row.reportDate,
      generatedAt: row.generatedAt,
      deliveryStatus: row.deliveryStatus,
      summary: row.payload?.summary || {},
    })),
  };
}

module.exports = {
  resolveReportDate,
  previousReportDate,
  extractKpis,
  compareKpis,
  buildReportPayload,
  generateDailyReport,
  getLatestReport,
  getReportByDate,
  getReportHistory,
  buildComparisonForReport,
};
