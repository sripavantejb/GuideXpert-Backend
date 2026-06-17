/**
 * Repair missing guidance_pre30min jobs, heal env-skipped jobs, and backfill counsellor notify.
 */
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const OneOnOneCounselor = require('../models/OneOnOneCounselor');
const GuidanceSlot = require('../models/GuidanceSlot');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const { GUIDANCE_REMINDER_MESSAGE_KINDS } = require('../models/WhatsAppReminderJob');
const { ensureGuidancePre30ReminderForLead } = require('./guidanceReminderScheduler');
const {
  getGuidanceSlotStartInstant,
  getGuidancePre30ScheduleDecision,
  resolveGuidancePre30MinTemplateEnvKey,
} = require('../utils/guidanceReminderEligibility');
const { clearLeaseFields } = require('./whatsappReminderJobLifecycle');
const { sendGuidanceCounsellorBookingNotifyForBooking } = require('./guidanceCounsellorNotifyService');

const MESSAGE_KIND = GUIDANCE_REMINDER_MESSAGE_KINDS[0];
const COUNSELLOR_NOTIFY_KIND = 'guidance_counsellor_booking_notify';

/**
 * Re-open pre30 jobs skipped at booking because template env was missing but is now configured.
 * @param {{ now?: Date, limit?: number }} [opts]
 */
async function healTemplateEnvMissingSkippedJobs(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const limit = Math.min(200, Math.max(1, opts.limit || 50));

  if (!resolveGuidancePre30MinTemplateEnvKey()) {
    return { scanned: 0, reopened: 0, skipped: 0, errors: 0 };
  }

  const jobs = await WhatsAppReminderJob.find({
    messageKind: MESSAGE_KIND,
    state: 'skipped',
    suppressionReason: 'template_env_missing',
  })
    .select('_id oneOnOneCounselingLeadId scheduledSendAt slotDate')
    .limit(limit)
    .lean();

  if (!jobs.length) {
    return { scanned: 0, reopened: 0, skipped: 0, errors: 0 };
  }

  const leadIds = jobs.map((j) => j.oneOnOneCounselingLeadId).filter(Boolean);
  const leads = await OneOnOneCounselingLead.find({
    _id: { $in: leadIds },
    bookingConfirmed: true,
  })
    .select('_id mobileNumber selectedSlotId')
    .lean();
  const leadById = Object.fromEntries(leads.map((l) => [String(l._id), l]));

  const slotIds = [...new Set(leads.map((l) => String(l.selectedSlotId)).filter(Boolean))];
  const slots = await GuidanceSlot.find({ _id: { $in: slotIds } }).lean();
  const slotById = Object.fromEntries(slots.map((s) => [String(s._id), s]));

  let reopened = 0;
  let skipped = 0;
  let errors = 0;

  for (const job of jobs) {
    const lead = leadById[String(job.oneOnOneCounselingLeadId)];
    const slot = lead ? slotById[String(lead.selectedSlotId)] : null;
    if (!lead || !slot) {
      errors += 1;
      continue;
    }

    const slotInst = getGuidanceSlotStartInstant(slot);
    if (!slotInst || now.getTime() >= slotInst.startUtc.getTime()) {
      skipped += 1;
      continue;
    }

    const decision = getGuidancePre30ScheduleDecision(slot, now);
    if (decision.state !== 'pending') {
      skipped += 1;
      continue;
    }

    try {
      const scheduledSendAt = decision.scheduledSendAt || new Date(now.getTime());
      await WhatsAppReminderJob.updateOne(
        { _id: job._id, state: 'skipped', suppressionReason: 'template_env_missing' },
        {
          $set: {
            state: 'pending',
            suppressionReason: null,
            lastError: null,
            scheduledSendAt,
            firstEligibleAt: decision.firstEligibleAt || scheduledSendAt,
            templateIdEnvKey: decision.templateIdEnvKey,
            completedAt: null,
            ...clearLeaseFields(),
          },
        }
      );
      reopened += 1;
    } catch (err) {
      errors += 1;
      console.error(
        JSON.stringify({
          event: 'guidance_pre30_heal_template_env_failed',
          jobId: String(job._id),
          error: err?.message || String(err),
        })
      );
    }
  }

  return { scanned: jobs.length, reopened, skipped, errors };
}

