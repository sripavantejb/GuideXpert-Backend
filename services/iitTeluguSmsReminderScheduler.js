/**
 * Durable IIT counselling Telugu SMS scheduling (parallel to IIT WhatsApp reminders).
 */
const mongoose = require('mongoose');
const IitTeluguSmsReminderJob = require('../models/IitTeluguSmsReminderJob');
const { IIT_TELUGU_SMS_MESSAGE_KINDS } = require('../models/IitTeluguSmsReminderJob');
const { slotDayIstFromInstant } = require('./whatsappOpsCohortShared');
const { clearLeaseFields } = require('./iitTeluguSmsJobLifecycle');
const { buildAllTriggerSchedules } = require('../utils/iitTeluguSmsSchedule');
const {
  resolveTemplateId,
  buildFlowVariablesForKind,
} = require('../config/iitTeluguSmsTemplates');

const TELUGU = 'Telugu';

function isDuplicateKeyError(err) {
  return err && (err.code === 11000 || err.code === 11001);
}

async function cancelPendingTeluguSmsJobsForSubmission(iitSubmissionId, reason, now) {
  await IitTeluguSmsReminderJob.updateMany(
    {
      iitCounsellingSubmissionId: iitSubmissionId,
      state: 'pending',
    },
    {
      $set: {
        state: 'cancelled',
        suppressionReason: reason,
        completedAt: now,
        updatedAt: now,
        ...clearLeaseFields(),
      },
    }
  );
}

