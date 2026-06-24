'use strict';

const FormSubmission = require('../../models/FormSubmission');
const OneOnOneCounselingLead = require('../../models/OneOnOneCounselingLead');
const IitCounsellingSubmission = require('../../models/IitCounsellingSubmission');
const WhatsAppLeadProfile = require('../../models/WhatsAppLeadProfile');
const WhatsAppLeadScore = require('../../models/WhatsAppLeadScore');
const WhatsAppAgentHandoff = require('../../models/WhatsAppAgentHandoff');
const MeetingAttendance = require('../../models/MeetingAttendance');
const IitCounsellingLeadActivity = require('../../models/IitCounsellingLeadActivity');
const LeadCallHistory = require('../../models/LeadCallHistory');
const LeadLifecycleEvent = require('../../models/LeadLifecycleEvent');
const {
  ONE_ON_ONE_CONTACTED_STATUSES,
  ONE_ON_ONE_ATTENDED_STATUSES,
  WHATSAPP_WARM_STAGES,
  WHATSAPP_HOT_STAGES,
  COPILOT_ASSIGNED_STATES,
} = require('../../constants/leadLifecycle');
const { normalizePhoneTo10, normalizePhone10Strict } = require('../../utils/phoneNormalize');
const { pushEvent } = require('./leadLifecycleEventBuilder');
const {
  invalidateAllSnapshots,
} = require('./leadLifecycleSnapshotService');
const {
  resolveIitQualified,
  resolveIitInterested,
  resolveIitBooked,
  resolveIitAttended,
  resolveIitAdmission,
} = require('./iitLifecycleTransitionResolver');

const BATCH_SIZE = 500;

function isSlotBooked(doc) {
  return Boolean(
    doc.isRegistered === true ||
      (doc.step3Data?.selectedSlot && String(doc.step3Data.selectedSlot).trim()) ||
      (doc.selectedSlot && String(doc.selectedSlot).trim())
  );
}

function isRegistrationInterested(doc) {
  if (doc.demoInterest) return true;
  if (doc.leadStatus === 'Interested') return true;
  if (Number(doc.currentStep) >= 3) return true;
  return false;
}

function registrationInterestedAt(doc) {
  if (doc.step2Data?.step2CompletedAt) return doc.step2Data.step2CompletedAt;
  if (doc.step1Data?.step1CompletedAt) return doc.step1Data.step1CompletedAt;
  return doc.updatedAt || doc.createdAt;
}

