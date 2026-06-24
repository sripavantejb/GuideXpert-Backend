'use strict';

const { getLeadStats } = require('../chatbot/leadInsights/leadInsightsService');
const {
  getAnalyticsOverview,
  getAnalyticsWorkloads,
  getAnalyticsAiUsage,
} = require('../chatbot/humanCopilot/humanCopilotAnalyticsService');
const opsAggregates = require('../whatsappOpsAggregates');
const { getTeamDashboardStats } = require('../bdaStatsService');
const { getOrBuildSnapshot, COUNTING_METHOD } = require('./leadLifecycleSnapshotService');
const {
  getRegistrationFunnelCounts,
  getOneOnOneFunnelCounts,
} = require('./leadLifecycleValidationService');

function parseSinceDays(query = {}) {
  if (query.sinceDays != null) {
    return Math.min(Math.max(parseInt(query.sinceDays, 10) || 30, 1), 365);
  }
  const fromStr = String(query.from || '').trim();
  const toStr = String(query.to || '').trim();
  if (fromStr && toStr) {
    const from = new Date(`${fromStr}T00:00:00.000Z`);
    const to = new Date(`${toStr}T00:00:00.000Z`);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      const days = Math.ceil((to - from) / (24 * 60 * 60 * 1000)) + 1;
      return Math.min(Math.max(days, 1), 365);
    }
  }
  return 30;
}

function isoDateRange(query = {}) {
  const fromStr = String(query.from || query.fromDate || '').trim();
  const toStr = String(query.to || query.toDate || '').trim();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  return {
    from: fromStr || null,
    to: toStr || today,
  };
}

async function getExecutiveSummary(query = {}) {
  const productLine = String(query.productLine || 'all').trim();
  const sinceDays = parseSinceDays(query);
  const { from, to } = isoDateRange(query);

  const [
    leadStats,
    lifecycleSnapshot,
    registrationLegacy,
    oneOnOneLegacy,
    bdaTeam,
    copilotOverview,
    copilotWorkloads,
    copilotAiUsage,
    whatsappSummary,
  ] = await Promise.all([
    getLeadStats(),
    getOrBuildSnapshot(query, productLine),
    getRegistrationFunnelCounts(from || '', to || ''),
    getOneOnOneFunnelCounts(from || '', to || ''),
    getTeamDashboardStats(query),
    getAnalyticsOverview({ sinceDays }),
    getAnalyticsWorkloads({ sinceDays }),
    getAnalyticsAiUsage({ sinceDays }),
    opsAggregates.computeSummary({
      from: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
      to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
      messageKind: null,
      opsProduct: null,
    }),
  ]);

  const stageCounts = lifecycleSnapshot?.stageCounts || {};
  const stages = lifecycleSnapshot?.stages || [];

  const qualifiedCount = stageCounts.qualified ?? 0;
  const hotLeads = leadStats.hotLeads ?? 0;

  const workloadRows = [
    { id: 'sr1', ...(copilotWorkloads?.data?.sr1 || {}) },
    { id: 'sr2', ...(copilotWorkloads?.data?.sr2 || {}) },
  ];
  const utilization = workloadRows.length
    ? Math.round(
        (workloadRows.reduce((sum, row) => {
          const assigned = Number(row.assigned) || 0;
          const resolved = Number(row.resolved) || 0;
          return sum + (assigned ? (resolved / assigned) * 100 : 0);
        }, 0) /
          workloadRows.length) *
          10
      ) / 10
    : 0;

  const waData = whatsappSummary?.data || {};
  const waTotals = waData.totals || waData.summary || waData;

  const funnelSnapshot = {
    meta: {
      productLine,
      cohortSize: lifecycleSnapshot?.cohortSize ?? 0,
      from,
      to,
      generatedAt: lifecycleSnapshot?.generatedAt ?? new Date(),
      rulesVersion: 'leadLifecycle.v1.2',
      countingMethod: COUNTING_METHOD,
      servedFromSnapshot: true,
      snapshotId: lifecycleSnapshot?._id,
    },
    stages,
    transitions: lifecycleSnapshot?.transitions || [],
    byProductLine: lifecycleSnapshot?.byProductLine || [],
    stageCounts,
  };

  return {
    meta: {
      productLine,
      from,
      to,
      sinceDays,
      generatedAt: new Date(),
      countingMethod: COUNTING_METHOD,
      sources: [
        'leadInsightsService.getLeadStats',
        'leadLifecycleSnapshotService.getOrBuildSnapshot',
        'getRegistrationFunnelCounts',
        'getOneOnOneFunnelCounts',
        'bdaStatsService.getTeamDashboardStats',
        'humanCopilotAnalyticsService',
        'whatsappOpsAggregates.computeSummary',
      ],
    },
    leadVolume: {
      whatsappTotal: leadStats.totalLeads ?? 0,
      registrationLeads: registrationLegacy.total ?? 0,
      oneOnOneLeads: oneOnOneLegacy.distinctPhoneCount ?? oneOnOneLegacy.totalLeads ?? 0,
      lifecycleCohort: lifecycleSnapshot?.cohortSize ?? 0,
    },
    qualifiedAndHot: {
      qualifiedLeads: qualifiedCount,
      hotLeads,
      warmLeads: leadStats.warmLeads ?? 0,
      averageLeadScore: leadStats.averageScore ?? 0,
    },
    bookings: {
      registrationSlotBooked: registrationLegacy.slotBooked ?? 0,
      oneOnOneBookingConfirmed: oneOnOneLegacy.bookingConfirmed ?? 0,
      lifecycleBooked: stageCounts.booked ?? 0,
    },
    conversions: {
      registrationCompleted: registrationLegacy.completed ?? 0,
      oneOnOneConverted: oneOnOneLegacy.converted ?? 0,
      bdaAmountPaid: bdaTeam.totalAmountPaid ?? 0,
      bdaNiatRegistered: bdaTeam.totalNiatRegistered ?? 0,
      lifecycleAdmission: stageCounts.admission ?? 0,
    },
    responseTime: {
      avgFirstResponseMs: copilotOverview?.data?.responseTimes?.avgFirstResponseMs ?? null,
      avgResolutionMs: copilotOverview?.data?.responseTimes?.avgResolutionMs ?? null,
      activeHandoffs: copilotOverview?.data?.volume?.active ?? 0,
      resolvedHandoffs: copilotOverview?.data?.volume?.resolved ?? 0,
    },
    counsellorUtilization: {
      avgWorkloadPercent: utilization,
      agentCount: workloadRows.length,
      workloads: workloadRows.slice(0, 10),
    },
    whatsappDelivery: {
      totalRecipients: waTotals.totalRecipients ?? waTotals.total ?? null,
      delivered: waTotals.delivered ?? null,
      read: waTotals.read ?? null,
      accepted: waTotals.accepted ?? null,
    },
    copilotAiUsage: {
      aiUsedCount: copilotAiUsage?.data?.accepted ?? null,
      aiEditedCount: copilotAiUsage?.data?.edited ?? null,
      manualCount: copilotAiUsage?.data?.manual ?? null,
      aiAcceptanceRate: copilotAiUsage?.data?.acceptanceRate ?? null,
    },
    funnelSnapshot,
  };
}

module.exports = {
  getExecutiveSummary,
  parseSinceDays,
};
