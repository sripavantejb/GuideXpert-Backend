/**
 * Repair missing guidance_pre30min WhatsAppReminderJob rows for confirmed bookings.
 * Handles bookings made before the scheduler was deployed in production.
 */
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const GuidanceSlot = require('../models/GuidanceSlot');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const { GUIDANCE_REMINDER_MESSAGE_KINDS } = require('../models/WhatsAppReminderJob');
const { ensureGuidancePre30ReminderForLead } = require('./guidanceReminderScheduler');
const { getGuidanceSlotStartInstant } = require('../utils/guidanceReminderEligibility');

const MESSAGE_KIND = GUIDANCE_REMINDER_MESSAGE_KINDS[0];

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

module.exports = {
  repairMissingGuidanceReminderJobs,
};