function buildRegistrationEvents(doc, attendeeAtByPhone, events) {
  const phone10 = normalizePhone10Strict(doc.phone);
  if (!phone10) return;

  const sourceId = doc._id;
  const baseMeta = { utm_source: doc.utm_source || null };

  pushEvent(events, {
    phone10,
    productLine: 'registration',
    stage: 'lead',
    sourceCollection: 'FormSubmission',
    sourceId,
    transitionAt: doc.createdAt,
    meta: { ...baseMeta, inferred: false, confidence: 'high', proxyField: 'createdAt' },
  });

  if (doc.step2Data?.otpVerified) {
    pushEvent(events, {
      phone10,
      productLine: 'registration',
      stage: 'qualified',
      sourceCollection: 'FormSubmission',
      sourceId,
      transitionAt: doc.step2Data.step2CompletedAt || doc.updatedAt || doc.createdAt,
      meta: {
        ...baseMeta,
        inferred: !doc.step2Data.step2CompletedAt,
        proxyField: doc.step2Data.step2CompletedAt ? 'step2Data.step2CompletedAt' : 'updatedAt',
        confidence: doc.step2Data.step2CompletedAt ? 'high' : 'medium',
      },
    });
  }

  if (isRegistrationInterested(doc)) {
    pushEvent(events, {
      phone10,
      productLine: 'registration',
      stage: 'interested',
      sourceCollection: 'FormSubmission',
      sourceId,
      transitionAt: registrationInterestedAt(doc),
      meta: {
        ...baseMeta,
        inferred: true,
        proxyField: 'step1Data.step1CompletedAt|currentStep|demoInterest',
        confidence: 'low',
      },
    });
  }

  if (isSlotBooked(doc)) {
    pushEvent(events, {
      phone10,
      productLine: 'registration',
      stage: 'booked',
      sourceCollection: 'FormSubmission',
      sourceId,
      transitionAt:
        doc.step3Data?.step3CompletedAt || doc.registeredAt || doc.updatedAt || doc.createdAt,
      meta: {
        ...baseMeta,
        inferred: !doc.step3Data?.step3CompletedAt,
        proxyField: doc.step3Data?.step3CompletedAt
          ? 'step3Data.step3CompletedAt'
          : 'registeredAt',
        confidence: doc.step3Data?.step3CompletedAt || doc.registeredAt ? 'high' : 'medium',
      },
    });
  }

  const attendedAt = attendeeAtByPhone.get(phone10);
  if (attendedAt && isSlotBooked(doc)) {
    pushEvent(events, {
      phone10,
      productLine: 'registration',
      stage: 'attended',
      sourceCollection: 'MeetingAttendance',
      sourceId,
      transitionAt: attendedAt,
      meta: {
        ...baseMeta,
        inferred: false,
        proxyField: 'MeetingAttendance.timestamp',
        confidence: 'high',
      },
    });
  }

  if (doc.applicationStatus === 'completed' || doc.postRegistrationData?.completedAt) {
    pushEvent(events, {
      phone10,
      productLine: 'registration',
      stage: 'admission',
      sourceCollection: 'FormSubmission',
      sourceId,
      transitionAt:
        doc.postRegistrationData?.completedAt || doc.updatedAt || doc.createdAt,
      meta: {
        ...baseMeta,
        inferred: !doc.postRegistrationData?.completedAt,
        proxyField: doc.postRegistrationData?.completedAt
          ? 'postRegistrationData.completedAt'
          : 'updatedAt',
        confidence: doc.postRegistrationData?.completedAt ? 'high' : 'medium',
      },
    });
  }
}

function buildOneOnOneEvents(doc, events) {
  const phone10 = normalizePhone10Strict(doc.mobileNumber);
  if (!phone10) return;

  const sourceId = doc._id;
  const baseMeta = { utm_source: doc.utm_source || null };

  pushEvent(events, {
    phone10,
    productLine: 'oneOnOne',
    stage: 'lead',
    sourceCollection: 'OneOnOneCounselingLead',
    sourceId,
    transitionAt: doc.createdAt,
    meta: { ...baseMeta, inferred: false, confidence: 'high', proxyField: 'createdAt' },
  });

  if (doc.formCompleted) {
    pushEvent(events, {
      phone10,
      productLine: 'oneOnOne',
      stage: 'qualified',
      sourceCollection: 'OneOnOneCounselingLead',
      sourceId,
      transitionAt: doc.updatedAt || doc.createdAt,
      meta: {
        ...baseMeta,
        inferred: true,
        proxyField: 'updatedAt',
        confidence: 'medium',
        note: 'formCompleted_no_dedicated_timestamp',
      },
    });
  }

  if (ONE_ON_ONE_CONTACTED_STATUSES.includes(doc.leadStatus)) {
    pushEvent(events, {
      phone10,
      productLine: 'oneOnOne',
      stage: 'interested',
      sourceCollection: 'OneOnOneCounselingLead',
      sourceId,
      transitionAt: doc.updatedAt || doc.createdAt,
      meta: {
        ...baseMeta,
        inferred: true,
        proxyField: 'updatedAt',
        confidence: 'low',
        note: `leadStatus:${doc.leadStatus}`,
      },
    });
  }

  if (doc.bookingConfirmed) {
    pushEvent(events, {
      phone10,
      productLine: 'oneOnOne',
      stage: 'booked',
      sourceCollection: 'OneOnOneCounselingLead',
      sourceId,
      transitionAt: doc.bookingConfirmedAt || doc.updatedAt || doc.createdAt,
      meta: {
        ...baseMeta,
        inferred: !doc.bookingConfirmedAt,
        proxyField: doc.bookingConfirmedAt ? 'bookingConfirmedAt' : 'updatedAt',
        confidence: doc.bookingConfirmedAt ? 'high' : 'medium',
      },
    });
  }

  if (
    ONE_ON_ONE_ATTENDED_STATUSES.includes(doc.leadStatus) ||
    doc.bookingStatus === 'Attended'
  ) {
    pushEvent(events, {
      phone10,
      productLine: 'oneOnOne',
      stage: 'attended',
      sourceCollection: 'OneOnOneCounselingLead',
      sourceId,
      transitionAt: doc.updatedAt || doc.bookingConfirmedAt || doc.createdAt,
      meta: {
        ...baseMeta,
        inferred: true,
        proxyField: 'updatedAt',
        confidence: 'low',
        note: `leadStatus:${doc.leadStatus}|bookingStatus:${doc.bookingStatus}`,
      },
    });
  }

  if (doc.leadStatus === 'Converted') {
    pushEvent(events, {
      phone10,
      productLine: 'oneOnOne',
      stage: 'admission',
      sourceCollection: 'OneOnOneCounselingLead',
      sourceId,
      transitionAt: doc.updatedAt || doc.createdAt,
      meta: {
        ...baseMeta,
        inferred: true,
        proxyField: 'updatedAt',
        confidence: 'low',
        note: 'leadStatus:Converted',
      },
    });
  }
}

