/**
 * P3: Durable per-recipient reminder scheduling at booking time.
 */
const mongoose = require('mongoose');
const FormSubmission = require('../models/FormSubmission');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const { CAMPAIGN_MESSAGE_KINDS } = require('../models/WhatsAppReminderJob');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { offsetMsForKind, getCampaignReminderEligibility } = require('../utils/waReminderEligibility');
const { slotDayIstFromInstant } = require('./whatsappOpsCohortShared');
const { computeExpiresAt } = require('../utils/waReminderJobExpiration');
const { clearLeaseFields } = require('./whatsappReminderJobLifecycle');

function isDuplicateKeyError(err) {
  return err && (err.code === 11000 || err.code === 11001);
}

/**
 * Idempotent upsert under unique (formSubmissionId, messageKind).
 * @returns {{ job: object, created: boolean, duplicatePrevented: boolean }}
 */
async function upsertReminderJob(formSubmissionId, messageKind, setDoc, setOnInsert, existing) {
  try {
    const job = await WhatsAppReminderJob.findOneAndUpdate(
      { formSubmissionId, messageKind },
      { $set: setDoc, $setOnInsert: setOnInsert },
      { upsert: true, new: true }
    ).lean();
    return { job, created: !existing, duplicatePrevented: false };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const job = await WhatsAppReminderJob.findOneAndUpdate(
      { formSubmissionId, messageKind },
      { $set: setDoc },
      { new: true }
    ).lean();
    return { job, created: false, duplicatePrevented: true };
  }
}

function computeScheduledSendAt(kind, slotDate) {
  const slotMs = new Date(slotDate).getTime();
  if (Number.isNaN(slotMs)) return null;
  const off = offsetMsForKind(kind);
  if (off == null) return null;
  return new Date(slotMs - off);
}

function computeSlotDayIst(slotDate) {
  return slotDayIstFromInstant(slotDate);
}

async function ensureRetryGroupForJob(messageKind, existingGroupId) {
  if (existingGroupId && mongoose.Types.ObjectId.isValid(String(existingGroupId))) {
    return existingGroupId;
  }
  const g = await WhatsAppRetryGroup.create({
    messageKind,
    cronRunId: null,
    trigger: 'scheduled_job',
    status: 'open'
  });
  return g._id;
}

/**
 * @param {object} submission lean or doc with _id, phone, step3Data.slotDate
 * @param {{ now?: Date }} [opts]
 */