/**
 * @param {{ now?: Date, limit?: number, slotDate?: string }} [opts]
 */
async function repairMissingGuidanceReminderJobs(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const limit = Math.min(500, Math.max(1, opts.limit || 200));

  const leadQuery = {
    bookingConfirmed: true,
    selectedSlotId: { $ne: null },
  };

  let slotIdsFilter = null;
  if (opts.slotDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.slotDate)) {
    const slots = await GuidanceSlot.find({ slotDate: opts.slotDate, isActive: true })
      .select('_id')
      .lean();
    slotIdsFilter = slots.map((s) => s._id);
    if (!slotIdsFilter.length) {
      return { scanned: 0, created: 0, skipped: 0, errors: 0, alreadyHadJob: 0 };
    }
    leadQuery.selectedSlotId = { $in: slotIdsFilter };
  }

  const leads = await OneOnOneCounselingLead.find(leadQuery)
    .select('_id mobileNumber studentName selectedSlotId bookingConfirmedAt')
    .sort({ bookingConfirmedAt: -1 })
    .limit(limit)
    .lean();

  if (!leads.length) {
    return { scanned: 0, created: 0, skipped: 0, errors: 0, alreadyHadJob: 0 };
  }

  const leadIds = leads.map((l) => l._id);
  const existingJobs = await WhatsAppReminderJob.find({
    oneOnOneCounselingLeadId: { $in: leadIds },
    messageKind: MESSAGE_KIND,
  })
    .select('oneOnOneCounselingLeadId')
    .lean();

  const hasJob = new Set(existingJobs.map((j) => String(j.oneOnOneCounselingLeadId)));

  let created = 0;
  let skipped = 0;
  let errors = 0;
  let alreadyHadJob = 0;

  const slotIdSet = [...new Set(leads.map((l) => String(l.selectedSlotId)))];
  const slots = await GuidanceSlot.find({ _id: { $in: slotIdSet } }).lean();
  const slotById = Object.fromEntries(slots.map((s) => [String(s._id), s]));

  for (const lead of leads) {
    if (hasJob.has(String(lead._id))) {
      alreadyHadJob += 1;
      continue;
    }

    const slot = slotById[String(lead.selectedSlotId)];
    if (!slot) {
      errors += 1;
      continue;
    }

    const scheduleAt =
      lead.bookingConfirmedAt instanceof Date
        ? lead.bookingConfirmedAt
        : lead.bookingConfirmedAt
          ? new Date(lead.bookingConfirmedAt)
          : now;

    try {
      const result = await ensureGuidancePre30ReminderForLead(lead, slot, { now: scheduleAt });
      const job = result.jobs?.[0];
      if (!job) {
        errors += 1;
        continue;
      }

      const slotInst = getGuidanceSlotStartInstant(slot);
      const slotPassed = slotInst && now.getTime() >= slotInst.startUtc.getTime();

      if (job.state === 'pending' && slotPassed) {
        await WhatsAppReminderJob.updateOne(
          { _id: job._id, state: 'pending' },
          {
            $set: {
              state: 'skipped',
              suppressionReason: 'missed_no_scheduler_at_booking',
              completedAt: now,
              lastError: 'reminder_job_created_after_session_start',
            },
          }
        );
        skipped += 1;
      } else if (job.state === 'pending') {
        created += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      errors += 1;
      console.error(
        JSON.stringify({
          event: 'guidance_pre30_repair_failed',
          leadId: String(lead._id),
          error: err?.message || String(err),
        })
      );
    }
  }

  return {
    scanned: leads.length,
    created,
    skipped,
    errors,
    alreadyHadJob,
  };
}