function buildIitEvents(doc, activities, history, events) {
  const phone10 = normalizePhone10Strict(doc.phone);
  if (!phone10) return;

  const sourceId = doc._id;
  const fallbackAt = doc.crmUpdatedAt || doc.lastActivityAt || doc.updatedAt || doc.createdAt;
  const baseMeta = {
    utm_source: doc.utm_source || null,
    assignedBdaId: doc.assignedBdaId || null,
  };

  pushEvent(events, {
    phone10,
    productLine: 'iit',
    stage: 'lead',
    sourceCollection: 'IitCounsellingSubmission',
    sourceId,
    transitionAt: doc.createdAt,
    meta: { ...baseMeta, inferred: false, confidence: 'high', proxyField: 'createdAt' },
  });

  const qualified = resolveIitQualified(activities, history, doc.callStatus, fallbackAt);
  if (qualified) {
    pushEvent(events, {
      phone10,
      productLine: 'iit',
      stage: 'qualified',
      sourceCollection: 'IitCounsellingSubmission',
      sourceId,
      transitionAt: qualified.at,
      meta: {
        ...baseMeta,
        inferred: qualified.inferred,
        proxyField: qualified.proxyField,
        confidence: qualified.confidence,
      },
    });
  }

  const interested = resolveIitInterested(activities, history, doc.leadStatus, fallbackAt);
  if (interested) {
    pushEvent(events, {
      phone10,
      productLine: 'iit',
      stage: 'interested',
      sourceCollection: 'IitCounsellingSubmission',
      sourceId,
      transitionAt: interested.at,
      meta: {
        ...baseMeta,
        inferred: interested.inferred,
        proxyField: interested.proxyField,
        confidence: interested.confidence,
      },
    });
  }

  const booked = resolveIitBooked(
    activities,
    history,
    doc.demoStatus,
    fallbackAt,
    doc.counsellingSlotInstantUtc
  );
  if (booked) {
    pushEvent(events, {
      phone10,
      productLine: 'iit',
      stage: 'booked',
      sourceCollection: 'IitCounsellingSubmission',
      sourceId,
      transitionAt: booked.at,
      meta: {
        ...baseMeta,
        inferred: booked.inferred,
        proxyField: booked.proxyField,
        confidence: booked.confidence,
      },
    });
  }

  const attended = resolveIitAttended(activities, history, doc.demoStatus, fallbackAt);
  if (attended) {
    pushEvent(events, {
      phone10,
      productLine: 'iit',
      stage: 'attended',
      sourceCollection: 'IitCounsellingSubmission',
      sourceId,
      transitionAt: attended.at,
      meta: {
        ...baseMeta,
        inferred: attended.inferred,
        proxyField: attended.proxyField,
        confidence: attended.confidence,
      },
    });
  }

  const admission = resolveIitAdmission({
    activities,
    history,
    leadStatus: doc.leadStatus,
    paymentStatus: doc.paymentStatus,
    niatStatus: doc.niatStatus,
    fallbackAt,
  });
  if (admission) {
    pushEvent(events, {
      phone10,
      productLine: 'iit',
      stage: 'admission',
      sourceCollection: 'IitCounsellingSubmission',
      sourceId,
      transitionAt: admission.at,
      meta: {
        ...baseMeta,
        inferred: admission.inferred,
        proxyField: admission.proxyField,
        confidence: admission.confidence,
        note: admission.admissionKind || null,
      },
    });
  }
}

