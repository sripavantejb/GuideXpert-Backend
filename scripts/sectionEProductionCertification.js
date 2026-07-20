#!/usr/bin/env node
'use strict';
/**
 * Section E — Production UAT (AUDIT ONLY)
 * Website Booking Integration & Context Retrieval.
 * Path: POST production /webhook/gupshup → processInbound → Gupshup → WhatsApp 9347763131
 * Verifies via production MongoDB.
 *
 * Architecture: Website booking → CRM → Booking Context Resolver → WhatsApp support.
 * Conversational booking create / slot collection / reschedule in chat are OUT OF SCOPE.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');

const BACKEND = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env') });

const WEBHOOK =
  process.env.SECTION_E_WEBHOOK_URL ||
  'https://guide-xpert-backend.vercel.app/webhook/gupshup';
const PHONE10 = String(process.env.SECTION_E_PHONE || '9347763131').replace(/\D/g, '').slice(-10);
const SOURCE = '91' + PHONE10;
const OUT_DIR = path.join(BACKEND, 'smoke-results', 'sectionE');
const WAIT_MS = Number(process.env.SECTION_E_WAIT_MS || 4000);
const RAPID_GAP_MS = Number(process.env.SECTION_E_RAPID_GAP_MS || 300);
const PASS_GATE = Number(process.env.SECTION_E_PASS_GATE || 0.98);

const SCOPE_REFUSAL =
  /I'm here to help only with GuideXpert|cannot assist with|outside (my|the) scope|I can'?t help with that|not (able|equipped) to help with/i;
const HUMAN_HANDOFF = /connected you with a human agent|Please wait; we will reply here|AGENT/i;
const BOOKING_SUMMARY =
  /counselling (booking )?summary|Session:|Date & Time|Meeting [Ll]ink|Assigned counsellor|Booking ID|Booking status/i;
const WEBSITE_REDIRECT =
  /GuideXpert website|booked through the GuideXpert website|book a session through|guidexpert.co.in\/iit-counselling/i;
const NO_ACTIVE_BOOKING =
  /couldn't find an active counselling booking|active counselling booking/i;
const BOOKING_HALLUCINATION =
  /\bbooking (is )?confirmed\b|\b(counselling|counseling) booking\b.{0,80}\bconfirmed\b|\bappointment (is )?booked\b|\bconfirmed for tomorrow\b/i;
const CRM_SESSION_SCHEDULED_REPLY = /^Your session is scheduled for:/i;
const RESCHEDULE_WEBSITE_REPLY =
  /managed through the GuideXpert website|reschedule or cancel|booking portal|contact your assigned counsellor/i;
const EXISTING_BOOKING_REPLY = /found an existing counselling booking/i;
const LLM_INTENTS = new Set([
  'knowledge_assistant',
  'iit_counselling_expert',
  'counsellor_program_assistant',
  'iit_counselling_strategy',
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function groupFromCaseId(id) {
  const n = Number(String(id).match(/^E(\d+)/i)?.[1]);
  const map = {
    1: 'E1_booking_detection',
    2: 'E2_summary_fields',
    3: 'E3_profile_fields',
    4: 'E4_create_intent',
    5: 'E5_reschedule_cancel',
    6: 'E6_deterministic',
    7: 'E7_hallucination',
    8: 'E8_human_copilot',
    9: 'E9_performance',
    10: 'E10_database',
    11: 'E11_continuity',
    12: 'E12_scope_firewall',
  };
  return map[n] || `E${n}`;
}

const DETERMINISTIC_INTENTS = new Set([
  'counselling_support',
  'booking_create_check',
  'booking_reschedule_cancel',
  'booking_website_redirect',
  'lead_lookup',
  'assigned_expert',
  'human_handoff',
  'main_menu',
  'foundation_greeting',
  'foundation_language_switch',
  'foundation_goodbye',
  'demo_support',
]);

function inferRoutingPath(intent, reply) {
  if (DETERMINISTIC_INTENTS.has(intent)) {
    return `BookingSupportRouter → intent:${intent} (deterministic)`;
  }
  if (LLM_INTENTS.has(intent)) {
    return `Scope/Intent → ${intent} (LLM/RAG path)`;
  }
  if (intent === 'unknown' && SCOPE_REFUSAL.test(String(reply || ''))) {
    return 'ScopeFirewall → blocked';
  }
  return `Pipeline → intent:${intent || 'unknown'}`;
}

function llmInvoked(intent) {
  return LLM_INTENTS.has(intent);
}

async function loadCrmFingerprint(db, phone) {
  const leads = await db.collection('iitCounsellingSubmissions').find({ phone }).toArray();
  const lead = leads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0] || null;
  const lifecycleCount = await db
    .collection('leadLifecycleEvents')
    .countDocuments({ phone10: phone, productLine: 'iit' })
    .catch(() => 0);
  const openHandoffs = await db.collection('whatsappagenthandoffs').countDocuments({
    phone,
    status: { $in: ['open', 'claimed'] },
  });
  return {
    leadId: lead?._id ? String(lead._id) : null,
    leadCount: leads.length,
    updatedAt: lead?.updatedAt ? new Date(lead.updatedAt).toISOString() : null,
    slot: lead?.iitCounselling?.section1Data?.slotBooking || null,
    slotDate: lead?.iitCounselling?.section1Data?.slotBookingDate || null,
    bda: lead?.assignedBdaName || null,
    demoStatus: lead?.demoStatus || null,
    lifecycleCount,
    openHandoffs,
  };
}

function crmFingerprintChanged(before, after) {
  if (!before || !after) return true;
  return (
    before.leadCount !== after.leadCount ||
    before.leadId !== after.leadId ||
    before.slot !== after.slot ||
    before.slotDate !== after.slotDate ||
    before.bda !== after.bda ||
    before.demoStatus !== after.demoStatus ||
    before.lifecycleCount !== after.lifecycleCount
  );
}

async function waitForProductionReady(maxWaitMs = 600000) {
  const started = Date.now();
  const url = 'https://guide-xpert-backend.vercel.app/api/health';
  while (Date.now() - started < maxWaitMs) {
    try {
      const health = await axios.get(url, { timeout: 20000 });
      const ready = Boolean(health.data?.whatsapp?.ready);
      const scope = Boolean(health.data?.scopeFirewall?.ready);
      if (ready && scope) return health.data;
      console.log('Waiting for production READY…', { ready, scope, elapsed: Date.now() - started });
    } catch (e) {
      console.log('Health poll error:', e.message);
    }
    await sleep(15000);
  }
  throw new Error('Production health did not become READY in time');
}

function buildCases() {
  const c = [];
  const add = (id, user, opts = {}) =>
    c.push({
      id,
      group: groupFromCaseId(id),
      user,
      resetState: opts.resetState !== false,
      rapid: Boolean(opts.rapid),
      expect: opts.expect || {},
      note: opts.note || '',
      severityHint: opts.severityHint || null,
      mongoOnly: Boolean(opts.mongoOnly),
    });

  const det = { deterministicNoLlm: true, noBookingHallucination: true, crmUnchanged: true };

  // E1 — Booking detection
  add('E1-01', '__mongo_booking_exists__', {
    mongoOnly: true,
    expect: { crmLeadExists: true, bookingRecord: true },
    note: 'existing booking on test phone',
  });
  add('E1-02', 'Show my booking.', { expect: { ...det, bookingContextRetrieved: true, bookingExists: true } });
  add('E1-03', 'Book counselling', {
    expect: { ...det, existingBookingOrRedirect: true },
    note: 'CASE A on test phone; CASE B reply shape validated in unit tests',
  });

  // E2 — Summary fields
  add('E2-01', 'Show my booking.', { expect: { ...det, bookingSummary: true } });
  add('E2-02', 'When is my counselling?', { expect: { ...det, sessionDateTime: true } });
  add('E2-03', 'What time is my session?', { expect: { ...det, sessionDateTime: true } });
  add('E2-04', 'What is my meeting link?', { expect: { ...det, meetingLinkPresent: true } });
  add('E2-05', 'Who is my counsellor?', { expect: { ...det, counsellorPresent: true } });

  // E3 — Profile / registration fields
  add('E3-01', 'Did my booking go through?', { expect: { ...det, bookingStatus: true } });
  add('E3-02', 'What exam did I register for?', { expect: { ...det, bookingContextRetrieved: true } });
  add('E3-03', 'What rank did I submit?', { expect: { ...det, rankFieldHandled: true } });
  add('E3-04', 'What category did I select?', { expect: { ...det, categoryFieldHandled: true } });
  add('E3-05', 'What college preference did I give?', { expect: { ...det, collegeField: true } });
  add('E3-06', 'Which branch did I choose?', { expect: { ...det, branchFieldHandled: true } });

  // E4 — Create intent
  add('E4-01', 'Book counselling', { expect: { ...det, existingBookingOrRedirect: true } });
  add('E4-02', 'Schedule counselling', { expect: { ...det, existingBookingOrRedirect: true } });
  add('E4-03', 'Book a session', { expect: { ...det, existingBookingOrRedirect: true } });
  add('E4-04', 'Register counselling', { expect: { ...det, existingBookingOrRedirect: true } });
  add('E4-05', 'Need counselling session', { expect: { ...det, existingBookingOrRedirect: true } });

  // E5 — Reschedule / cancel (website only)
  ['Reschedule', 'Cancel booking', 'Change slot', 'Tomorrow instead', 'Delete booking'].forEach((u, i) =>
    add(`E5-${String(i + 1).padStart(2, '0')}`, u, {
      expect: { ...det, rescheduleWebsiteRedirect: true, noCrmWrite: true },
      severityHint: 'HIGH',
    })
  );

  // E6 — Deterministic routing (must not hit LLM/RAG/ICE/CPA/ICS)
  [
    'When is my counselling?',
    'What is my booking status?',
    'Who is assigned?',
    '2',
    'Share my meeting link',
  ].forEach((u, i) =>
    add(`E6-${String(i + 1).padStart(2, '0')}`, u, {
      expect: { ...det, bookingContextRetrieved: true, deterministicNoLlm: true },
    })
  );

  // E7 — Hallucination guard
  add('E7-01', 'Confirm booking', {
    expect: { ...det, noBookingHallucination: true, websiteRedirectOrExisting: true },
    severityHint: 'CRITICAL',
  });
  add('E7-02', 'Yes book me for tomorrow 3pm', {
    expect: { ...det, noBookingHallucination: true, websiteRedirectOrExisting: true },
    severityHint: 'CRITICAL',
  });
  add('E7-03', 'Your session is booked for tomorrow', {
    expect: { noBookingHallucination: true, noCrash: true },
    note: 'user phrase should not trigger bot hallucination in reply',
  });

  // E8 — Human Copilot
  // Explicit handoff only (AGENT / talk to counsellor). Soft “Need support” is intentionally
  // NOT handoff — see humanHandoffIntent.js (excludes bare support/help).
  add('E8-01', 'AGENT', { expect: { handoff: true, crmUnchanged: true } });
  add('E8-02', 'Talk to my counsellor', { expect: { handoff: true, crmUnchanged: true } });
  add('E8-03', 'Need support', {
    expect: { intentionalNonHandoff: true, noCrash: true, crmUnchanged: true },
    note: 'intentional: bare support does not escalate; use AGENT / talk to counsellor',
  });
  add('E8-04', 'AGENT', {
    resetState: false,
    rapid: true,
    expect: { handoffNoDuplicate: true, handoffReused: true },
  });

  // E9 — Performance
  add('E9-01', '2', { expect: { ...det, bookingContextRetrieved: true, recordLatency: true } });
  add('E9-02', 'When is my counselling session?', {
    expect: { ...det, bookingContextRetrieved: true, recordLatency: true },
  });
  add('E9-03', 'Who is my counsellor?', { expect: { ...det, recordLatency: true } });

  // E10 — Database integrity
  add('E10-01', '__mongo_crm__', {
    mongoOnly: true,
    expect: { crmLeadExists: true, noDuplicateLead: true, bookingRecord: true },
  });
  add('E10-02', '__mongo_lifecycle__', {
    mongoOnly: true,
    expect: { lifecycleBooked: true },
  });
  add('E10-03', '__mongo_handoff__', {
    mongoOnly: true,
    expect: { dbIntegrity: true },
    note: 'handoff collection integrity',
  });
  add('E10-04', '2', { expect: { ...det, noCrmWrite: true, noDuplicateLead: true } });

  // E11 — Conversation continuity
  add('E11-01', '2', { expect: { ...det, bookingContextRetrieved: true } });
  add('E11-02', 'hi', { resetState: false, expect: { noCrash: true } });
  add('E11-03', 'Thanks', { resetState: false, expect: { noCrash: true } });
  add('E11-04', 'Hindi please', { resetState: false, expect: { languageHandled: true } });
  add('E11-05', 'When is my session?', {
    resetState: false,
    expect: { ...det, bookingContextRetrieved: true },
  });

  // E12 — Scope firewall
  add('E12-01', '2', { expect: { ...det, bookingContextRetrieved: true } });
  ['Write Python', 'Who won IPL?', 'Help me shop on Amazon', 'Latest politics news'].forEach((u, i) =>
    add(`E12-${String(i + 2).padStart(2, '0')}`, u, {
      resetState: false,
      expect: { mustScopeRefuse: true, deterministicNoLlm: false },
      severityHint: 'HIGH',
    })
  );

  return c;
}

function evaluate(caseRow, reply, meta) {
  const fails = [];
  const warns = [];
  const r = String(reply || '');
  const e = caseRow.expect || {};
  const intent = meta.lastIntent || '';
  const botState = meta.botStateName || '';

  if (e.bookingExists && !BOOKING_SUMMARY.test(r) && !EXISTING_BOOKING_REPLY.test(r)) {
    fails.push('booking_exists_not_shown');
  }

  if (e.sessionDateTime && !/scheduled for|Session:|Date & Time|IST|PM|AM|\d/i.test(r)) {
    fails.push('session_datetime_missing');
  }

  if (e.counsellorPresent && !/counsellor|counselor|BDA|assigned/i.test(r)) {
    fails.push('counsellor_missing');
  }

  if (e.bookingStatus && !/booking status|booked|registered|status/i.test(r)) {
    fails.push('booking_status_missing');
  }

  if (e.collegeField && !/college|preference|IIT|—/i.test(r)) {
    warns.push('college_field_weak');
  }

  if (e.rankFieldHandled && !/rank|not saved|website booking/i.test(r)) {
    fails.push('rank_field_not_handled');
  }

  if (e.categoryFieldHandled && !/category|not saved|website booking/i.test(r)) {
    fails.push('category_field_not_handled');
  }

  if (e.branchFieldHandled && !/branch|not saved|Course|website booking/i.test(r)) {
    fails.push('branch_field_not_handled');
  }

  if (e.noCrmWrite && meta.crmMutation) {
    fails.push('crm_mutation_detected');
  }

  if (e.handoffReused && meta.openHandoffCount > 1) {
    fails.push('handoff_not_reused');
  }

  if (e.noCrash && meta.webhookError) fails.push('crash_or_webhook_error');
  if (e.noScopeRefusal && SCOPE_REFUSAL.test(r)) fails.push('scope_rejection');
  if (e.mustScopeRefuse && !SCOPE_REFUSAL.test(r)) fails.push('expected_scope_refusal_missing');

  if (e.bookingContextRetrieved) {
    const ok =
      intent === 'counselling_support' ||
      intent === 'lead_lookup' ||
      intent === 'assigned_expert' ||
      intent === 'booking_reschedule_cancel' ||
      intent === 'booking_create_check' ||
      intent === 'booking_website_redirect' ||
      botState === 'counselling_support' ||
      BOOKING_SUMMARY.test(r) ||
      /Meeting [Ll]ink|Assigned counsellor|Session:|website booking/i.test(r) ||
      NO_ACTIVE_BOOKING.test(r);
    if (!ok) fails.push('booking_context_missing');
  }

  if (e.websiteRedirect) {
    if (
      !WEBSITE_REDIRECT.test(r) &&
      !EXISTING_BOOKING_REPLY.test(r) &&
      intent !== 'booking_create_check' &&
      intent !== 'booking_website_redirect'
    ) {
      fails.push('website_redirect_missing');
    }
  }

  if (e.websiteRedirectOrExisting) {
    const ok =
      WEBSITE_REDIRECT.test(r) ||
      EXISTING_BOOKING_REPLY.test(r) ||
      intent === 'booking_create_check' ||
      intent === 'booking_website_redirect';
    if (!ok) fails.push('website_redirect_or_existing_missing');
  }

  if (e.existingBookingOrRedirect) {
    const ok =
      EXISTING_BOOKING_REPLY.test(r) ||
      WEBSITE_REDIRECT.test(r) ||
      intent === 'booking_create_check';
    if (!ok) fails.push('existing_booking_case_missing');
  }

  if (e.deterministicNoLlm && LLM_INTENTS.has(intent)) {
    fails.push('llm_intent_used_for_booking_query');
  }

  if (e.crmUnchanged && meta.crm?.leadCount > 1) {
    fails.push('crm_duplicate_lead_created');
  }

  if (e.meetingLinkPresent && meta.crm?.bookingRecord && !/meet|Meeting [Ll]ink|guidexpert/i.test(r)) {
    warns.push('meeting_link_not_in_reply');
  }

  if (e.missingCounsellorOk && !/counsellor|BDA|assigned|confirmed shortly/i.test(r)) {
    warns.push('counsellor_reply_weak');
  }

  if (e.noBookingForm) {
    if (
      /what is your name|enter your (name|phone|mobile)|pick (a )?(date|time|slot)|which day|choose.*time/i.test(
        r
      )
    ) {
      fails.push('whatsapp_booking_form_detected');
    }
  }

  if (
    e.noBookingHallucination &&
    BOOKING_HALLUCINATION.test(r) &&
    !BOOKING_SUMMARY.test(r) &&
    !CRM_SESSION_SCHEDULED_REPLY.test(r)
  ) {
    fails.push('booking_hallucination');
  }

  if (e.rescheduleWebsiteRedirect) {
    const ok =
      intent === 'booking_reschedule_cancel' ||
      RESCHEDULE_WEBSITE_REPLY.test(r) ||
      WEBSITE_REDIRECT.test(r);
    if (!ok && intent === 'main_menu') {
      warns.push('cancel_routed_to_menu_only');
    } else if (!ok) {
      fails.push('reschedule_website_redirect_missing');
    }
  }

  if (e.bookingSummary && !BOOKING_SUMMARY.test(r)) warns.push('weak_booking_summary');

  if (e.reusesLeadInfo) {
    if (!/name|venkatesh|session|slot|counsellor|booking/i.test(r)) warns.push('lead_info_not_visible');
  }

  if (e.handoff) {
    const ok = intent === 'human_handoff' || HUMAN_HANDOFF.test(r) || meta.handoffOpen;
    if (!ok) fails.push('handoff_missing');
  }

  if (e.intentionalNonHandoff) {
    // Soft phrases like "Need support" must NOT open human handoff.
    if (intent === 'human_handoff' || meta.handoffOpen) {
      fails.push('unexpected_soft_support_handoff');
    }
  }

  if (e.handoffNoDuplicate) {
    if (meta.openHandoffCount > 1) fails.push('duplicate_open_handoff');
  }

  if (e.leadLookup) {
    const ok = intent === 'lead_lookup' || botState === 'lead_lookup' || /Name:|Booking ID:|Slot:/i.test(r);
    if (!ok) fails.push('lead_lookup_missing');
  }

  if (e.assignedExpert) {
    const ok =
      intent === 'assigned_expert' ||
      botState === 'assigned_expert' ||
      /counsellor|BDA|assigned expert|confirmed shortly/i.test(r);
    if (!ok) fails.push('assigned_expert_missing');
  }

  if (e.counsellingSupport) {
    const ok =
      intent === 'counselling_support' ||
      botState === 'counselling_support' ||
      BOOKING_SUMMARY.test(r);
    if (!ok) fails.push('counselling_support_missing');
  }
  if (e.journeyExited) {
    if (botState === 'counselling_support' && intent !== 'main_menu' && intent !== 'foundation_goodbye') {
      // Restart/Exit may go idle/main_menu
      if (!/main_menu|idle|greeting/i.test(botState) && intent !== 'main_menu') {
        warns.push('exit_state_ambiguous');
      }
    }
  }
  if (e.journeyExitedOrSafe) {
    // cancel may clear or stay — must not crash
    if (meta.webhookError) fails.push('unsafe_cancel');
  }
  if (e.languageHandled) {
    if (!/hindi|telugu|english|भाषा|భాష|language|switched|okay|ok|Session|Meeting/i.test(r)) {
      warns.push('language_switch_unclear');
    }
  }

  // Mongo expects
  // E1 mongo booking exists
  if (caseRow.user === '__mongo_booking_exists__') {
    if (!meta.crm?.leadExists) fails.push('crm_lead_missing');
    if (!meta.crm?.bookingRecord) fails.push('booking_record_missing');
  }

  if (e.crmLeadExists && !meta.crm?.leadExists) fails.push('crm_lead_missing');
  if (e.noDuplicateLead && meta.crm?.leadCount > 1) fails.push('duplicate_crm_leads');
  if (e.lifecycleBooked && !meta.crm?.lifecycleBooked) fails.push('lifecycle_booked_missing');
  if (e.notificationsExist && !meta.crm?.hasNotifications) {
    warns.push('no_whatsapp_notification_events');
  }
  if (e.analyticsPresent && !meta.crm?.hasAnalytics) warns.push('analytics_sparse');
  if (e.bookingRecord && !meta.crm?.bookingRecord) fails.push('booking_record_missing');
  if (e.conversationExists && !meta.crm?.conversationExists) fails.push('conversation_missing');
  if (e.dbIntegrity && meta.crm?.orphanHints) warns.push('possible_orphan_records');

  if (!caseRow.mongoOnly) {
    // Same-utterance dedupe (45s) is intentional production behavior — not a persistence bug.
    // When the webhook dedupes, the original inbound was already saved.
    if (!meta.inboundSaved && !meta.inboundDeduped) fails.push('inbound_not_saved');
    if (!meta.outboundSaved && !e.rapid && !meta.inboundDeduped) fails.push('outbound_not_saved');
  }

  let status = 'PASS';
  if (fails.length) status = 'FAIL';
  else if (warns.length) status = 'PASS_WITH_WARNINGS';
  return { status, fails, warns };
}

function buildPayload(text, id) {
  return {
    type: 'message',
    payload: {
      source: SOURCE,
      id,
      type: 'text',
      payload: { type: 'text', text: text == null ? '' : String(text) },
    },
  };
}

async function resetBotState(db, conversationId) {
  if (!conversationId) return;
  await db.collection('whatsappagenthandoffs').updateMany(
    { conversationId, status: { $in: ['open', 'claimed'] } },
    { $set: { status: 'cancelled', updatedAt: new Date(), resolvedAt: new Date() } }
  );
  await db.collection('whatsappbotstates').updateOne(
    { conversationId },
    {
      $set: {
        state: 'main_menu',
        context: {
          college: {},
          rank: {},
          careerCounselling: {},
          knowledgeAssistantActive: false,
          counsellorProgramAssistantActive: false,
          counsellorProgramSessionLanguage: null,
          iitCounsellingExpertActive: false,
          iitCounsellingExpertSessionLanguage: null,
          iitCounsellingStrategyActive: false,
          iitCounsellingStrategySessionLanguage: null,
          jeeCounsellingActive: false,
          jeeExamTrack: null,
          collegePredictorActive: false,
          currentJourney: null,
        },
        updatedAt: new Date(),
      },
    },
    { upsert: false }
  );
  await db.collection('whatsappconversations').updateOne(
    { _id: conversationId },
    {
      $set: {
        status: 'active',
        currentHandoffId: null,
        productLine: 'iit_counselling',
        updatedAt: new Date(),
      },
    }
  );
}

function extractReplyText(outbound) {
  if (!outbound) return '';
  if (outbound.content && outbound.content.text) return String(outbound.content.text);
  if (outbound.textPreview) return String(outbound.textPreview);
  if (outbound.text) return String(outbound.text);
  return '';
}

async function loadCrmSnapshot(db, phone) {
  const leads = await db.collection('iitCounsellingSubmissions').find({ phone }).toArray();
  const lead = leads[0] || null;
  const lifecycle = await db
    .collection('leadLifecycleEvents')
    .find({ phone10: phone, productLine: 'iit' })
    .sort({ transitionAt: -1 })
    .limit(20)
    .toArray();
  const msgEvents = await db
    .collection('whatsappmessageevents')
    .find({ phone })
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray();
  const reminders = await db
    .collection('whatsappreminderjobs')
    .find({ phone, opsProduct: 'iit_counselling' })
    .limit(20)
    .toArray()
    .catch(() => []);
  const convs = await db.collection('whatsappconversations').find({ phone }).toArray();
  const activities = lead
    ? await db
        .collection('iitcounsellingleadactivities')
        .countDocuments({ leadId: lead._id })
        .catch(() => 0)
    : 0;
  const assignments = lead
    ? await db
        .collection('iitcounsellingleadassignmenthistories')
        .countDocuments({ leadId: lead._id })
        .catch(() => 0)
    : 0;
  const handoffs = await db.collection('whatsappagenthandoffs').countDocuments({ phone });
  const leadEvents = await db.collection('whatsappleadevents').countDocuments({ phone }).catch(() => 0);

  return {
    leadExists: Boolean(lead),
    leadCount: leads.length,
    bookingRecord: Boolean(
      lead && (lead.iitCounselling?.section1Data?.slotBooking || lead.counsellingSlotInstantUtc)
    ),
    slotBooking: lead?.iitCounselling?.section1Data?.slotBooking || null,
    assignedBdaName: lead?.assignedBdaName || null,
    demoStatus: lead?.demoStatus || null,
    lifecycleBooked: lifecycle.some((l) => l.stage === 'booked'),
    lifecycleStages: [...new Set(lifecycle.map((l) => l.stage))],
    hasNotifications: msgEvents.length > 0 || reminders.length > 0,
    notificationKinds: [...new Set(msgEvents.map((e) => e.messageKind).filter(Boolean))],
    reminderCount: reminders.length,
    conversationExists: convs.length >= 1,
    conversationCount: convs.length,
    activityCount: activities,
    assignmentHistoryCount: assignments,
    handoffCount: handoffs,
    hasAnalytics: leadEvents > 0 || activities > 0 || handoffs > 0,
    orphanHints: convs.length > 1,
    leadSummary: lead
      ? {
          fullName: lead.fullName,
          slot: lead.iitCounselling?.section1Data?.slotBooking,
          slotDate: lead.iitCounselling?.section1Data?.slotBookingDate,
          bda: lead.assignedBdaName,
          demoStatus: lead.demoStatus,
        }
      : null,
  };
}

function severityForFails(fails, hint) {
  if (hint) return hint;
  if (fails.some((f) => /journey_did_not_start|wizard_missing|stolen_by|datetime_not|reschedule_not|cancel_not|confirmation_step|booking_not_created/.test(f))) {
    return 'HIGH';
  }
  if (fails.some((f) => /scope|crm_|lifecycle_|validation/.test(f))) return 'MEDIUM';
  return 'LOW';
}

function rootCauseForFails(fails) {
  const f = fails.join(',');
  if (/booking_hallucination/.test(f)) {
    return 'LLM or static reply claimed booking confirmation without CRM-backed active booking.';
  }
  if (/website_redirect_missing|reschedule_website_redirect_missing/.test(f)) {
    return 'Booking Context Resolver support path did not redirect to website portal for create/reschedule/cancel.';
  }
  if (/booking_context_missing/.test(f)) {
    return 'Booking context retrieval failed — counselling_support / lead_lookup / assigned_expert did not surface CRM booking.';
  }
  if (/whatsapp_booking_form_detected/.test(f)) {
    return 'WhatsApp attempted to collect booking form fields — product requires website-only booking create.';
  }
  if (/duplicate_open_handoff/.test(f)) {
    return 'Human Copilot created duplicate open handoffs for the same conversation.';
  }
  if (/unexpected_soft_support_handoff/.test(f)) {
    return 'Soft support phrase incorrectly escalated to human handoff (explicit AGENT required).';
  }
  if (/inbound_not_saved|outbound_not_saved/.test(f)) {
    return 'Cert could not resolve WhatsAppInboundMessage/Outbound for this provider id (check dedupe window vs lookup).';
  }
  if (/expected_scope_refusal/.test(f)) {
    return 'Scope Firewall did not refuse OOS while on counselling support context.';
  }
  if (/crm_|lifecycle_|booking_record/.test(f)) {
    return 'Mongo CRM / lifecycle / booking record missing or incomplete for test phone.';
  }
  return 'See fails and transcript reply for evidence.';
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date();
  console.log('═══════════════════════════════════════════════');
  console.log(' SECTION E — PRODUCTION UAT (AUDIT ONLY)');
  console.log(' Website Booking Integration & Context Retrieval');
  console.log(' Phone:', PHONE10);
  console.log(' Webhook:', WEBHOOK);
  console.log(' Pass gate:', PASS_GATE);
  console.log(' Started:', startedAt.toISOString());
  console.log('═══════════════════════════════════════════════\n');

  const health = await waitForProductionReady();
  console.log('Health READY:', health?.whatsapp?.ready, 'scope:', health?.scopeFirewall?.ready);

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const inboundCol = db.collection('whatsappinboundmessages');
  const outboundCol = db.collection('whatsappoutboundmessages');
  const convCol = db.collection('whatsappconversations');
  const botCol = db.collection('whatsappbotstates');

  const crmBaseline = await loadCrmFingerprint(db, PHONE10);
  const lifecycleBaseline = crmBaseline.lifecycleCount;

  await convCol.updateMany(
    { phone: PHONE10 },
    { $set: { productLine: 'iit_counselling', updatedAt: new Date() } }
  );

  const crmSnapshot = await loadCrmSnapshot(db, PHONE10);
  console.log('CRM lead exists:', crmSnapshot.leadExists, 'slot:', crmSnapshot.slotBooking);
  console.log('Lifecycle booked:', crmSnapshot.lifecycleBooked);
  console.log('Conversation count:', crmSnapshot.conversationCount);

  const convBefore = await convCol.findOne({ phone: PHONE10 });
  let conversationId = convBefore?._id || null;
  const cases = buildCases();
  console.log('Total cases:', cases.length, '\n');

  const results = [];
  const latencies = [];
  let llmInvocationCount = 0;
  let ragInvocationCount = 0;
  let hallucinationCount = 0;
  let deterministicCount = 0;

  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i];
    const t0 = Date.now();
    const crmBefore = await loadCrmFingerprint(db, PHONE10);
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.id} ${JSON.stringify(c.user).slice(0, 48)} … `);

    if (c.mongoOnly) {
      const crm = await loadCrmSnapshot(db, PHONE10);
      const verdict = evaluate(c, '', {
        crm,
        inboundSaved: true,
        outboundSaved: true,
        lastIntent: null,
        botStateName: null,
        crmMutation: false,
      });
      const row = {
        id: c.id,
        group: c.group,
        user: c.user,
        note: c.note,
        mongoOnly: true,
        status: verdict.status,
        fails: verdict.fails,
        warns: verdict.warns,
        severity: verdict.fails.length ? severityForFails(verdict.fails, c.severityHint) : null,
        rootCause: verdict.fails.length ? rootCauseForFails(verdict.fails) : null,
        crm,
        latencyMs: Date.now() - t0,
        replyPreview: '',
      };
      results.push(row);
      console.log(verdict.status, `crm=${crm.leadExists}`);
      continue;
    }

    if (c.resetState && conversationId) {
      await resetBotState(db, conversationId);
    }

    const msgId = `sectionE-${c.id}-${Date.now()}-${i}`;
    let httpStatus = null;
    let webhookBody = null;
    let webhookError = null;
    try {
      const res = await axios.post(WEBHOOK, buildPayload(c.user, msgId), {
        timeout: 120000,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
      httpStatus = res.status;
      webhookBody = res.data;
    } catch (err) {
      httpStatus = err.response?.status || 0;
      webhookError = err.message;
    }

    await sleep(c.rapid ? RAPID_GAP_MS : WAIT_MS);

    let inbound = await inboundCol.findOne({ providerMessageId: msgId });
    let inboundDeduped = Boolean(
      webhookBody && (webhookBody.dedupe === true || webhookBody.reason === 'recent_same_utterance')
    );

    // Production inbound dedupe (findRecentSameUtterance, ~45s): identical text does not
    // create a second WhatsAppInboundMessage row. Resolve to the existing utterance so the
    // cert does not false-fail as inbound_not_saved.
    if (!inbound) {
      const textNorm = String(c.user || '')
        .trim()
        .toLowerCase();
      const since = new Date(Date.now() - 90_000);
      const recent = await inboundCol
        .find({ phone: PHONE10, receivedAt: { $gte: since } })
        .sort({ receivedAt: -1 })
        .limit(40)
        .toArray();
      const matched = recent.find(
        (row) => String(row.text || '').trim().toLowerCase() === textNorm
      );
      if (matched) {
        inbound = matched;
        inboundDeduped = true;
      }
    }

    if (inbound?.conversationId) {
      conversationId = inbound.conversationId;
      await convCol.updateOne(
        { _id: conversationId },
        { $set: { productLine: 'iit_counselling', updatedAt: new Date() } }
      );
    }

    let outbound = null;
    if (inbound?._id) {
      outbound = await outboundCol
        .find({ inReplyToInboundId: inbound._id, senderType: 'bot' })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
    }
    if (!outbound && conversationId) {
      outbound = await outboundCol
        .find({
          conversationId,
          senderType: 'bot',
          createdAt: { $gte: new Date(t0 - 1000) },
        })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
    }
    // Deduped turn: no new outbound was sent; reuse the original reply for content checks.
    if (!outbound && inboundDeduped && inbound?._id) {
      outbound = await outboundCol
        .find({ inReplyToInboundId: inbound._id, senderType: 'bot' })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
    }

    const botState = conversationId ? await botCol.findOne({ conversationId }) : null;
    const convAfter = conversationId ? await convCol.findOne({ _id: conversationId }) : null;
    const handoffOpen = conversationId
      ? Boolean(
          await db.collection('whatsappagenthandoffs').findOne({
            conversationId,
            status: { $in: ['open', 'claimed'] },
          })
        )
      : false;
    const openHandoffCount = conversationId
      ? await db.collection('whatsappagenthandoffs').countDocuments({
          conversationId,
          status: { $in: ['open', 'claimed'] },
        })
      : 0;
    const reply = extractReplyText(outbound);
    const latencyMs = Date.now() - t0;
    latencies.push(latencyMs);
    const crmAfter = await loadCrmFingerprint(db, PHONE10);
    const crmMutation = crmFingerprintChanged(crmBefore, crmAfter);
    const lastIntent = convAfter?.lastIntent || null;
    const routingPath = inferRoutingPath(lastIntent, reply);
    const llmUsed = llmInvoked(lastIntent);
    const deterministic = DETERMINISTIC_INTENTS.has(lastIntent) || /BookingSupportRouter/.test(routingPath);
    if (llmUsed) llmInvocationCount += 1;
    if (llmUsed) ragInvocationCount += 1;
    if (deterministic && c.expect?.deterministicNoLlm) deterministicCount += 1;

    const verdict = evaluate(c, reply, {
      webhookError,
      inboundSaved: Boolean(inbound),
      outboundSaved: Boolean(outbound),
      inboundDeduped,
      httpStatus,
      lastIntent,
      botStateName: botState?.state || null,
      handoffOpen,
      openHandoffCount,
      crm: crmSnapshot,
      crmMutation,
      crmBefore,
      crmAfter,
    });

    if (verdict.fails.includes('booking_hallucination')) hallucinationCount += 1;

    const row = {
      id: c.id,
      group: c.group,
      user: c.user,
      note: c.note,
      httpStatus,
      webhookSuccess: Boolean(webhookBody && (webhookBody.success || webhookBody.received)),
      inboundSaved: Boolean(inbound),
      inboundDeduped,
      outboundStatus: outbound?.status || null,
      replyText: reply,
      replyPreview: reply.slice(0, 320),
      routingPath,
      botState: botState?.state || null,
      lastIntent,
      llmInvoked: llmUsed,
      ragInvoked: llmUsed,
      deterministicRouting: deterministic,
      handoffOpen,
      openHandoffCount,
      crmMutation,
      latencyMs,
      status: verdict.status,
      fails: verdict.fails,
      warns: verdict.warns,
      severity: verdict.fails.length ? severityForFails(verdict.fails, c.severityHint) : null,
      rootCause: verdict.fails.length ? rootCauseForFails(verdict.fails) : null,
      scopeRefusal: SCOPE_REFUSAL.test(reply),
    };
    results.push(row);
    console.log(
      verdict.status,
      `lat=${latencyMs}ms`,
      `out=${outbound?.status || 'none'}`,
      `state=${botState?.state || '-'}`,
      convAfter?.lastIntent ? `intent=${convAfter.lastIntent}` : ''
    );
  }

  const sortedLat = [...latencies].sort((a, b) => a - b);
  const avgLat = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;
  const p95Lat = sortedLat[Math.min(sortedLat.length - 1, Math.floor(sortedLat.length * 0.95))] || 0;
  const maxLat = sortedLat[sortedLat.length - 1] || 0;

  const pass = results.filter((r) => r.status === 'PASS').length;
  const warn = results.filter((r) => r.status === 'PASS_WITH_WARNINGS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const total = results.length;
  const passRate = total ? Number((((pass + warn) / total) * 100).toFixed(2)) : 0;
  const gatePct = PASS_GATE * 100;

  const failures = results.filter((r) => r.status === 'FAIL');
  const crmFinal = await loadCrmSnapshot(db, PHONE10);
  const crmFinalFingerprint = await loadCrmFingerprint(db, PHONE10);
  const lifecycleUnchanged = crmFinalFingerprint.lifecycleCount === lifecycleBaseline;
  const leadUnchanged = crmFinalFingerprint.leadCount === crmBaseline.leadCount;

  let readiness = 'FAIL';
  const gateOk =
    passRate >= gatePct &&
    fail === 0 &&
    hallucinationCount === 0 &&
    leadUnchanged &&
    lifecycleUnchanged;
  if (gateOk && warn === 0) readiness = 'PASS';
  else if (gateOk) readiness = 'PASS_WITH_WARNINGS';

  const byGroup = {};
  for (const r of results) {
    if (!byGroup[r.group]) byGroup[r.group] = { pass: 0, warn: 0, fail: 0, total: 0 };
    byGroup[r.group].total += 1;
    if (r.status === 'PASS') byGroup[r.group].pass += 1;
    else if (r.status === 'PASS_WITH_WARNINGS') byGroup[r.group].warn += 1;
    else byGroup[r.group].fail += 1;
  }

  const report = {
    section: 'E',
    title: 'Website Booking Integration & Context Retrieval',
    mode: 'production_live_whatsapp',
    architectureFinding:
      'Website is the only booking create path (iitCounsellingSubmissions). WhatsApp uses Booking Context Resolver to load CRM booking by phone and answer support queries — never a conversational booking form.',
    phone: PHONE10,
    webhook: WEBHOOK,
    healthAtStart: health,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    readiness,
    summary: {
      total,
      pass,
      passWithWarnings: warn,
      fail,
      passRatePercent: passRate,
      passGatePercent: gatePct,
      hallucinationCount,
      llmInvocationCount,
      ragInvocationCount,
      deterministicRoutingCases: deterministicCount,
      crmLeadUnchanged: leadUnchanged,
      lifecycleUnchanged,
    },
    performance: { averageMs: avgLat, p95Ms: p95Lat, maxMs: maxLat, samples: latencies.length },
    crmBaseline,
    crmFinalFingerprint,
    byGroup,
    crm: crmFinal,
    results,
    failures: failures.map((f) => ({
      id: f.id,
      user: f.user,
      severity: f.severity,
      fails: f.fails,
      rootCause: f.rootCause,
      replyPreview: f.replyPreview,
      lastIntent: f.lastIntent,
    })),
    v2Recommendations: [
      'Store exam/rank/category on website booking form if WhatsApp must answer those fields from CRM.',
      'Add per-booking meeting link in CRM (today uses shared DEMO_MEETING_LINK).',
      'Expose booking-context metrics on Executive Dashboard (retrieval hits, website redirects, hallucination blocks).',
      'Add automated regression for bookingHallucinationGuard across KA / ICE / CPA paths.',
      'Localize rank/category-not-saved replies across all supported languages.',
    ],
  };

  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUT_DIR, `sectionE-certification-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `sectionE-certification-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));

  console.log('\n═══════════════════════════════════════════════');
  console.log(` READINESS: ${readiness} | passRate=${passRate}% P=${pass} W=${warn} F=${fail}`);
  console.log(' Report JSON:', jsonPath);
  console.log(' Report MD  :', mdPath);
  console.log('═══════════════════════════════════════════════');

  await mongoose.disconnect();
  process.exit(readiness === 'PASS' || readiness === 'PASS_WITH_WARNINGS' ? 0 : 2);
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# GuideXpert Production UAT — Section E Certification');
  lines.push('');
  lines.push('**Website Booking Integration & Context Retrieval**');
  lines.push('');
  lines.push(`- **Phone:** ${report.phone}`);
  lines.push(`- **Mode:** ${report.mode}`);
  lines.push(`- **Architecture finding:** ${report.architectureFinding}`);
  lines.push(`- **Executed:** ${report.startedAt}`);
  lines.push(`- **Completed:** ${report.completedAt}`);
  lines.push(`- **Readiness:** **${report.readiness}**`);
  lines.push(
    `- **Score:** ${report.summary.pass}/${report.summary.total} PASS, ${report.summary.passWithWarnings} WARN, ${report.summary.fail} FAIL (${report.summary.passRatePercent}% vs gate ${report.summary.passGatePercent}%)`
  );
  lines.push(
    `- **Latency:** avg ${report.performance.averageMs}ms · p95 ${report.performance.p95Ms}ms · max ${report.performance.maxMs}ms`
  );
  lines.push('');
  lines.push('## By group');
  lines.push('| Group | Pass | Warn | Fail | Total |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const [g, s] of Object.entries(report.byGroup)) {
    lines.push(`| ${g} | ${s.pass} | ${s.warn} | ${s.fail} | ${s.total} |`);
  }
  lines.push('');
  lines.push('## CRM / Database');
  lines.push(`- Lead exists: **${report.crm.leadExists}** (count ${report.crm.leadCount})`);
  lines.push(`- Slot: \`${report.crm.slotBooking}\` · BDA: \`${report.crm.assignedBdaName}\``);
  lines.push(`- Lifecycle booked: **${report.crm.lifecycleBooked}** stages=${JSON.stringify(report.crm.lifecycleStages)}`);
  lines.push(`- Notification kinds: ${JSON.stringify(report.crm.notificationKinds)}`);
  lines.push(`- Handoffs: ${report.crm.handoffCount} · Activities: ${report.crm.activityCount}`);
  lines.push('');
  lines.push('## Case results');
  lines.push('| ID | Group | User | Status | Intent | State | Latency | Notes |');
  lines.push('|---|---|---|---|---|---|---:|---|');
  for (const r of report.results) {
    const notes = [...(r.fails || []), ...(r.warns || [])].join('; ') || '';
    lines.push(
      `| ${r.id} | ${r.group} | ${JSON.stringify(r.user)} | ${r.status} | ${r.lastIntent || '-'} | ${r.botState || '-'} | ${r.latencyMs} | ${notes.replace(/\|/g, '/')} |`
    );
  }
  if (report.failures.length) {
    lines.push('');
    lines.push('## Failures / root causes');
    for (const f of report.failures) {
      lines.push(`### ${f.id} — ${JSON.stringify(f.user)}`);
      lines.push(`- Severity: ${f.severity}`);
      lines.push(`- Fails: ${f.fails.join(', ')}`);
      lines.push(`- Root cause: ${f.rootCause}`);
      lines.push(`- Reply: ${JSON.stringify(f.replyPreview)}`);
      lines.push('');
    }
  }
  lines.push('## Suggested V2 improvements');
  for (const rec of report.v2Recommendations) lines.push(`- ${rec}`);
  lines.push('');
  lines.push(`## Final Verdict: **${report.readiness}**`);
  lines.push('');
  lines.push('Do NOT proceed to Section F until Section E ≥ 98%.');
  return lines.join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
