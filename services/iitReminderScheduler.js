/**
 * Durable IIT counselling reminder scheduling (language-aware templates).
 */
const mongoose = require('mongoose');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const { IIT_REMINDER_MESSAGE_KINDS } = require('../models/WhatsAppReminderJob');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { slotDayIstFromInstant } = require('./whatsappOpsCohortShared');
const { clearLeaseFields } = require('./whatsappReminderJobLifecycle');
const { resolveIitReminderTemplateEnvKey } = require('../utils/iitCounsellingWhatsApp');
const {
  getIitReminderEligibility,
  computeIitScheduledSendAt,
} = require('../utils/iitReminderEligibility');
const { computeExpiresAt } = require('../utils/waReminderJobExpiration');

function isDuplicateKeyError(err) {
  return err && (err.code === 11000 || err.code === 11001);
}

async function ensureRetryGroupForJob(messageKind, existingGroupId) {
  if (existingGroupId && mongoose.Types.ObjectId.isValid(String(existingGroupId))) {
    return existingGroupId;
  }
  const g = await WhatsAppRetryGroup.create({
    messageKind,
    cronRunId: null,
    trigger: 'scheduled_job',
    status: 'open',
  });
  return g._id;
}

async function upsertIitReminderJob(iitSubmissionId, messageKind, setDoc, setOnInsert, existing) {
  try {
    const job = await WhatsAppReminderJob.findOneAndUpdate(
      { iitCounsellingSubmissionId: iitSubmissionId, messageKind },
      { $set: setDoc, $setOnInsert: setOnInsert },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    return { job, created: !existing, duplicatePrevented: false };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const job = await WhatsAppReminderJob.findOneAndUpdate(
      { iitCounsellingSubmissionId: iitSubmissionId, messageKind },
      { $set: setDoc },
      { new: true, runValidators: true }
    ).lean();
    return { job, created: false, duplicatePrevented: true };
  }
}

/**
 * @param {object} iitSub lean IitCounsellingSubmission
 * @param {{ now?: Date }} [opts]
 */
async function ensureIitReminderJobsForSubmission(iitSub, opts = {}) {
  const now = opts.now || new Date();
  const subId = iitSub?._id;
  const phone = iitSub?.phone;
  const iit = iitSub?.iitCounselling || {};
  const section1 = iit.section1Data || {};
  const section2 = iit.section2Data || {};
  const slotBooking = typeof section1.slotBooking === 'string' ? section1.slotBooking.trim() : '';
  const preferredLanguage =
    typeof section2.preferredLanguage === 'string' ? section2.preferredLanguage.trim() : '';
  const slotAt = iitSub?.counsellingSlotInstantUtc
    ? new Date(iitSub.counsellingSlotInstantUtc)
    : null;

  if (!subId || !phone || !slotAt || Number.isNaN(slotAt.getTime())) {
    return { error: 'missing_slot_instant', jobs: [] };
  }
  if (!preferredLanguage) {
    return { error: 'missing_preferred_language', jobs: [] };
  }
  if (!slotBooking) {
    return { error: 'missing_slot_booking_label', jobs: [] };
  }

  const slotDayIst = slotDayIstFromInstant(slotAt);
  if (!slotDayIst) {
    return { error: 'invalid_slot_day', jobs: [] };
  }

  const results = [];
  let duplicatePrevented = 0;

  for (const messageKind of IIT_REMINDER_MESSAGE_KINDS) {
    const templateIdEnvKey = resolveIitReminderTemplateEnvKey({
      slotBooking,
      preferredLanguage,
      reminderKind: messageKind,
    });

    const scheduledSendAt = computeIitScheduledSendAt(messageKind, slotAt);
    const expiresAt = computeExpiresAt(messageKind, slotAt);
    const elig = getIitReminderEligibility(messageKind, slotAt, now);
    const firstEligibleAt = elig.earliestAt || scheduledSendAt;

    let state = 'pending';
    let suppressionReason = null;
    if (!templateIdEnvKey) {
      state = 'skipped';
      suppressionReason = 'iit_template_env_missing';
    } else if (now.getTime() >= slotAt.getTime()) {
      state = 'skipped';
      suppressionReason = 'slot_passed';
    } else if (!scheduledSendAt || scheduledSendAt.getTime() >= slotAt.getTime()) {
      state = 'skipped';
      suppressionReason = 'invalid_schedule';
    } else if (elig.reason === 'invalid_slot_date') {
      state = 'skipped';
      suppressionReason = 'invalid_slot_date';
    }

    const existing = await WhatsAppReminderJob.findOne({
      iitCounsellingSubmissionId: subId,
      messageKind,
    }).lean();
    const retryGroupId = await ensureRetryGroupForJob(messageKind, existing?.retryGroupId);

    const languageChanged =
      existing &&
      existing.preferredLanguage &&
      existing.preferredLanguage !== preferredLanguage;
    const templateChanged =
      existing && existing.templateIdEnvKey && existing.templateIdEnvKey !== templateIdEnvKey;
    const slotChanged =
      existing &&
      existing.slotDate &&
      new Date(existing.slotDate).getTime() !== slotAt.getTime();
    const reschedule =
      (slotChanged || languageChanged || templateChanged) &&
      existing.state === 'pending' &&
      !['dispatched', 'delivered', 'read', 'exhausted'].includes(existing.state);

    const setDoc = {
      phone,
      slotDate: slotAt,
      slotDayIst,
      scheduledSendAt,
      expiresAt,
      firstEligibleAt,
      retryGroupId,
      opsProduct: 'iit_counselling',
      preferredLanguage,
      slotBookingLabel: slotBooking,
      templateIdEnvKey: templateIdEnvKey || null,
      updatedAt: now,
    };

    if (reschedule) {
      setDoc.state = state === 'skipped' ? 'skipped' : 'pending';
      setDoc.suppressionReason = suppressionReason;
      setDoc.scheduleVersion = (existing.scheduleVersion || 1) + 1;
      Object.assign(setDoc, clearLeaseFields());
    } else if (!existing) {
      setDoc.state = state;
      setDoc.suppressionReason = suppressionReason;
      setDoc.scheduleVersion = 1;
    } else if (existing.state === 'pending' && state === 'skipped') {
      setDoc.state = 'skipped';
      setDoc.suppressionReason = suppressionReason;
    } else if (existing && !reschedule) {
      delete setDoc.state;
      delete setDoc.suppressionReason;
    }

    const upserted = await upsertIitReminderJob(subId, messageKind, setDoc, { createdAt: now }, existing);
    if (upserted.duplicatePrevented) duplicatePrevented += 1;
    const job = upserted.job;

    results.push({
      messageKind,
      jobId: job._id,
      state: job.state,
      scheduledSendAt: job.scheduledSendAt,
      templateIdEnvKey: job.templateIdEnvKey,
      created: upserted.created,
      rescheduled: !!reschedule,
      duplicatePrevented: upserted.duplicatePrevented,
    });
  }

  return { jobs: results, slotDayIst, duplicatePrevented };
}

module.exports = {
  ensureIitReminderJobsForSubmission,
};