function buildWhatsAppEvents(profile, score, events) {
  const phone10 = normalizePhone10Strict(profile?.phone || score?.phone);
  if (!phone10) return;

  const sourceId = profile?._id || score?._id;
  if (!sourceId) return;

  const leadAt = profile?.firstInteractionAt || score?.firstScoredAt || profile?.lastInteractionAt;
  if (!leadAt) return;

  const baseMeta = {
    leadScore: score?.leadScore ?? null,
    leadStage: score?.leadStage ?? null,
  };

  pushEvent(events, {
    phone10,
    productLine: 'whatsapp',
    stage: 'lead',
    sourceCollection: profile ? 'WhatsAppLeadProfile' : 'WhatsAppLeadScore',
    sourceId,
    transitionAt: leadAt,
    meta: {
      ...baseMeta,
      inferred: false,
      confidence: 'high',
      proxyField: profile?.firstInteractionAt ? 'firstInteractionAt' : 'firstScoredAt',
    },
  });

  if (score && WHATSAPP_WARM_STAGES.includes(score.leadStage)) {
    pushEvent(events, {
      phone10,
      productLine: 'whatsapp',
      stage: 'qualified',
      sourceCollection: 'WhatsAppLeadScore',
      sourceId: score._id,
      transitionAt: score.firstScoredAt || score.lastScoredAt || leadAt,
      meta: {
        ...baseMeta,
        inferred: true,
        proxyField: 'firstScoredAt',
        confidence: 'low',
        note: 'current_stage_warm_or_hot',
      },
    });
  }

  const interested =
    (score && WHATSAPP_HOT_STAGES.includes(score.leadStage)) ||
    profile?.demoInterested ||
    profile?.handoffRequested;

  if (interested) {
    pushEvent(events, {
      phone10,
      productLine: 'whatsapp',
      stage: 'interested',
      sourceCollection: 'WhatsAppLeadProfile',
      sourceId: profile?._id || score._id,
      transitionAt: profile?.lastInteractionAt || score?.lastScoredAt || leadAt,
      meta: {
        ...baseMeta,
        inferred: true,
        proxyField: 'lastInteractionAt|lastScoredAt',
        confidence: 'low',
      },
    });
  }

  if (profile?.demoInterested) {
    pushEvent(events, {
      phone10,
      productLine: 'whatsapp',
      stage: 'booked',
      sourceCollection: 'WhatsAppLeadProfile',
      sourceId: profile._id,
      transitionAt: profile.lastInteractionAt || leadAt,
      meta: {
        ...baseMeta,
        inferred: true,
        proxyField: 'lastInteractionAt',
        confidence: 'low',
        note: 'demoInterested_proxy_not_true_booking',
      },
    });
  }
}

