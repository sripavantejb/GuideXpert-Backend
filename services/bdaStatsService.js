const mongoose = require('mongoose');
const Bda = require('../models/Bda');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const IitCounsellingLeadActivity = require('../models/IitCounsellingLeadActivity');
const { resolveStatsDateRange } = require('../utils/statsDateRange');
const {
  CALL_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  DEMO_STATUS_LABELS,
} = require('../constants/iitCounsellingLeadCrm');

function pct(numerator, denominator) {
  if (!denominator || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function buildLeadSnapshotCounts(leads) {
  const counts = {
    totalAssigned: leads.length,
    notCalled: 0,
    callsConnected: 0,
    callsNotConnected: 0,
    interested: 0,
    notInterested: 0,
    demoScheduled: 0,
    demoAttended: 0,
    demoNotAttended: 0,
    niatRegistered: 0,
    paymentInitiated: 0,
    amountPaid: 0,
    callbackPending: 0,
    converted: 0,
    lost: 0,
    lastActivityAt: null,
  };

  for (const lead of leads) {
    if (lead.callStatus === 'not_called') counts.notCalled += 1;
    if (lead.callStatus === 'connected') counts.callsConnected += 1;
    if (lead.callStatus === 'not_connected') counts.callsNotConnected += 1;
    if (lead.leadStatus === 'interested') counts.interested += 1;
    if (lead.leadStatus === 'not_interested') counts.notInterested += 1;
    if (lead.leadStatus === 'callback_pending') counts.callbackPending += 1;
    if (lead.leadStatus === 'converted') counts.converted += 1;
    if (lead.leadStatus === 'lost') counts.lost += 1;
    if (lead.demoStatus === 'scheduled') counts.demoScheduled += 1;
    if (lead.demoStatus === 'attended') counts.demoAttended += 1;
    if (lead.demoStatus === 'not_attended') counts.demoNotAttended += 1;
    if (lead.niatStatus === 'registered') counts.niatRegistered += 1;
    if (lead.paymentStatus === 'initiated') counts.paymentInitiated += 1;
    if (lead.paymentStatus === 'paid') counts.amountPaid += 1;
    if (lead.lastActivityAt) {
      const t = new Date(lead.lastActivityAt).getTime();
      if (!counts.lastActivityAt || t > new Date(counts.lastActivityAt).getTime()) {
        counts.lastActivityAt = lead.lastActivityAt;
      }
    }
  }

  counts.callsDone = counts.callsConnected + counts.callsNotConnected;
  counts.conversionPct = pct(counts.converted, counts.totalAssigned);
  counts.paymentConversionPct = pct(counts.amountPaid, counts.totalAssigned);
  counts.demoAttendancePct = pct(counts.demoAttended, counts.demoScheduled);

  return counts;
}

async function countDistinctLeadsFromActivities(bdaId, eventType, toValue, dateRange) {
  const match = { bdaId: new mongoose.Types.ObjectId(bdaId), eventType, toValue };
  if (dateRange) {
    match.createdAt = { $gte: dateRange.start, $lt: dateRange.end };
  }
  const ids = await IitCounsellingLeadActivity.distinct('leadId', match);
  return ids.length;
}

async function getAssignedLeadsForBda(bdaId, dateRange) {
  const match = {
    submissionType: 'iitCounselling',
    assignedBdaId: new mongoose.Types.ObjectId(bdaId),
  };
  if (dateRange) {
    match.assignedAt = { $gte: dateRange.start, $lt: dateRange.end };
  }
  return IitCounsellingSubmission.find(match).lean();
}

async function computeBdaMetrics(bda, dateRange) {
  const bdaId = String(bda._id);
  let counts;

  if (dateRange) {
    const assignedLeads = await getAssignedLeadsForBda(bdaId, dateRange);
    const base = buildLeadSnapshotCounts(assignedLeads);
    base.totalAssigned = assignedLeads.length;

    const [
      callsConnected,
      callsNotConnected,
      interested,
      notInterested,
      callbackPending,
      converted,
      lost,
      demoScheduled,
      demoAttended,
      demoNotAttended,
      niatRegistered,
      paymentInitiated,
      amountPaid,
    ] = await Promise.all([
      countDistinctLeadsFromActivities(bdaId, 'call_status', 'connected', dateRange),
      countDistinctLeadsFromActivities(bdaId, 'call_status', 'not_connected', dateRange),
      countDistinctLeadsFromActivities(bdaId, 'lead_status', 'interested', dateRange),
      countDistinctLeadsFromActivities(bdaId, 'lead_status', 'not_interested', dateRange),
      countDistinctLeadsFromActivities(bdaId, 'lead_status', 'callback_pending', dateRange),
      countDistinctLeadsFromActivities(bdaId, 'lead_status', 'converted', dateRange),
      countDistinctLeadsFromActivities(bdaId, 'lead_status', 'lost', dateRange),
      countDistinctLeadsFromActivities(bdaId, 'demo_status', 'scheduled', dateRange),
      countDistinctLeadsFromActivities(bdaId, 'demo_status', 'attended', dateRange),
      countDistinctLeadsFromActivities(bdaId, 'demo_status', 'not_attended', dateRange),
      countDistinctLeadsFromActivities(bdaId, 'niat_status', 'registered', dateRange),
      countDistinctLeadsFromActivities(bdaId, 'payment_status', 'initiated', dateRange),
      countDistinctLeadsFromActivities(bdaId, 'payment_status', 'paid', dateRange),
    ]);

    counts = {
      ...base,
      callsConnected,
      callsNotConnected,
      interested,
      notInterested,
      callbackPending,
      converted,
      lost,
      demoScheduled,
      demoAttended,
      demoNotAttended,
      niatRegistered,
      paymentInitiated,
      amountPaid,
      notCalled: Math.max(0, base.totalAssigned - callsConnected - callsNotConnected),
    };
    counts.callsDone = callsConnected + callsNotConnected;
    counts.conversionPct = pct(counts.converted, counts.totalAssigned);
    counts.paymentConversionPct = pct(counts.amountPaid, counts.totalAssigned);
    counts.demoAttendancePct = pct(counts.demoAttended, counts.demoScheduled);
  } else {
    const leads = await IitCounsellingSubmission.find({
      submissionType: 'iitCounselling',
      assignedBdaId: bda._id,
    }).lean();
    counts = buildLeadSnapshotCounts(leads);
  }

  return {
    bdaId,
    id: bdaId,
    name: bda.name,
    phone: bda.phone || '',
    email: bda.email || '',
    status: bda.status,
    joinedAt: bda.joinedAt || bda.createdAt,
    ...counts,
  };
}

async function getAllBdaStats(query = {}) {
  const dateRange = resolveStatsDateRange(query);
  const statusFilter = query.status === 'inactive' ? 'inactive' : query.status === 'all' ? null : 'active';
  const bdaFilter = statusFilter ? { status: statusFilter } : {};
  const bdas = await Bda.find(bdaFilter).sort({ name: 1 }).lean();
  const rows = await Promise.all(bdas.map((bda) => computeBdaMetrics(bda, dateRange)));
  return { dateRange, rows };
}

async function getBdaStatsById(bdaId, query = {}) {
  const bda = await Bda.findById(bdaId).lean();
  if (!bda) return null;
  const dateRange = resolveStatsDateRange(query);
  const metrics = await computeBdaMetrics(bda, dateRange);

  const activityMatch = { bdaId: bda._id };
  if (dateRange) {
    activityMatch.createdAt = { $gte: dateRange.start, $lt: dateRange.end };
  }
  const recentActivities = await IitCounsellingLeadActivity.find(activityMatch)
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return {
    dateRange,
    bda: {
      id: bda._id,
      name: bda.name,
      phone: bda.phone || '',
      email: bda.email || '',
      status: bda.status,
      joinedAt: bda.joinedAt || bda.createdAt,
    },
    metrics,
    recentActivities: recentActivities.map(formatActivityRow),
  };
}

function formatActivityRow(act) {
  const label = formatActivityLabel(act);
  return {
    id: act._id,
    leadId: act.leadId,
    bdaId: act.bdaId,
    bdaName: act.bdaName,
    eventType: act.eventType,
    fromValue: act.fromValue,
    toValue: act.toValue,
    remark: act.remark || '',
    actorName: act.actorName || '',
    createdAt: act.createdAt,
    label,
  };
}

function formatActivityLabel(act) {
  const name = act.bdaName || act.actorName || 'Admin';
  if (act.eventType === 'assignment') {
    return `${name} — Assigned`;
  }
  if (act.eventType === 'remark') {
    return `${name} — Remark`;
  }
  const typeLabels = {
    call_status: 'Call',
    lead_status: 'Lead',
    demo_status: 'Demo',
    niat_status: 'NIAT',
    payment_status: 'Payment',
    callback_date: 'Callback',
  };
  const prefix = typeLabels[act.eventType] || act.eventType;
  const toLabel =
    (act.eventType === 'call_status' && CALL_STATUS_LABELS[act.toValue]) ||
    (act.eventType === 'lead_status' && LEAD_STATUS_LABELS[act.toValue]) ||
    (act.eventType === 'demo_status' && DEMO_STATUS_LABELS[act.toValue]) ||
    act.toValue ||
    '';
  return `${name} — ${prefix}${toLabel ? ` — ${toLabel}` : ''}`;
}

async function getTeamDashboardStats(query = {}) {
  const dateRange = resolveStatsDateRange(query);
  const [totalBdas, activeBdas, allBdaStats] = await Promise.all([
    Bda.countDocuments({}),
    Bda.countDocuments({ status: 'active' }),
    getAllBdaStats({ ...query, status: 'all' }),
  ]);

  const unassignedMatch = {
    submissionType: 'iitCounselling',
    $or: [{ assignedBdaId: null }, { assignedBdaId: { $exists: false } }],
  };
  const unassignedLeads = await IitCounsellingSubmission.countDocuments(unassignedMatch);

  const sum = (key) => allBdaStats.rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

  return {
    dateRange,
    totalBdas,
    activeBdas,
    totalAssignedLeads: sum('totalAssigned'),
    unassignedLeads,
    totalConnectedCalls: sum('callsConnected'),
    totalInterestedLeads: sum('interested'),
    totalDemoAttended: sum('demoAttended'),
    totalNiatRegistered: sum('niatRegistered'),
    totalAmountPaid: sum('amountPaid'),
    totalCallbackPending: sum('callbackPending'),
  };
}

async function getLeaderboard(query = {}, limit = 10) {
  const { rows } = await getAllBdaStats(query);
  const activeRows = rows.filter((r) => r.status !== 'inactive');

  const byConversion = [...activeRows].sort((a, b) => {
    if (b.conversionPct !== a.conversionPct) return b.conversionPct - a.conversionPct;
    if (b.callsConnected !== a.callsConnected) return b.callsConnected - a.callsConnected;
    return (a.name || '').localeCompare(b.name || '');
  });

  const table = byConversion.map((row, idx) => ({
    rank: idx + 1,
    bdaId: row.bdaId,
    name: row.name,
    assignedLeads: row.totalAssigned,
    connected: row.callsConnected,
    demoAttended: row.demoAttended,
    registered: row.niatRegistered,
    paid: row.amountPaid,
    conversionPct: row.conversionPct,
  }));

  const topN = (key) =>
    [...activeRows]
      .sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))
      .slice(0, limit)
      .map((r) => ({ bdaId: r.bdaId, name: r.name, value: r[key] }));

  return {
    table,
    tops: {
      connected: topN('callsConnected'),
      interested: topN('interested'),
      demoAttended: topN('demoAttended'),
      niatRegistered: topN('niatRegistered'),
      paid: topN('amountPaid'),
    },
  };
}

module.exports = {
  resolveStatsDateRange,
  computeBdaMetrics,
  getAllBdaStats,
  getBdaStatsById,
  getTeamDashboardStats,
  getLeaderboard,
  formatActivityRow,
  buildLeadSnapshotCounts,
};
