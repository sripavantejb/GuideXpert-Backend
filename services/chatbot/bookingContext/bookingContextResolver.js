'use strict';

/**
 * Booking Context Resolver
 *
 * Website is the ONLY booking-create path.
 * WhatsApp resolves BookingContext once per inbound and caches it on leadContext.
 * Maximum one Mongo booking lookup per message.
 */

const IitCounsellingSubmission = require('../../../models/IitCounsellingSubmission');
const { getDemoMeetingLink } = require('../../../utils/slotNotificationFormatters');
const { formatIst, buildLeadContext } = require('../leadContextService');
const {
  CALL_STATUS_LABELS,
  DEMO_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  LEAD_STATUS_LABELS,
} = require('../../../constants/bdaLeadCrm');

function bookingPageUrl() {
  return (
    process.env.IIT_COUNSELLING_PAGE_URL || 'https://www.guidexpert.co.in/iit-counselling'
  );
}

function meetingLinkFromEnv() {
  return getDemoMeetingLink();
}

function clean(value) {
  const text = String(value == null ? '' : value).trim();
  return text || null;
}

function joinList(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const parts = values.map((v) => clean(v)).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function emptyHumanCopilot() {
  return {
    active: false,
    handoffId: null,
    assignedExecutive: null,
    status: null,
    assignedAdminId: null,
    assignedBdaId: null,
    route: null,
    copilotState: null,
  };
}

function emptyBookingContext(phone = null) {
  return {
    exists: false,
    hasBooking: false,
    bookingId: null,
    bookingStatus: 'not_found',
    sessionDate: null,
    sessionTime: null,
    sessionSlotLabel: null,
    sessionInstantLabel: null,
    sessionInstantUtc: null,
    meetingLink: meetingLinkFromEnv(),
    assignedCounsellor: null,
    assignedCounsellorId: null,
    exam: null,
    rank: null,
    category: null,
    gender: null,
    state: null,
    preferredCollege: null,
    preferredBranch: null,
    lifecycleStage: null,
    fullName: null,
    preferredLanguage: null,
    city: null,
    classStatus: null,
    helpNeeded: null,
    leadStatus: null,
    leadStatusLabel: null,
    callStatus: null,
    callStatusLabel: null,
    demoStatus: null,
    demoStatusLabel: null,
    paymentStatus: null,
    paymentStatusLabel: null,
    applicationStatus: null,
    isCompleted: false,
    bookingPageUrl: bookingPageUrl(),
    phone: phone || null,
    humanCopilot: emptyHumanCopilot(),
    source: 'website_crm',
    _meta: {
      mongoQueries: 0,
      resolveMs: 0,
    },
  };
}

function deriveBookingStatus(submission) {
  if (!submission) return 'not_found';
  if (submission.demoStatus === 'attended' || submission.demoStatus === 'not_attended') {
    return 'completed';
  }
  if (submission.demoStatus === 'rescheduled') return 'rescheduled';
  if (submission.leadStatus === 'lost' || submission.leadStatus === 'not_interested') {
    return 'cancelled';
  }
  const instant = submission.counsellingSlotInstantUtc
    ? new Date(submission.counsellingSlotInstantUtc)
    : null;
  if (instant && !Number.isNaN(instant.getTime()) && instant.getTime() < Date.now() - 6 * 60 * 60 * 1000) {
    const slot = submission?.iitCounselling?.section1Data?.slotBooking;
    if (slot || instant) return 'expired';
  }
  const slot = submission?.iitCounselling?.section1Data?.slotBooking;
  if (slot || submission.counsellingSlotInstantUtc) return 'booked';
  if (submission.isCompleted || submission?.iitCounselling?.isCompleted) return 'registered';
  if (submission.applicationStatus === 'completed') return 'registered';
  return 'in_progress';
}

function bookingExists(submission) {
  if (!submission) return false;
  const status = deriveBookingStatus(submission);
  return ['booked', 'registered', 'rescheduled', 'expired', 'completed'].includes(status);
}

function humanCopilotFromConversation(conversation) {
  if (!conversation?.currentHandoffId) return emptyHumanCopilot();
  const active =
    conversation.status === 'handoff' || Boolean(conversation.botPaused);
  return {
    active,
    handoffId: String(conversation.currentHandoffId),
    assignedExecutive: null,
    status: active ? 'open' : null,
    assignedAdminId: null,
    assignedBdaId: null,
    route: null,
    copilotState: active ? 'pending' : null,
  };
}

/**
 * Canonical BookingContext from a single CRM submission document.
 */
function buildBookingContextFromSubmission(submission, humanCopilot = emptyHumanCopilot(), meta = {}) {
  const phone = submission?.phone ? String(submission.phone).slice(-10) : null;
  if (!submission) {
    const empty = emptyBookingContext(phone);
    empty.humanCopilot = humanCopilot || emptyHumanCopilot();
    empty._meta = {
      mongoQueries: Number(meta.mongoQueries) || 0,
      resolveMs: Number(meta.resolveMs) || 0,
    };
    return empty;
  }

  const s1 = submission.iitCounselling?.section1Data || {};
  const s2 = submission.iitCounselling?.section2Data || {};
  const s3 = submission.iitCounselling?.section3Data || {};
  const slotBooking = clean(s1.slotBooking);
  const sessionDate = clean(s1.slotBookingDate);
  const sessionTime = slotBooking ? String(slotBooking).replace(/^[A-Za-z]+\s+/, '') : null;
  const status = deriveBookingStatus(submission);
  const exists = bookingExists(submission);

  return {
    exists,
    hasBooking: exists,
    bookingId: String(submission._id),
    bookingStatus: status,
    sessionDate,
    sessionTime,
    sessionSlotLabel: slotBooking,
    sessionInstantLabel: formatIst(submission.counsellingSlotInstantUtc),
    sessionInstantUtc: submission.counsellingSlotInstantUtc || null,
    meetingLink: meetingLinkFromEnv(),
    assignedCounsellor: clean(submission.assignedBdaName),
    assignedCounsellorId: submission.assignedBdaId ? String(submission.assignedBdaId) : null,
    exam: clean(s1.stream) ? `Stream: ${clean(s1.stream)}` : null,
    rank: null,
    category: null,
    gender: null,
    state: clean(s1.city),
    preferredCollege: joinList(s1.top5Colleges),
    preferredBranch:
      clean(s3.biggestConfusion) === 'Course' ? 'Course guidance requested' : null,
    lifecycleStage: clean(submission.leadStatus) || status,
    fullName: clean(submission.fullName) || clean(s1.fullName),
    preferredLanguage: clean(s2.preferredLanguage),
    city: clean(s1.city),
    classStatus: clean(s1.classStatus),
    helpNeeded: clean(s3.helpNeeded),
    leadStatus: clean(submission.leadStatus),
    leadStatusLabel: LEAD_STATUS_LABELS?.[submission.leadStatus] || clean(submission.leadStatus),
    callStatus: clean(submission.callStatus),
    callStatusLabel: CALL_STATUS_LABELS[submission.callStatus] || clean(submission.callStatus),
    demoStatus: clean(submission.demoStatus),
    demoStatusLabel: DEMO_STATUS_LABELS[submission.demoStatus] || clean(submission.demoStatus),
    paymentStatus: clean(submission.paymentStatus),
    paymentStatusLabel:
      PAYMENT_STATUS_LABELS[submission.paymentStatus] || clean(submission.paymentStatus),
    applicationStatus: clean(submission.applicationStatus),
    isCompleted: Boolean(submission.isCompleted || submission?.iitCounselling?.isCompleted),
    bookingPageUrl: bookingPageUrl(),
    phone,
    humanCopilot: humanCopilot || emptyHumanCopilot(),
    source: 'website_crm',
    _meta: {
      mongoQueries: Number(meta.mongoQueries) || 0,
      resolveMs: Number(meta.resolveMs) || 0,
    },
  };
}

async function loadLatestSubmissionOnce({ phone10, submissionId = null } = {}) {
  let mongoQueries = 0;
  if (submissionId) {
    mongoQueries += 1;
    const byId = await IitCounsellingSubmission.findById(submissionId).lean();
    if (byId) return { submission: byId, mongoQueries };
  }
  const phone = String(phone10 || '').replace(/\D/g, '').slice(-10);
  if (!phone) return { submission: null, mongoQueries };
  mongoQueries += 1;
  const submission = await IitCounsellingSubmission.findOne({ phone })
    .sort({ updatedAt: -1 })
    .lean();
  return { submission, mongoQueries };
}

/**
 * Resolve BookingContext once. Prefer conversation handoff fields (no second query).
 */
async function resolveBookingContext({
  phone10,
  leadLinks = {},
  conversationId = null,
  conversation = null,
  preloadedSubmission = undefined,
} = {}) {
  const started = Date.now();
  const phone = String(phone10 || leadLinks.phone || '').replace(/\D/g, '').slice(-10);

  let submission = preloadedSubmission;
  let mongoQueries = 0;
  if (submission === undefined) {
    const loaded = await loadLatestSubmissionOnce({
      phone10: phone,
      submissionId: leadLinks.iitCounsellingSubmissionId || null,
    });
    submission = loaded.submission;
    mongoQueries = loaded.mongoQueries;
  }

  const humanCopilot = humanCopilotFromConversation(conversation);
  return buildBookingContextFromSubmission(submission, humanCopilot, {
    mongoQueries,
    resolveMs: Date.now() - started,
  });
}

function attachBookingContext(leadContext, bookingContext) {
  const base = leadContext && typeof leadContext === 'object' ? { ...leadContext } : {};
  const booking = bookingContext || emptyBookingContext(base.phone);
  base.booking = booking;
  base.bookingContext = booking;
  base.hasBooking = Boolean(booking.exists);
  if (booking.meetingLink) base.meetingLink = booking.meetingLink;
  if (booking.bookingPageUrl) base.iitPageUrl = booking.bookingPageUrl;
  return base;
}

/**
 * Build leadContext + BookingContext with a single IIT Mongo lookup.
 */
async function buildLeadContextWithBooking(links, conversationId = null, conversation = null) {
  const started = Date.now();
  const phone = String(links.phone || '').replace(/\D/g, '').slice(-10);

  const { submission, mongoQueries } = await loadLatestSubmissionOnce({
    phone10: phone,
    submissionId: links.iitCounsellingSubmissionId || null,
  });

  const booking = buildBookingContextFromSubmission(
    submission,
    humanCopilotFromConversation(conversation),
    {
      mongoQueries,
      resolveMs: Date.now() - started,
    }
  );

  const base = await buildLeadContext(links, { preloadedIit: submission });
  const enriched = attachBookingContext(base, booking);
  enriched.booking._meta.resolveMs = Date.now() - started;
  return enriched;
}

module.exports = {
  emptyBookingContext,
  emptyHumanCopilot,
  buildBookingContextFromSubmission,
  resolveBookingContext,
  attachBookingContext,
  buildLeadContextWithBooking,
  bookingExists,
  deriveBookingStatus,
  hasActiveBooking: bookingExists,
  mapSubmissionToBookingFields: (submission) =>
    buildBookingContextFromSubmission(submission, emptyHumanCopilot()),
  bookingPageUrl,
  meetingLinkFromEnv,
  loadLatestSubmissionOnce,
};