async function ensureReminderJobsForSubmission(submission, opts = {}) {
  const now = opts.now || new Date();
  const subId = submission._id;
  const phone = submission.phone;
  const slotDate = submission.step3Data && submission.step3Data.slotDate;
  if (!subId || !phone || !slotDate) {
    return { error: 'missing_submission_slot', jobs: [] };
  }
  const slotAt = new Date(slotDate);
  if (Number.isNaN(slotAt.getTime())) {
    return { error: 'invalid_slot_date', jobs: [] };
  }
  const slotDayIst = computeSlotDayIst(slotAt);
  if (!slotDayIst) {
    return { error: 'invalid_slot_day', jobs: [] };
  }

  const sendAtFields = {};
  const results = [];
  let duplicatePrevented = 0;

  for (const messageKind of CAMPAIGN_MESSAGE_KINDS) {
    const scheduledSendAt = computeScheduledSendAt(messageKind, slotAt);
    const expiresAt = computeExpiresAt(messageKind, slotAt);
    const elig = getCampaignReminderEligibility(messageKind, slotAt, now);
    const firstEligibleAt = elig.earliestAt || scheduledSendAt;

    let state = 'pending';
    let suppressionReason = null;
    if (now.getTime() >= slotAt.getTime()) {
      state = 'skipped';
      suppressionReason = 'slot_passed';
    } else if (!scheduledSendAt || scheduledSendAt.getTime() >= slotAt.getTime()) {
      state = 'skipped';
      suppressionReason = 'invalid_schedule';
    } else if (elig.reason === 'invalid_slot_date') {
      state = 'skipped';
      suppressionReason = 'invalid_slot_date';
    }

    const existing = await WhatsAppReminderJob.findOne({ formSubmissionId: subId, messageKind }).lean();
    const retryGroupId = await ensureRetryGroupForJob(messageKind, existing && existing.retryGroupId);

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
      slotDate: slotAt,
      slotDayIst,
      scheduledSendAt,
      expiresAt,
      firstEligibleAt,
      retryGroupId,
      updatedAt: now
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

    if (messageKind === 'pre4hr') sendAtFields['step3Data.pre4hrSendAt'] = scheduledSendAt;
    if (messageKind === 'meet') sendAtFields['step3Data.meetSendAt'] = scheduledSendAt;
    if (messageKind === '30min') sendAtFields['step3Data.thirtyMinSendAt'] = scheduledSendAt;

    const upserted = await upsertReminderJob(
      subId,
      messageKind,
      setDoc,
      { createdAt: now },
      existing
    );
    if (upserted.duplicatePrevented) duplicatePrevented += 1;
    const job = upserted.job;

    results.push({
      messageKind,
      jobId: job._id,
      state: job.state,
      scheduledSendAt: job.scheduledSendAt,
      expiresAt: job.expiresAt,
      created: upserted.created,
      rescheduled: !!reschedule,
      duplicatePrevented: upserted.duplicatePrevented
    });
  }

  if (Object.keys(sendAtFields).length) {
    await FormSubmission.updateOne(
      { _id: subId },
      {
        $set: {
          'step3Data.pre4hrSendAt': sendAtFields['step3Data.pre4hrSendAt'],
          'step3Data.meetSendAt': sendAtFields['step3Data.meetSendAt'],
          'step3Data.thirtyMinSendAt': sendAtFields['step3Data.thirtyMinSendAt']
        }
      }
    );
  }

  return { jobs: results, slotDayIst, duplicatePrevented };
}

/**
 * @param {import('mongoose').Types.ObjectId|string} submissionId
 * @param {{ now?: Date, cronRunId?: import('mongoose').Types.ObjectId|null, cronJobKey?: string|null }} [opts]
 */
async function dispatchDueJobsForSubmission(submissionId, opts = {}) {
  const { dispatchDueReminderJobs } = require('./whatsappReminderJobDispatcher');
  const id = mongoose.Types.ObjectId.isValid(String(submissionId))
    ? new mongoose.Types.ObjectId(String(submissionId))
    : null;
  if (!id) return { error: 'invalid_submission_id' };
  const jobs = await WhatsAppReminderJob.find({
    formSubmissionId: id,
    state: 'pending',
    scheduledSendAt: { $lte: opts.now || new Date() }
  })
    .select('_id messageKind')
    .lean();
  if (!jobs.length) return { dispatched: 0, jobs: [] };
  const byKind = [...new Set(jobs.map((j) => j.messageKind))];
  const agg = { dispatched: 0, failed: 0, skipped: 0, claimed: 0 };
  for (const kind of byKind) {
    // eslint-disable-next-line no-await-in-loop
    const r = await dispatchDueReminderJobs({
      messageKinds: [kind],
      now: opts.now,
      cronRunId: opts.cronRunId || null,
      cronJobKey: opts.cronJobKey || 'save_step3_catchup',
      submissionIdFilter: id,
      limit: 10
    });
    agg.dispatched += r.jobsDispatched || 0;
    agg.failed += r.jobsFailed || 0;
    agg.skipped += r.jobsSkipped || 0;
    agg.claimed += r.jobsClaimed || 0;
  }
  return agg;
}

module.exports = {
  CAMPAIGN_MESSAGE_KINDS,
  computeScheduledSendAt,
  computeSlotDayIst,
  upsertReminderJob,
  ensureReminderJobsForSubmission,
  dispatchDueJobsForSubmission
};
