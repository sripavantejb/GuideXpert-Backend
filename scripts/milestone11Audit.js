'use strict';

require('dotenv').config();
const connectDB = require('../config/db');
const LeadLifecycleEvent = require('../models/LeadLifecycleEvent');
const FormSubmission = require('../models/FormSubmission');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const WhatsAppLeadProfile = require('../models/WhatsAppLeadProfile');
const WhatsAppLeadScore = require('../models/WhatsAppLeadScore');
const WhatsAppLeadEvent = require('../models/WhatsAppLeadEvent');
const WhatsAppAgentHandoff = require('../models/WhatsAppAgentHandoff');
const IitCounsellingLeadActivity = require('../models/IitCounsellingLeadActivity');
const LeadCallHistory = require('../models/LeadCallHistory');
const { getLifecycleValidationReport } = require('../services/analytics/leadLifecycleValidationService');
const { getLifecycleFunnel } = require('../services/analytics/leadLifecycleFunnelService');
const { getExecutiveSummary } = require('../services/analytics/analyticsExecutiveService');
const { backfillLeadLifecycleEvents } = require('../services/analytics/leadLifecycleBackfillService');
const { normalizePhone10Strict } = require('../utils/phoneNormalize');

async function timeFn(label, fn) {
  const start = Date.now();
  const result = await fn();
  return { label, ms: Date.now() - start, result };
}

async function auditAdmission() {
  const [legacyCompleted, postRegCompleted, lifecycleAdmission] = await Promise.all([
    FormSubmission.countDocuments({ applicationStatus: 'completed' }),
    FormSubmission.countDocuments({ 'postRegistrationData.completedAt': { $ne: null } }),
    LeadLifecycleEvent.distinct('phone10', { productLine: 'registration', stage: 'admission' }),
  ]);
  const legacyOnly = await FormSubmission.countDocuments({
    applicationStatus: 'completed',
    $or: [
      { 'postRegistrationData.completedAt': null },
      { 'postRegistrationData.completedAt': { $exists: false } },
    ],
  });
  const postRegOnly = await FormSubmission.countDocuments({
    applicationStatus: { $ne: 'completed' },
    'postRegistrationData.completedAt': { $ne: null },
  });
  const both = await FormSubmission.countDocuments({
    applicationStatus: 'completed',
    'postRegistrationData.completedAt': { $ne: null },
  });
  return {
    legacyCompleted,
    postRegCompleted,
    lifecycleAdmissionCount: lifecycleAdmission.length,
    legacyOnlyAppStatus: legacyOnly,
    postRegOnlyNotCompleted: postRegOnly,
    bothFlags: both,
  };
}

async function auditOneOnOne() {
  const totalDocs = await OneOnOneCounselingLead.countDocuments({});
  const withLeadEvent = await LeadLifecycleEvent.distinct('sourceId', {
    productLine: 'oneOnOne',
    stage: 'lead',
  });
  const invalidPhone = await OneOnOneCounselingLead.countDocuments({
    mobileNumber: { $not: /^[6-9]\d{9}$/ },
  });
  const leadEvents = await LeadLifecycleEvent.countDocuments({ productLine: 'oneOnOne', stage: 'lead' });
  const duplicatePhones = await OneOnOneCounselingLead.aggregate([
    { $group: { _id: '$mobileNumber', c: { $sum: 1 } } },
    { $match: { c: { $gt: 1 } } },
    { $count: 'n' },
  ]);
  return { totalDocs, leadEvents, withLeadEventCount: withLeadEvent.length, invalidPhone, duplicatePhoneGroups: duplicatePhones[0]?.n || 0 };
}

