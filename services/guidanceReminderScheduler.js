/**
 * Durable guidance session 30-minute WhatsApp reminder scheduling.
 */
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const { GUIDANCE_REMINDER_MESSAGE_KINDS } = require('../models/WhatsAppReminderJob');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { slotDayIstFromInstant } = require('./whatsappOpsCohortShared');
const { clearLeaseFields } = require('./whatsappReminderJobLifecycle');
const {
  getGuidancePre30ScheduleDecision,
  computeGuidancePre30ScheduledSendAt,
  getGuidanceSlotStartInstant,
} = require('../utils/guidanceReminderEligibility');
const { computeExpiresAt } = require('../utils/waReminderJobExpiration');

function isDuplicateKeyError(err) {
  return err && (err.code === 11000 || err.code === 11001);
}

async function ensureRetryGroupForJob(messageKind, existingGroupId) {
  if (existingGroupId) {
    return { ok: true, retryGroupId: existingGroupId };
  }
  try {
    const g = await WhatsAppRetryGroup.create({
      messageKind,
      cronRunId: null,
      trigger: 'scheduled_job',
      status: 'open',
    });
    return { ok: true, retryGroupId: g._id };
  } catch (err) {
    const detail = err?.message ? String(err.message).slice(0, 500) : 'unknown';
    return { ok: false, error: 'retry_group_create_failed', detail };
  }
}

async function upsertGuidanceReminderJob(leadId, messageKind, setDoc, setOnInsert, existing) {
  const insertFields = {
    ...setOnInsert,
    oneOnOneCounselingLeadId: leadId,
    messageKind,
  };
  try {
    const job = await WhatsAppReminderJob.findOneAndUpdate(
      { oneOnOneCounselingLeadId: leadId, messageKind },
      { $set: setDoc, $setOnInsert: insertFields },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    return { job, created: !existing, duplicatePrevented: false };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const job = await WhatsAppReminderJob.findOneAndUpdate(
      { oneOnOneCounselingLeadId: leadId, messageKind },
      { $set: setDoc },
      { new: true, runValidators: true }
    ).lean();
    return { job, created: false, duplicatePrevented: true };
  }
}

/**
 * @param {object} lead saved OneOnOneCounselingLead doc/object
 * @param {object} slot GuidanceSlot lean doc
 * @param {{ now?: Date }} [opts]
 */
async function ensureGuidancePre30ReminderForLead(lead, slot, opts = {}) {
  const now = opts.now || new Date();
  const leadId = lead?._id;
  const phone = lead?.mobileNumber;
  const messageKind = GUIDANCE_REMINDER_MESSAGE_KINDS[0];

  if (!leadId || !phone || !slot) {
    return { error: 'missing_lead_or_slot', jobs: [] };
  }

  const inst = getGuidanceSlotStartInstant(slot);
  if (!inst) {
    return { error: 'invalid_schedule', jobs: [] };
  }

  const slotAt = inst.startUtc;
  const slotDayIst = slotDayIstFromInstant(slotAt) || String(slot.slotDate || '').trim();
  if (!slotDayIst) {
    return { error: 'invalid_slot_day', jobs: [] };
  }

  const decision = getGuidancePre30ScheduleDecision(slot, now);
  const scheduledSendAt = decision.scheduledSendAt || computeGuidancePre30ScheduledSendAt(slot);
  const expiresAt = computeExpiresAt(messageKind, slotAt);
  const firstEligibleAt = decision.firstEligibleAt || scheduledSendAt;

  const existing = await WhatsAppReminderJob.findOne({
    oneOnOneCounselingLeadId: leadId,
    messageKind,
  }).lean();

  const groupResult = await ensureRetryGroupForJob(messageKind, existing?.retryGroupId);
  if (!groupResult.ok) {
    return { error: groupResult.error, detail: groupResult.detail, jobs: [] };
  }

  const slotChanged =
    existing &&
    existing.slotDate &&
    new Date(existing.slotDate).getTime() !== slotAt.getTime();
  const reschedule =
    slotChanged &&
    existing.state === 'pending' &&
    !['dispatched', 'delivered', 'read', 'exhausted'].includes(existing.state);

  const setDoc = {
    phone,
    opsProduct: 'guidance_booking',
    templateIdEnvKey: decision.templateIdEnvKey || existing?.templateIdEnvKey || null,
    slotDate: slotAt,
    slotDayIst,
    scheduledSendAt,
    expiresAt,
    firstEligibleAt,
    retryGroupId: groupResult.retryGroupId,
    state: decision.state,
    suppressionReason: decision.suppressionReason,
    lastError: null,
    ...(decision.state === 'pending' ? clearLeaseFields() : {}),
    ...(reschedule ? { scheduleVersion: (existing.scheduleVersion || 1) + 1 } : {}),
  };

  const { job, created, duplicatePrevented } = await upsertGuidanceReminderJob(
    leadId,
    messageKind,
    setDoc,
    {
      phone,
      opsProduct: 'guidance_booking',
      slotDate: slotAt,
      slotDayIst,
      scheduledSendAt,
      expiresAt,
      firstEligibleAt,
      retryGroupId: groupResult.retryGroupId,
      state: decision.state,
      templateIdEnvKey: decision.templateIdEnvKey,
    },
    existing
  );

  return {
    jobs: job ? [job] : [],
    created,
    duplicatePrevented,
    slotDayIst,
    suppressionReason: decision.suppressionReason,
  };
}

async function cancelGuidancePre30RemindersForLead(leadId, now = new Date()) {
  if (!leadId) return { cancelled: 0 };
  const res = await WhatsAppReminderJob.updateMany(
    {
      oneOnOneCounselingLeadId: leadId,
      messageKind: { $in: GUIDANCE_REMINDER_MESSAGE_KINDS },
      state: { $in: ['pending', 'claimed', 'dispatching', 'failed', 'reconcile_pending'] },
    },
    {
      $set: {
        state: 'cancelled',
        suppressionReason: 'booking_reset',
        completedAt: now,
        updatedAt: now,
        ...clearLeaseFields(),
      },
    }
  );
  return { cancelled: res.modifiedCount || 0 };
}

module.exports = {
  ensureGuidancePre30ReminderForLead,
  cancelGuidancePre30RemindersForLead,
};
