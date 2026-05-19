'use strict';

const mongoose = require('mongoose');
const { dispatchDueReminderJobs } = require('../../../services/whatsappReminderJobDispatcher');
const { executeRetryWhatsAppBatch } = require('../../../services/retryWhatsAppBatch');

function newCronRunId() {
  return new mongoose.Types.ObjectId();
}

/**
 * @param {'pre4hr'|'meet'|'30min'} kind
 * @param {{ now?: Date, cronRunId?: object, limit?: number }} [opts]
 */
async function runReminderCron(kind, opts = {}) {
  const cronRunId = opts.cronRunId || newCronRunId();
  const stats = await dispatchDueReminderJobs({
    messageKinds: [kind],
    now: opts.now,
    cronRunId,
    cronJobKey: kind === 'pre4hr' ? 'send_reminders' : kind === 'meet' ? 'send_meetlinks' : 'send_30min_reminders',
    limit: opts.limit
  });
  return { stats, cronRunId };
}

/**
 * @param {{ now?: Date, cronRunId?: object }} [opts]
 */
async function runRetryCron(opts = {}) {
  const cronRunId = opts.cronRunId || newCronRunId();
  const stats = await executeRetryWhatsAppBatch(cronRunId);
  return { stats, cronRunId };
}

module.exports = {
  newCronRunId,
  runReminderCron,
  runRetryCron
};
