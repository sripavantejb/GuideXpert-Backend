'use strict';

const AnalyticsAlert = require('../../models/AnalyticsAlert');
const WhatsAppLeadScore = require('../../models/WhatsAppLeadScore');
const WhatsAppLeadProfile = require('../../models/WhatsAppLeadProfile');
const IitCounsellingSubmission = require('../../models/IitCounsellingSubmission');
const WhatsAppAgentHandoff = require('../../models/WhatsAppAgentHandoff');
const {
  OPEN_ALERT_STATUSES,
  HOT_LEAD_INACTIVITY_DAYS,
  COUNSELLOR_OVERLOAD_ASSIGNED_THRESHOLD,
  CONVERSION_DROP_THRESHOLD_PCT,
  OPERATIONAL_ACTIVE_HANDOFF_THRESHOLD,
  OPERATIONAL_SLOW_RESPONSE_MS,
} = require('../../constants/analyticsAlerts');
const { getCopilotHotLeadThreshold } = require('../chatbot/humanCopilot/humanCopilotFlags');
const { getAnalyticsOverview, getAnalyticsWorkloads } = require('../chatbot/humanCopilot/humanCopilotAnalyticsService');
const { getOrBuildSnapshot } = require('./leadLifecycleSnapshotService');
const { normalizePhone10Strict } = require('../../utils/phoneNormalize');