function buildCopilotEvents(doc, events) {
  const phone10 = normalizePhone10Strict(doc.phone);
  if (!phone10) return;

  const sourceId = doc._id;

  pushEvent(events, {
    phone10,
    productLine: 'copilot',
    stage: 'lead',
    sourceCollection: 'WhatsAppAgentHandoff',
    sourceId,
    transitionAt: doc.createdAt,
    meta: { inferred: false, confidence: 'high', proxyField: 'createdAt' },
  });

  if (doc.assignedAt || COPILOT_ASSIGNED_STATES.includes(doc.copilotState)) {
    pushEvent(events, {
      phone10,
      productLine: 'copilot',
      stage: 'qualified',
      sourceCollection: 'WhatsAppAgentHandoff',
      sourceId,
      transitionAt: doc.assignedAt || doc.claimedAt || doc.updatedAt || doc.createdAt,
      meta: {
        inferred: !doc.assignedAt,
        proxyField: doc.assignedAt ? 'assignedAt' : 'copilotState',
        confidence: doc.assignedAt ? 'high' : 'medium',
      },
    });
  }

  if (doc.reason === 'user_requested' || doc.copilotState !== 'pending') {
    pushEvent(events, {
      phone10,
      productLine: 'copilot',
      stage: 'interested',
      sourceCollection: 'WhatsAppAgentHandoff',
      sourceId,
      transitionAt: doc.createdAt,
      meta: {
        inferred: true,
        proxyField: 'createdAt',
        confidence: 'medium',
        note: 'handoff_opened',
      },
    });
  }

  if (doc.firstResponseAt) {
    pushEvent(events, {
      phone10,
      productLine: 'copilot',
      stage: 'attended',
      sourceCollection: 'WhatsAppAgentHandoff',
      sourceId,
      transitionAt: doc.firstResponseAt,
      meta: {
        inferred: true,
        proxyField: 'firstResponseAt',
        confidence: 'medium',
        note: 'agent_first_response_proxy',
      },
    });
  }

  if (doc.resolvedAt) {
    pushEvent(events, {
      phone10,
      productLine: 'copilot',
      stage: 'admission',
      sourceCollection: 'WhatsAppAgentHandoff',
      sourceId,
      transitionAt: doc.resolvedAt,
      meta: {
        inferred: true,
        proxyField: 'resolvedAt',
        confidence: 'low',
        note: 'resolved_proxy_not_admission',
      },
    });
  }
}

async function loadAttendeeFirstAtByPhone() {
  const rows = await MeetingAttendance.aggregate([
    {
      $group: {
        _id: '$mobileNumber',
        firstAt: { $min: '$timestamp' },
      },
    },
  ]);
  const map = new Map();
  for (const row of rows) {
    const phone10 = normalizePhoneTo10(row._id);
    if (phone10 && /^\d{10}$/.test(phone10)) {
      const existing = map.get(phone10);
      const at = new Date(row.firstAt);
      if (!existing || at < existing) {
        map.set(phone10, at);
      }
    }
  }
  return map;
}

async function flushEvents(events, stats) {
  if (!events.length) return;
  const ops = events.map((doc) => ({
    updateOne: {
      filter: { dedupeKey: doc.dedupeKey },
      update: {
        $set: {
          transitionAt: doc.transitionAt,
          meta: doc.meta,
          backfilledAt: doc.backfilledAt,
          previousStage: doc.previousStage,
        },
        $setOnInsert: {
          dedupeKey: doc.dedupeKey,
          phone10: doc.phone10,
          productLine: doc.productLine,
          stage: doc.stage,
          sourceCollection: doc.sourceCollection,
          sourceId: doc.sourceId,
        },
      },
      upsert: true,
    },
  }));
  const result = await LeadLifecycleEvent.bulkWrite(ops, { ordered: false });
  stats.inserted += result.upsertedCount || 0;
  stats.matched += result.matchedCount || 0;
  stats.modified += result.modifiedCount || 0;
  events.length = 0;
}