async function auditWhatsApp() {
  const [profiles, scores, leadEvents, handoffs, waLifecycle] = await Promise.all([
    WhatsAppLeadProfile.countDocuments({}),
    WhatsAppLeadScore.countDocuments({}),
    WhatsAppLeadEvent.countDocuments({}),
    WhatsAppAgentHandoff.countDocuments({}),
    LeadLifecycleEvent.countDocuments({ productLine: 'whatsapp' }),
  ]);
  const profilePhones = await WhatsAppLeadProfile.distinct('phone');
  const scorePhones = await WhatsAppLeadScore.distinct('phone');
  const allPhones = new Set([...profilePhones, ...scorePhones]);

  const profilesNoTs = await WhatsAppLeadProfile.countDocuments({
    firstInteractionAt: null,
    lastInteractionAt: null,
  });
  const scoresNoTs = await WhatsAppLeadScore.countDocuments({
    firstScoredAt: null,
    lastScoredAt: null,
  });

  let skippedNoPhone = 0;
  let skippedNoTs = 0;
  const profileDocs = await WhatsAppLeadProfile.find({}).select('phone firstInteractionAt lastInteractionAt').lean();
  const scoreDocs = await WhatsAppLeadScore.find({}).select('phone firstScoredAt lastScoredAt leadStage').lean();
  const scoreByPhone = new Map(scoreDocs.map((s) => [s.phone, s]));

  for (const p of profileDocs) {
    if (!normalizePhone10Strict(p.phone)) skippedNoPhone += 1;
    else if (!p.firstInteractionAt && !p.lastInteractionAt && !scoreByPhone.get(p.phone)?.firstScoredAt) {
      skippedNoTs += 1;
    }
  }
  for (const s of scoreDocs) {
    if (!profilePhones.includes(s.phone)) {
      if (!normalizePhone10Strict(s.phone)) skippedNoPhone += 1;
      else if (!s.firstScoredAt && !s.lastScoredAt) skippedNoTs += 1;
    }
  }

  const stageBreakdown = await LeadLifecycleEvent.aggregate([
    { $match: { productLine: 'whatsapp' } },
    { $group: { _id: '$stage', c: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  return {
    profiles,
    scores,
    leadEvents,
    handoffs,
    waLifecycle,
    distinctPhones: allPhones.size,
    profilesNoTs,
    scoresNoTs,
    skippedNoPhone,
    skippedNoTs,
    stageBreakdown,
  };
}

async function auditIndexes() {
  const indexes = await LeadLifecycleEvent.collection.getIndexes();
  const docCount = await LeadLifecycleEvent.countDocuments({});
  return { indexes, docCount };
}

async function explainFunnel() {
  const leadMatch = { stage: 'lead' };
  const explain1 = await LeadLifecycleEvent.find(leadMatch).select('phone10 productLine').explain('executionStats');
  const phones = await LeadLifecycleEvent.distinct('phone10', { productLine: 'registration' });
  const samplePhones = phones.slice(0, 500);
  const explain2 = await LeadLifecycleEvent.find({
    phone10: { $in: samplePhones },
    productLine: 'registration',
  })
    .select('phone10 productLine stage transitionAt')
    .explain('executionStats');
  return {
    leadStageScan: {
      nReturned: explain1.executionStats?.nReturned,
      totalDocsExamined: explain1.executionStats?.totalDocsExamined,
      executionTimeMs: explain1.executionStats?.executionTimeMillis,
      stage: explain1.queryPlanner?.winningPlan?.stage,
      indexName: explain1.queryPlanner?.winningPlan?.inputStage?.indexName ||
        explain1.queryPlanner?.winningPlan?.inputStage?.inputStage?.indexName,
    },
    phoneProductLine: {
      nReturned: explain2.executionStats?.nReturned,
      totalDocsExamined: explain2.executionStats?.totalDocsExamined,
      executionTimeMs: explain2.executionStats?.executionTimeMillis,
      stage: explain2.queryPlanner?.winningPlan?.stage,
    },
  };
}

async function auditIitReplay() {
  const sample = await IitCounsellingSubmission.find({ submissionType: 'iitCounselling' })
    .limit(5)
    .select('_id phone callStatus leadStatus demoStatus paymentStatus niatStatus')
    .lean();
  const results = [];
  for (const lead of sample) {
    const [activities, history] = await Promise.all([
      IitCounsellingLeadActivity.find({ leadId: lead._id }).sort({ createdAt: 1 }).lean(),
      LeadCallHistory.find({ leadId: lead._id }).sort({ createdAt: 1 }).lean(),
    ]);
    const events = await LeadLifecycleEvent.find({
      sourceId: lead._id,
      productLine: 'iit',
    })
      .sort({ transitionAt: 1 })
      .lean();
    const stages = events.map((e) => e.stage);
    const regressions = stages.filter((s, i) => i > 0 && events[i].transitionAt < events[i - 1].transitionAt);
    results.push({
      leadId: String(lead._id),
      activityCount: activities.length,
      historyCount: history.length,
      eventStages: stages,
      timestampOrderOk: regressions.length === 0,
      duplicateStages: stages.length !== new Set(stages).size,
    });
  }
  const dupDedupe = await LeadLifecycleEvent.aggregate([
    { $group: { _id: '$dedupeKey', c: { $sum: 1 } } },
    { $match: { c: { $gt: 1 } } },
    { $count: 'n' },
  ]);
  return { sample: results, duplicateDedupeKeys: dupDedupe[0]?.n || 0 };
}

async function backfillIntegrity() {
  const before = await LeadLifecycleEvent.countDocuments({});
  const run1 = await backfillLeadLifecycleEvents({ clearExisting: false });
  const after1 = await LeadLifecycleEvent.countDocuments({});
  const run2 = await backfillLeadLifecycleEvents({ clearExisting: false });
  const after2 = await LeadLifecycleEvent.countDocuments({});
  const run3 = await backfillLeadLifecycleEvents({ clearExisting: false });
  const after3 = await LeadLifecycleEvent.countDocuments({});
  return { before, run1, after1, run2, after2, run3, after3 };
}

async function main() {
  await connectDB();
  const out = {};

  out.validation = await getLifecycleValidationReport({});
  out.admissionDeepDive = await auditAdmission();
  out.oneOnOneDeepDive = await auditOneOnOne();
  out.whatsapp = await auditWhatsApp();
  out.indexes = await auditIndexes();
  out.explain = await explainFunnel();

  out.timing = await Promise.all([
    timeFn('funnel', () => getLifecycleFunnel({ productLine: 'all' })),
    timeFn('funnel_registration', () => getLifecycleFunnel({ productLine: 'registration' })),
    timeFn('executive', () => getExecutiveSummary({})),
    timeFn('validation', () => getLifecycleValidationReport({})),
  ]);

  out.iitReplay = await auditIitReplay();
  out.backfillIntegrity = await backfillIntegrity();

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
