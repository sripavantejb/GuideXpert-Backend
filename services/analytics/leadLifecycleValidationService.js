'use strict';

const FormSubmission = require('../../models/FormSubmission');
const OneOnOneCounselingLead = require('../../models/OneOnOneCounselingLead');
const IitCounsellingSubmission = require('../../models/IitCounsellingSubmission');
const MeetingAttendance = require('../../models/MeetingAttendance');
const { getTeamDashboardStats } = require('../bdaStatsService');
const {
  getOrBuildSnapshot,
  COUNTING_METHOD,
} = require('./leadLifecycleSnapshotService');
const {
  ONE_ON_ONE_CONTACTED_STATUSES,
  ONE_ON_ONE_ATTENDED_STATUSES,
} = require('../../constants/leadLifecycle');
const { normalizePhoneTo10, normalizePhone10Strict } = require('../../utils/phoneNormalize');
const { resolveStatsDateRange } = require('../../utils/statsDateRange');

function buildStatsDateFilter(fromStr, toStr) {
  const fromDate = fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : null;
  const toDate = toStr ? new Date(`${toStr}T23:59:59.999Z`) : null;
  const fromValid = fromDate && !Number.isNaN(fromDate.getTime());
  const toValid = toDate && !Number.isNaN(toDate.getTime());
  if (!fromValid && !toValid) return {};

  const createdAt = {};
  if (fromValid) createdAt.$gte = fromDate;
  if (toValid) createdAt.$lte = toDate;
  return { createdAt };
}

function buildOneOnOneDateMatch(fromStr, toStr) {
  const filter = buildStatsDateFilter(fromStr, toStr);
  return Object.keys(filter).length ? filter : {};
}

async function getRegistrationFunnelCounts(fromStr, toStr) {
  const dateFilter = buildStatsDateFilter(fromStr, toStr);
  const SLOT_BOOKED_CONDITION = {
    $or: [
      { isRegistered: true },
      { 'step3Data.selectedSlot': { $exists: true, $nin: [null, ''] } },
      { selectedSlot: { $exists: true, $nin: [null, ''] } },
    ],
  };

  const [
    total,
    otpVerified,
    slotBooked,
    completed,
    meetingAttendeePhones,
    slotBookedLeadsPhones,
  ] = await Promise.all([
    FormSubmission.countDocuments(dateFilter),
    FormSubmission.countDocuments({ $and: [dateFilter, { 'step2Data.otpVerified': true }] }),
    FormSubmission.countDocuments({ $and: [dateFilter, SLOT_BOOKED_CONDITION] }),
    FormSubmission.countDocuments({ $and: [dateFilter, { applicationStatus: 'completed' }] }),
    MeetingAttendance.aggregate([{ $group: { _id: '$mobileNumber' } }]),
    FormSubmission.find({ $and: [dateFilter, SLOT_BOOKED_CONDITION] }).select('phone').lean(),
  ]);

  const attendeePhonesSet = new Set(
    (meetingAttendeePhones || []).map((r) => normalizePhoneTo10(r._id)).filter(Boolean)
  );
  const demoAttended = (slotBookedLeadsPhones || []).filter((lead) =>
    attendeePhonesSet.has(normalizePhoneTo10(lead.phone))
  ).length;

  return {
    total,
    otpVerified,
    slotBooked,
    demoAttended,
    completed,
  };
}

async function getOneOnOneFunnelCounts(fromStr, toStr) {
  const baseMatch = buildOneOnOneDateMatch(fromStr, toStr);
  const contactedStatuses = ONE_ON_ONE_CONTACTED_STATUSES;
  const counselingDoneStatuses = ONE_ON_ONE_ATTENDED_STATUSES;

  const [
    totalLeads,
    distinctPhones,
    formCompleted,
    bookingConfirmed,
    contacted,
    counselingDone,
    converted,
  ] = await Promise.all([
    OneOnOneCounselingLead.countDocuments(baseMatch),
    OneOnOneCounselingLead.distinct('mobileNumber', baseMatch),
    OneOnOneCounselingLead.countDocuments({ ...baseMatch, formCompleted: true }),
    OneOnOneCounselingLead.countDocuments({ ...baseMatch, bookingConfirmed: true }),
    OneOnOneCounselingLead.countDocuments({
      ...baseMatch,
      leadStatus: { $in: contactedStatuses },
    }),
    OneOnOneCounselingLead.countDocuments({
      ...baseMatch,
      leadStatus: { $in: counselingDoneStatuses },
    }),
    OneOnOneCounselingLead.countDocuments({ ...baseMatch, leadStatus: 'Converted' }),
  ]);

  const distinctPhoneCount = (distinctPhones || []).filter((p) => normalizePhone10Strict(p)).length;

  return {
    totalLeads,
    distinctPhoneCount,
    formCompleted,
    bookingConfirmed,
    contacted,
    counselingDone,
    converted,
  };
}