/**
 * Backfill counsellor notify for confirmed bookings missing an event (e.g. pre-deploy bookings).
 * @param {{ now?: Date, limit?: number }} [opts]
 */
async function repairMissingGuidanceCounsellorNotify(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const limit = Math.min(50, Math.max(1, opts.limit || 50));

  const leads = await OneOnOneCounselingLead.find({
    bookingConfirmed: true,
    selectedSlotId: { $ne: null },
  })
    .select('_id studentName mobileNumber selectedSlotId oneOnOneCounselorId bookingConfirmedAt')
    .sort({ bookingConfirmedAt: -1 })
    .limit(limit * 3)
    .lean();

  if (!leads.length) {
    return { scanned: 0, attempted: 0, sent: 0, skipped: 0, errors: 0 };
  }

  const leadIds = leads.map((l) => l._id);
  const existingEvents = await WhatsAppMessageEvent.find({
    messageKind: COUNSELLOR_NOTIFY_KIND,
    oneOnOneCounselingLeadId: { $in: leadIds },
  })
    .select('oneOnOneCounselingLeadId')
    .lean();
  const hasEvent = new Set(existingEvents.map((e) => String(e.oneOnOneCounselingLeadId)));

  const slotIds = [...new Set(leads.map((l) => String(l.selectedSlotId)))];
  const counselorIds = [...new Set(leads.map((l) => String(l.oneOnOneCounselorId)).filter(Boolean))];
  const [slots, counselors] = await Promise.all([
    GuidanceSlot.find({ _id: { $in: slotIds } }).lean(),
    OneOnOneCounselor.find({ _id: { $in: counselorIds } }).lean(),
  ]);
  const slotById = Object.fromEntries(slots.map((s) => [String(s._id), s]));
  const counselorById = Object.fromEntries(counselors.map((c) => [String(c._id), c]));

  let attempted = 0;
  let sent = 0;
  let skipped = 0;
  let errors = 0;
  let processed = 0;

  for (const lead of leads) {
    if (processed >= limit) break;
    if (hasEvent.has(String(lead._id))) {
      skipped += 1;
      continue;
    }

    const slot = slotById[String(lead.selectedSlotId)];
    const counselor = counselorById[String(lead.oneOnOneCounselorId)];
    if (!slot || !counselor) {
      errors += 1;
      continue;
    }

    const slotInst = getGuidanceSlotStartInstant(slot);
    if (!slotInst || now.getTime() >= slotInst.startUtc.getTime()) {
      skipped += 1;
      continue;
    }

    processed += 1;
    try {
      const result = await sendGuidanceCounsellorBookingNotifyForBooking(lead, slot, counselor);
      if (!result.attempted) {
        skipped += 1;
        continue;
      }
      attempted += 1;
      if (result.success) sent += 1;
      else errors += 1;
    } catch (err) {
      errors += 1;
      console.error(
        JSON.stringify({
          event: 'guidance_counsellor_notify_repair_failed',
          leadId: String(lead._id),
          error: err?.message || String(err),
        })
      );
    }
  }

  return {
    scanned: leads.length,
    attempted,
    sent,
    skipped,
    errors,
  };
}

/**
 * @param {{ now?: Date, limit?: number, slotDate?: string }} [opts]
 */
async function runGuidanceReminderRepairs(opts = {}) {
  const heal = await healTemplateEnvMissingSkippedJobs(opts);
  const missing = await repairMissingGuidanceReminderJobs(opts);
  const counsellor = await repairMissingGuidanceCounsellorNotify(opts);
  return { heal, missing, counsellor };
}

module.exports = {
  healTemplateEnvMissingSkippedJobs,
  repairMissingGuidanceReminderJobs,
  repairMissingGuidanceCounsellorNotify,
  runGuidanceReminderRepairs,
};
