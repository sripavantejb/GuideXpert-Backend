'use strict';

const { ensureReminderJobsForSubmission } = require('../../../services/whatsappReminderScheduler');
const WhatsAppReminderJob = require('../../../models/WhatsAppReminderJob');

/**
 * @param {object} submission lean with _id, phone, step3Data
 * @param {{ now?: Date }} [opts]
 */
async function ensureJobsForBooking(submission, opts = {}) {
  return ensureReminderJobsForSubmission(submission, opts);
}

/**
 * @param {string} kind pre4hr|meet|30min
 * @param {import('mongoose').Types.ObjectId} formSubmissionId
 */
async function getJob(formSubmissionId, kind) {
  return WhatsAppReminderJob.findOne({ formSubmissionId, messageKind: kind }).lean();
}

/**
 * Force job due for cron (scheduledSendAt in past).
 */
async function makeJobDue(jobId, scheduledSendAt) {
  await WhatsAppReminderJob.updateOne(
    { _id: jobId },
    { $set: { scheduledSendAt: scheduledSendAt || new Date('2026-05-15T05:00:00.000Z'), state: 'pending' } }
  );
}

module.exports = {
  ensureJobsForBooking,
  getJob,
  makeJobDue
};