async function backfillLeadLifecycleEvents({ clearExisting = false } = {}) {
  const stats = {
    inserted: 0,
    matched: 0,
    cleared: 0,
    byProductLine: {},
  };

  if (clearExisting) {
    const del = await LeadLifecycleEvent.deleteMany({});
    stats.cleared = del.deletedCount || 0;
  }

  const attendeeAtByPhone = await loadAttendeeFirstAtByPhone();
  const buffer = [];

  const flush = async () => {
    await flushEvents(buffer, stats);
  };

  const cursorForm = FormSubmission.find({}).select(
    'phone createdAt updatedAt step1Data step2Data step3Data selectedSlot isRegistered registeredAt applicationStatus postRegistrationData demoInterest currentStep leadStatus utm_source'
  ).cursor();
  for await (const doc of cursorForm) {
    buildRegistrationEvents(doc, attendeeAtByPhone, buffer);
    if (buffer.length >= BATCH_SIZE) await flush();
  }
  await flush();

  const cursorOoo = OneOnOneCounselingLead.find({}).select(
    'mobileNumber createdAt updatedAt formCompleted leadStatus bookingConfirmed bookingConfirmedAt bookingStatus utm_source'
  ).cursor();
  for await (const doc of cursorOoo) {
    buildOneOnOneEvents(doc, buffer);
    if (buffer.length >= BATCH_SIZE) await flush();
  }
  await flush();

  const iitIds = await IitCounsellingSubmission.find({ submissionType: 'iitCounselling' })
    .select('_id')
    .lean();
  const idList = iitIds.map((r) => r._id);

  const [activitiesByLead, historyByLead] = await Promise.all([
    loadActivitiesByLead(idList),
    loadHistoryByLead(idList),
  ]);

  const cursorIit = IitCounsellingSubmission.find({ submissionType: 'iitCounselling' })
    .select(
      'phone createdAt updatedAt callStatus leadStatus demoStatus niatStatus paymentStatus counsellingSlotInstantUtc crmUpdatedAt lastActivityAt utm_source assignedBdaId'
    )
    .cursor();
  for await (const doc of cursorIit) {
    const key = String(doc._id);
    buildIitEvents(
      doc,
      activitiesByLead.get(key) || [],
      historyByLead.get(key) || [],
      buffer
    );
    if (buffer.length >= BATCH_SIZE) await flush();
  }
  await flush();

  const scoreByPhone = new Map();
  const scores = await WhatsAppLeadScore.find({}).lean();
  for (const s of scores) {
    scoreByPhone.set(s.phone, s);
  }

  const profiles = await WhatsAppLeadProfile.find({}).lean();
  const seenPhones = new Set();
  for (const profile of profiles) {
    seenPhones.add(profile.phone);
    buildWhatsAppEvents(profile, scoreByPhone.get(profile.phone), buffer);
    if (buffer.length >= BATCH_SIZE) await flush();
  }
  for (const score of scores) {
    if (!seenPhones.has(score.phone)) {
      buildWhatsAppEvents(null, score, buffer);
      if (buffer.length >= BATCH_SIZE) await flush();
    }
  }
  await flush();

  const cursorHandoff = WhatsAppAgentHandoff.find({ route: 'admin_pool' })
    .select(
      'phone createdAt updatedAt assignedAt claimedAt copilotState reason firstResponseAt resolvedAt'
    )
    .cursor();
  for await (const doc of cursorHandoff) {
    buildCopilotEvents(doc, buffer);
    if (buffer.length >= BATCH_SIZE) await flush();
  }
  await flush();

  for (const line of ['registration', 'oneOnOne', 'iit', 'whatsapp', 'copilot']) {
    stats.byProductLine[line] = await LeadLifecycleEvent.countDocuments({ productLine: line });
  }
  stats.totalEvents = await LeadLifecycleEvent.countDocuments({});
  stats.snapshotsInvalidated = await invalidateAllSnapshots();

  return stats;
}

async function loadActivitiesByLead(leadIds) {
  const map = new Map();
  if (!leadIds.length) return map;
  const rows = await IitCounsellingLeadActivity.find({ leadId: { $in: leadIds } }).lean();
  for (const row of rows) {
    const key = String(row.leadId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

async function loadHistoryByLead(leadIds) {
  const map = new Map();
  if (!leadIds.length) return map;
  const rows = await LeadCallHistory.find({ leadId: { $in: leadIds } }).lean();
  for (const row of rows) {
    const key = String(row.leadId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

async function ensureBackfilled() {
  const count = await LeadLifecycleEvent.estimatedDocumentCount();
  if (count > 0) {
    return { skipped: true, reason: 'events_exist', count };
  }
  const stats = await backfillLeadLifecycleEvents({ clearExisting: false });
  return { skipped: false, stats };
}

module.exports = {
  backfillLeadLifecycleEvents,
  ensureBackfilled,
  buildRegistrationEvents,
  buildOneOnOneEvents,
  buildIitEvents,
  buildWhatsAppEvents,
  buildCopilotEvents,
  isSlotBooked,
};