async function countAllIitSubmissions(query = {}) {
  const dateRange = resolveStatsDateRange(query);
  const match = { submissionType: 'iitCounselling' };
  if (dateRange) {
    match.createdAt = { $gte: dateRange.start, $lt: dateRange.end };
  }
  const phones = await IitCounsellingSubmission.distinct('phone', match);
  return phones.filter((p) => normalizePhone10Strict(p)).length;
}

function stageCountFromSnapshot(snapshot, stage) {
  return snapshot?.stageCounts?.[stage] ?? 0;
}

function comparePair(label, legacy, lifecycle, notes = '', intentionalDifference = false) {
  const delta = lifecycle - legacy;
  const deltaPct = legacy ? Math.round((delta / legacy) * 1000) / 10 : lifecycle ? 100 : 0;
  return {
    label,
    legacy,
    lifecycle,
    delta,
    deltaPct,
    aligned: legacy === lifecycle,
    intentionalDifference,
    notes,
  };
}

async function getLifecycleValidationReport(query = {}) {
  const fromStr = String(query.from || query.fromDate || '').trim();
  const toStr = String(query.to || query.toDate || '').trim();

  const [
    registrationLegacy,
    oneOnOneLegacy,
    bdaLegacy,
    allIitSubmissions,
    snapshotAll,
    snapshotReg,
    snapshotOoo,
    snapshotIit,
  ] = await Promise.all([
    getRegistrationFunnelCounts(fromStr, toStr),
    getOneOnOneFunnelCounts(fromStr, toStr),
    getTeamDashboardStats(query),
    countAllIitSubmissions(query),
    getOrBuildSnapshot(query, 'all'),
    getOrBuildSnapshot(query, 'registration'),
    getOrBuildSnapshot(query, 'oneOnOne'),
    getOrBuildSnapshot(query, 'iit'),
  ]);

  const registration = {
    comparisons: [
      comparePair(
        'Lead (total signups)',
        registrationLegacy.total,
        stageCountFromSnapshot(snapshotReg, 'lead'),
        'Lifecycle cohort = distinct phones with lead event in range'
      ),
      comparePair(
        'Qualified (OTP verified)',
        registrationLegacy.otpVerified,
        stageCountFromSnapshot(snapshotReg, 'qualified'),
        'Distinct phones in cohort who reached qualified (any time)'
      ),
      comparePair(
        'Booked (slot booked)',
        registrationLegacy.slotBooked,
        stageCountFromSnapshot(snapshotReg, 'booked')
      ),
      comparePair(
        'Attended (demo attended)',
        registrationLegacy.demoAttended,
        stageCountFromSnapshot(snapshotReg, 'attended'),
        'Legacy counts slot-booked leads with meeting attendance; lifecycle uses distinct attended events'
      ),
      comparePair(
        'Admission (completed)',
        registrationLegacy.completed,
        stageCountFromSnapshot(snapshotReg, 'admission'),
        'Legacy uses applicationStatus=completed; lifecycle also counts postRegistrationData.completedAt',
        registrationLegacy.completed !== stageCountFromSnapshot(snapshotReg, 'admission')
      ),
    ],
    legacy: registrationLegacy,
    lifecycle: {
      cohortSize: snapshotReg.cohortSize ?? 0,
      stages: snapshotReg.stages || [],
      stageCounts: snapshotReg.stageCounts || {},
    },
  };

  const oneOnOne = {
    comparisons: [
      comparePair(
        'Lead (documents)',
        oneOnOneLegacy.totalLeads,
        stageCountFromSnapshot(snapshotOoo, 'lead'),
        'Legacy counts documents; lifecycle counts distinct phones (see distinct-phone row)',
        oneOnOneLegacy.totalLeads !== stageCountFromSnapshot(snapshotOoo, 'lead')
      ),
      comparePair(
        'Lead (distinct phones)',
        oneOnOneLegacy.distinctPhoneCount,
        stageCountFromSnapshot(snapshotOoo, 'lead'),
        'Apples-to-apples: distinct phone comparison'
      ),
      comparePair(
        'Qualified (form completed)',
        oneOnOneLegacy.formCompleted,
        stageCountFromSnapshot(snapshotOoo, 'qualified')
      ),
      comparePair(
        'Interested (contacted+)',
        oneOnOneLegacy.contacted,
        stageCountFromSnapshot(snapshotOoo, 'interested'),
        'Legacy contacted set includes Demo Booked+'
      ),
      comparePair(
        'Booked (booking confirmed)',
        oneOnOneLegacy.bookingConfirmed,
        stageCountFromSnapshot(snapshotOoo, 'booked')
      ),
      comparePair(
        'Attended (counseling done)',
        oneOnOneLegacy.counselingDone,
        stageCountFromSnapshot(snapshotOoo, 'attended')
      ),
      comparePair(
        'Admission (converted)',
        oneOnOneLegacy.converted,
        stageCountFromSnapshot(snapshotOoo, 'admission')
      ),
    ],
    legacy: oneOnOneLegacy,
    lifecycle: {
      cohortSize: snapshotOoo.cohortSize ?? 0,
      stages: snapshotOoo.stages || [],
      stageCounts: snapshotOoo.stageCounts || {},
    },
  };

  const bda = {
    comparisons: [
      comparePair(
        'IIT submissions (all phones)',
        allIitSubmissions,
        stageCountFromSnapshot(snapshotIit, 'lead'),
        'Lifecycle lead count should align with all IIT submission phones in range'
      ),
      comparePair(
        'Assigned leads (BDA team only)',
        bdaLegacy.totalAssignedLeads,
        stageCountFromSnapshot(snapshotIit, 'lead'),
        'BDA stats count assigned leads only; lifecycle includes unassigned IIT submissions',
        true
      ),
      comparePair(
        'Interested (BDA CRM)',
        bdaLegacy.totalInterestedLeads,
        stageCountFromSnapshot(snapshotIit, 'interested')
      ),
      comparePair(
        'Demo attended (BDA)',
        bdaLegacy.totalDemoAttended,
        stageCountFromSnapshot(snapshotIit, 'attended')
      ),
      comparePair(
        'Amount paid (BDA)',
        bdaLegacy.totalAmountPaid,
        stageCountFromSnapshot(snapshotIit, 'admission'),
        'Admission includes payment OR niat OR converted lead status',
        bdaLegacy.totalAmountPaid !== stageCountFromSnapshot(snapshotIit, 'admission')
      ),
    ],
    legacy: {
      totalAssignedLeads: bdaLegacy.totalAssignedLeads,
      allIitSubmissions,
      totalInterestedLeads: bdaLegacy.totalInterestedLeads,
      totalDemoAttended: bdaLegacy.totalDemoAttended,
      totalAmountPaid: bdaLegacy.totalAmountPaid,
      totalNiatRegistered: bdaLegacy.totalNiatRegistered,
    },
    lifecycle: {
      cohortSize: snapshotIit.cohortSize ?? 0,
      stages: snapshotIit.stages || [],
      stageCounts: snapshotIit.stageCounts || {},
    },
  };

  const allComparisons = [
    ...registration.comparisons,
    ...oneOnOne.comparisons,
    ...bda.comparisons,
  ];
  const alignedCount = allComparisons.filter((c) => c.aligned).length;
  const intentionalCount = allComparisons.filter((c) => c.intentionalDifference).length;

  return {
    meta: {
      from: fromStr || null,
      to: toStr || null,
      generatedAt: new Date(),
      countingMethod: COUNTING_METHOD,
      alignedCount,
      intentionalDifferenceCount: intentionalCount,
      totalComparisons: allComparisons.length,
      alignmentPct: allComparisons.length
        ? Math.round((alignedCount / allComparisons.length) * 1000) / 10
        : 0,
      methodologyNotes: [
        'Executive dashboard and validation both use distinct-phone counts from lifecycle snapshots.',
        'OneOnOne document count may exceed distinct phones when the same phone has multiple leads.',
        'BDA assigned-lead totals exclude unassigned IIT submissions by design.',
        'Registration admission may differ when postRegistrationData.completedAt is set without applicationStatus=completed.',
      ],
    },
    registration,
    oneOnOne,
    bda,
    lifecycleAll: {
      cohortSize: snapshotAll.cohortSize ?? 0,
      stages: snapshotAll.stages || [],
      stageCounts: snapshotAll.stageCounts || {},
      byProductLine: snapshotAll.byProductLine || [],
    },
  };
}

module.exports = {
  getLifecycleValidationReport,
  getRegistrationFunnelCounts,
  getOneOnOneFunnelCounts,
  countAllIitSubmissions,
};