async function upsertTeluguSmsJob(iitSubmissionId, messageKind, setDoc, setOnInsert, existing) {
  const insertFields = {
    ...setOnInsert,
    iitCounsellingSubmissionId: iitSubmissionId,
    messageKind,
  };
  try {
    const job = await IitTeluguSmsReminderJob.findOneAndUpdate(
      { iitCounsellingSubmissionId: iitSubmissionId, messageKind },
      { $set: setDoc, $setOnInsert: insertFields },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    if (!job) {
      return { job: null, created: false, duplicatePrevented: false, error: 'upsert_returned_null' };
    }
    return { job, created: !existing, duplicatePrevented: false };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const job = await IitTeluguSmsReminderJob.findOneAndUpdate(
      { iitCounsellingSubmissionId: iitSubmissionId, messageKind },
      { $set: setDoc },
      { new: true, runValidators: true }
    ).lean();
    if (!job) {
      return { job: null, created: false, duplicatePrevented: true, error: 'upsert_returned_null' };
    }
    return { job, created: false, duplicatePrevented: true };
  }
}

/**
 * @param {object} iitSub lean IitCounsellingSubmission
 * @param {{ now?: Date }} [opts]
 */
async function ensureIitTeluguSmsJobsForSubmission(iitSub, opts = {}) {
  const now = opts.now || new Date();
  const subId = iitSub?._id;
  const phone = iitSub?.phone;
  const iit = iitSub?.iitCounselling || {};
  const section1 = iit.section1Data || {};
  const section2 = iit.section2Data || {};
  const preferredLanguage =
    typeof section2.preferredLanguage === 'string' ? section2.preferredLanguage.trim() : '';
  const slotBooking = typeof section1.slotBooking === 'string' ? section1.slotBooking.trim() : '';
  const slotAt = iitSub?.counsellingSlotInstantUtc
    ? new Date(iitSub.counsellingSlotInstantUtc)
    : null;

  if (!subId || !phone) {
    return { error: 'missing_submission', jobs: [] };
  }

  if (preferredLanguage !== TELUGU) {
    await cancelPendingTeluguSmsJobsForSubmission(subId, 'language_not_telugu', now);
    return { skipped: true, reason: 'language_not_telugu', jobs: [] };
  }

  if (!slotAt || Number.isNaN(slotAt.getTime())) {
    return { error: 'missing_slot_instant', jobs: [] };
  }
  if (!slotBooking) {
    return { error: 'missing_slot_booking_label', jobs: [] };
  }

  const slotDayIst = slotDayIstFromInstant(slotAt);
  if (!slotDayIst) {
    return { error: 'invalid_slot_day', jobs: [] };
  }

  const schedules = buildAllTriggerSchedules(slotAt, now);

  const results = [];
  let duplicatePrevented = 0;

  for (const messageKind of IIT_TELUGU_SMS_MESSAGE_KINDS) {
    const sched = schedules[messageKind];
    const templateId = resolveTemplateId(messageKind);
    const templateVariables = buildFlowVariablesForKind(messageKind);

    let state = sched.state;
    let suppressionReason = sched.suppressionReason;
    if (!templateId) {
      state = 'skipped';
      suppressionReason = 'template_id_missing';
    }

    const existing = await IitTeluguSmsReminderJob.findOne({
      iitCounsellingSubmissionId: subId,
      messageKind,
    }).lean();

    if (existing && ['dispatched', 'exhausted'].includes(existing.state)) {
      results.push({
        messageKind,
        jobId: existing._id,
        state: existing.state,
        skipped: true,
        reason: 'already_sent',
      });
      continue;
    }

    const slotChanged =
      existing &&
      existing.slotDate &&
      new Date(existing.slotDate).getTime() !== slotAt.getTime();
    const reschedule =
      slotChanged &&
      existing &&
      existing.state === 'pending' &&
      !['dispatched', 'exhausted'].includes(existing.state);

    const setDoc = {
      phone,
      slotDate: slotAt,
      slotDayIst,
      scheduledSendAt: sched.scheduledSendAt,
      expiresAt: sched.expiresAt,
      firstEligibleAt: sched.firstEligibleAt || sched.scheduledSendAt,
      preferredLanguage: TELUGU,
      slotBookingLabel: slotBooking,
      msg91TemplateId: templateId || 'missing',
      templateVariables,
      noBackfill: sched.noBackfill,
      sendImmediately: !!sched.sendImmediately,
      updatedAt: now,
    };

    if (reschedule || !existing) {
      setDoc.state = state;
      setDoc.suppressionReason = suppressionReason;
      if (reschedule) {
        setDoc.scheduleVersion = (existing.scheduleVersion || 1) + 1;
        Object.assign(setDoc, clearLeaseFields());
      } else if (!existing) {
        setDoc.scheduleVersion = 1;
      }
    } else if (existing.state === 'pending' && state === 'skipped') {
      setDoc.state = 'skipped';
      setDoc.suppressionReason = suppressionReason;
    } else if (existing && !reschedule) {
      delete setDoc.state;
      delete setDoc.suppressionReason;
    }

    const upserted = await upsertTeluguSmsJob(subId, messageKind, setDoc, { createdAt: now }, existing);
    if (upserted.duplicatePrevented) duplicatePrevented += 1;
    const job = upserted.job;
    if (!job) {
      return {
        error: 'sms_job_upsert_failed',
        detail: upserted.error,
        messageKind,
        jobs: results,
        slotDayIst,
        duplicatePrevented,
      };
    }

    results.push({
      messageKind,
      jobId: job._id,
      state: job.state,
      scheduledSendAt: job.scheduledSendAt,
      sendImmediately: job.sendImmediately,
      msg91TemplateId: job.msg91TemplateId,
      created: upserted.created,
      rescheduled: !!reschedule,
      duplicatePrevented: upserted.duplicatePrevented,
    });
  }

  return { jobs: results, slotDayIst, duplicatePrevented };
}

async function dispatchDueJobsForIitTeluguSmsSubmission(iitSubmissionId, opts = {}) {
  const { dispatchDueIitTeluguSmsJobs } = require('./iitTeluguSmsReminderDispatcher');
  const id = mongoose.Types.ObjectId.isValid(String(iitSubmissionId))
    ? new mongoose.Types.ObjectId(String(iitSubmissionId))
    : null;
  if (!id) return { error: 'invalid_submission_id' };

  const now = opts.now || new Date();
  return dispatchDueIitTeluguSmsJobs({
    messageKinds: [...IIT_TELUGU_SMS_MESSAGE_KINDS],
    now,
    cronRunId: opts.cronRunId || null,
    cronJobKey: opts.cronJobKey || 'save_iit_section2_sms_catchup',
    submissionIdFilter: id,
    limit: opts.limit != null ? opts.limit : 20,
    includeImmediate: true,
  });
}

module.exports = {
  ensureIitTeluguSmsJobsForSubmission,
  dispatchDueJobsForIitTeluguSmsSubmission,
  cancelPendingTeluguSmsJobsForSubmission,
};