function buildDedupeKey(type, productLine, entityKey) {
  return `${type}:${productLine || 'all'}:${String(entityKey)}`;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function pctDrop(previous, current) {
  if (!previous) return 0;
  return Math.round(((previous - current) / previous) * 1000) / 10;
}

async function upsertAlert(payload) {
  const now = new Date();
  const doc = {
    type: payload.type,
    severity: payload.severity,
    status: 'open',
    title: payload.title,
    message: payload.message,
    productLine: payload.productLine || 'all',
    meta: payload.meta || {},
    dedupeKey: payload.dedupeKey,
    triggeredAt: payload.triggeredAt || now,
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
  };

  const existing = await AnalyticsAlert.findOne({ dedupeKey: doc.dedupeKey }).lean();
  if (existing && existing.status === 'resolved') {
    return { action: 'skipped_resolved', alert: existing };
  }

  const saved = await AnalyticsAlert.findOneAndUpdate(
    { dedupeKey: doc.dedupeKey },
    {
      $set: {
        type: doc.type,
        severity: doc.severity,
        title: doc.title,
        message: doc.message,
        productLine: doc.productLine,
        meta: doc.meta,
        triggeredAt: doc.triggeredAt,
      },
      $setOnInsert: {
        dedupeKey: doc.dedupeKey,
        status: 'open',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return {
    action: existing ? 'updated' : 'created',
    alert: saved,
  };
}

async function evaluateHotLeadInactivity() {
  const cutoff = daysAgo(HOT_LEAD_INACTIVITY_DAYS);
  const hotScores = await WhatsAppLeadScore.find({ leadStage: 'hot' })
    .select('phone leadScore lastScoredAt')
    .lean();
  const phones = hotScores.map((s) => s.phone).filter(Boolean);
  const profiles = await WhatsAppLeadProfile.find({ phone: { $in: phones } })
    .select('phone lastInteractionAt')
    .lean();
  const profileByPhone = new Map(profiles.map((p) => [p.phone, p]));

  const results = [];
  for (const score of hotScores) {
    const profile = profileByPhone.get(score.phone);
    const lastAt = profile?.lastInteractionAt || score.lastScoredAt;
    if (!lastAt || new Date(lastAt) >= cutoff) continue;

    const inactiveDays = Math.floor((Date.now() - new Date(lastAt).getTime()) / (24 * 60 * 60 * 1000));
    const dedupeKey = buildDedupeKey('hot_lead_inactivity', 'whatsapp', score.phone);
    results.push(
      await upsertAlert({
        type: 'hot_lead_inactivity',
        severity: inactiveDays >= 7 ? 'critical' : 'high',
        title: `Hot lead inactive ${inactiveDays}d`,
        message: `Phone ${score.phone} is hot (score ${score.leadScore ?? '—'}) with no interaction for ${inactiveDays} days.`,
        productLine: 'whatsapp',
        dedupeKey,
        meta: {
          phone: score.phone,
          leadScore: score.leadScore ?? null,
          inactiveDays,
          lastInteractionAt: lastAt,
        },
      })
    );
  }
  return results;
}

async function evaluateUnassignedHighValueLeads() {
  const hotThreshold = getCopilotHotLeadThreshold();
  const unassigned = await IitCounsellingSubmission.find({
    submissionType: 'iitCounselling',
    $or: [{ assignedBdaId: null }, { assignedBdaId: { $exists: false } }],
    leadStatus: { $in: ['interested', 'callback_pending', 'converted'] },
  })
    .select('phone fullName leadStatus createdAt')
    .lean();

  const phones = unassigned.map((l) => normalizePhone10Strict(l.phone)).filter(Boolean);
  const hotScores = await WhatsAppLeadScore.find({
    phone: { $in: phones },
    $or: [{ leadStage: 'hot' }, { leadScore: { $gte: hotThreshold } }],
  })
    .select('phone leadScore leadStage')
    .lean();
  const hotPhoneSet = new Set(hotScores.map((s) => s.phone));

  const results = [];
  for (const lead of unassigned) {
    const phone10 = normalizePhone10Strict(lead.phone);
    const isHot = phone10 && hotPhoneSet.has(phone10);
    const isHighValue = isHot || ['interested', 'callback_pending'].includes(lead.leadStatus);
    if (!isHighValue) continue;

    const dedupeKey = buildDedupeKey('unassigned_high_value_lead', 'iit', String(lead._id));
    results.push(
      await upsertAlert({
        type: 'unassigned_high_value_lead',
        severity: isHot ? 'critical' : 'high',
        title: 'Unassigned high-value IIT lead',
        message: `${lead.fullName || 'IIT lead'} (${phone10 || 'no phone'}) is unassigned with status ${lead.leadStatus}.`,
        productLine: 'iit',
        dedupeKey,
        meta: {
          leadId: String(lead._id),
          phone: phone10,
          leadStatus: lead.leadStatus,
          isHot,
        },
      })
    );
  }
  return results;
}

async function evaluateCounsellorOverload() {
  const workloads = await getAnalyticsWorkloads({ sinceDays: 7 });
  const results = [];

  for (const [sr, data] of Object.entries(workloads.data || {})) {
    if (!data || data.assigned < COUNSELLOR_OVERLOAD_ASSIGNED_THRESHOLD) continue;
    const utilization = data.assigned ? Math.round((data.resolved / data.assigned) * 100) : 0;
    const dedupeKey = buildDedupeKey('counsellor_overload', 'copilot', sr);
    results.push(
      await upsertAlert({
        type: 'counsellor_overload',
        severity: data.assigned >= COUNSELLOR_OVERLOAD_ASSIGNED_THRESHOLD * 2 ? 'critical' : 'high',
        title: `Counsellor ${sr} overloaded`,
        message: `${sr} has ${data.assigned} assigned sessions (${data.resolved} resolved, ${utilization}% resolution rate).`,
        productLine: 'copilot',
        dedupeKey,
        meta: {
          counsellorId: sr,
          assigned: data.assigned,
          resolved: data.resolved,
          utilizationPct: utilization,
          avgFirstResponseMs: data.avgFirstResponseMs,
        },
      })
    );
  }
  return results;
}

async function evaluateConversionDrop() {
  const now = new Date();
  const currentFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const currentTo = now.toISOString().slice(0, 10);
  const priorFrom = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const priorTo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [currentSnap, priorSnap] = await Promise.all([
    getOrBuildSnapshot({ from: currentFrom, to: currentTo }, 'all'),
    getOrBuildSnapshot({ from: priorFrom, to: priorTo }, 'all'),
  ]);

  const currentLead = currentSnap?.stageCounts?.lead || currentSnap?.cohortSize || 0;
  const priorLead = priorSnap?.stageCounts?.lead || priorSnap?.cohortSize || 0;
  const currentAdmission = currentSnap?.stageCounts?.admission || 0;
  const priorAdmission = priorSnap?.stageCounts?.admission || 0;

  const currentRate = currentLead ? (currentAdmission / currentLead) * 100 : 0;
  const priorRate = priorLead ? (priorAdmission / priorLead) * 100 : 0;
  const dropPct = pctDrop(priorRate, currentRate);

  const results = [];
  if (dropPct >= CONVERSION_DROP_THRESHOLD_PCT && priorLead > 0) {
    const dedupeKey = buildDedupeKey('conversion_drop', 'all', '7d');
    results.push(
      await upsertAlert({
        type: 'conversion_drop',
        severity: dropPct >= 30 ? 'critical' : 'high',
        title: 'Conversion rate dropped week-over-week',
        message: `Admission rate fell from ${Math.round(priorRate * 10) / 10}% to ${Math.round(currentRate * 10) / 10}% (${dropPct}% drop).`,
        productLine: 'all',
        dedupeKey,
        meta: {
          currentRate: Math.round(currentRate * 10) / 10,
          priorRate: Math.round(priorRate * 10) / 10,
          dropPct,
          currentAdmission,
          priorAdmission,
          windowDays: 7,
        },
      })
    );
  }
  return results;
}

async function evaluateOperationalHealth() {
  const overview = await getAnalyticsOverview({ sinceDays: 7 });
  const active = overview?.data?.volume?.active ?? 0;
  const avgFirstResponseMs = overview?.data?.responseTimes?.avgFirstResponseMs ?? 0;

  const issues = [];
  if (active >= OPERATIONAL_ACTIVE_HANDOFF_THRESHOLD) {
    issues.push(`${active} active handoffs in queue`);
  }
  if (avgFirstResponseMs >= OPERATIONAL_SLOW_RESPONSE_MS) {
    issues.push(`avg first response ${Math.round(avgFirstResponseMs / 60000)} min`);
  }

  const failedReplies = await WhatsAppAgentHandoff.aggregate([
    {
      $match: {
        route: 'admin_pool',
        createdAt: { $gte: daysAgo(7) },
      },
    },
    { $unwind: '$copilotReplies' },
    { $match: { 'copilotReplies.status': 'failed' } },
    { $count: 'count' },
  ]);
  const failedCount = failedReplies[0]?.count || 0;
  if (failedCount >= 5) {
    issues.push(`${failedCount} failed copilot sends (7d)`);
  }

  const results = [];
  if (!issues.length) return results;

  const dedupeKey = buildDedupeKey('operational_health', 'all', '7d');
  results.push(
    await upsertAlert({
      type: 'operational_health',
      severity: active >= OPERATIONAL_ACTIVE_HANDOFF_THRESHOLD * 2 ? 'critical' : 'medium',
      title: 'Operational health degraded',
      message: issues.join('; '),
      productLine: 'all',
      dedupeKey,
      meta: {
        activeHandoffs: active,
        avgFirstResponseMs,
        failedReplies: failedCount,
        issues,
      },
    })
  );
  return results;
}

async function evaluateAllAlerts() {
  const started = Date.now();
  const sections = await Promise.all([
    evaluateHotLeadInactivity(),
    evaluateUnassignedHighValueLeads(),
    evaluateCounsellorOverload(),
    evaluateConversionDrop(),
    evaluateOperationalHealth(),
  ]);

  const flat = sections.flat();
  const created = flat.filter((r) => r.action === 'created').length;
  const updated = flat.filter((r) => r.action === 'updated').length;
  const skipped = flat.filter((r) => r.action === 'skipped_resolved').length;

  return {
    evaluatedAt: new Date(),
    durationMs: Date.now() - started,
    created,
    updated,
    skipped,
    totalCandidates: flat.length,
    byType: {
      hot_lead_inactivity: sections[0].length,
      unassigned_high_value_lead: sections[1].length,
      counsellor_overload: sections[2].length,
      conversion_drop: sections[3].length,
      operational_health: sections[4].length,
    },
  };
}

function parseListFilters(query = {}) {
  const filter = {};
  if (query.status) {
    const statuses = String(query.status)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length) filter.status = { $in: statuses };
  } else {
    filter.status = { $in: OPEN_ALERT_STATUSES };
  }
  if (query.severity) {
    const severities = String(query.severity)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (severities.length) filter.severity = { $in: severities };
  }
  if (query.productLine && query.productLine !== 'all') {
    filter.productLine = String(query.productLine).trim();
  }
  if (query.type) {
    filter.type = String(query.type).trim();
  }
  return filter;
}

async function listAlerts(query = {}) {
  const filter = parseListFilters(query);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const skip = (page - 1) * limit;

  const [items, total, openCount] = await Promise.all([
    AnalyticsAlert.find(filter).sort({ triggeredAt: -1 }).skip(skip).limit(limit).lean(),
    AnalyticsAlert.countDocuments(filter),
    AnalyticsAlert.countDocuments({ status: { $in: OPEN_ALERT_STATUSES } }),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
      openCount,
      generatedAt: new Date(),
    },
    items,
  };
}

async function acknowledgeAlert(alertId, adminId) {
  const alert = await AnalyticsAlert.findOneAndUpdate(
    { _id: alertId, status: 'open' },
    {
      $set: {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedBy: adminId || null,
      },
    },
    { new: true }
  ).lean();
  if (!alert) {
    return { error: 'Alert not found or not open', status: 404 };
  }
  return { alert };
}

async function resolveAlert(alertId, adminId) {
  const alert = await AnalyticsAlert.findOneAndUpdate(
    { _id: alertId, status: { $in: OPEN_ALERT_STATUSES } },
    {
      $set: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: adminId || null,
      },
    },
    { new: true }
  ).lean();
  if (!alert) {
    return { error: 'Alert not found or already resolved', status: 404 };
  }
  return { alert };
}

module.exports = {
  buildDedupeKey,
  upsertAlert,
  evaluateHotLeadInactivity,
  evaluateUnassignedHighValueLeads,
  evaluateCounsellorOverload,
  evaluateConversionDrop,
  evaluateOperationalHealth,
  evaluateAllAlerts,
  listAlerts,
  acknowledgeAlert,
  resolveAlert,
  parseListFilters,
};
