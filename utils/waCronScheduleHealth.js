/**
 * Campaign cron schedule health — last successful MessagingCronRun per jobKey.
 */
const MessagingCronRun = require('../models/MessagingCronRun');
const { CRON_JOB_KEYS } = MessagingCronRun;

const REQUIRED_CAMPAIGN_CRONS = [
  { jobKey: CRON_JOB_KEYS.SEND_REMINDERS, path: '/api/cron/send-reminders', label: 'pre4hr reminders' },
  { jobKey: CRON_JOB_KEYS.SEND_MEETLINKS, path: '/api/cron/send-meetlinks', label: 'meet links' },
  { jobKey: CRON_JOB_KEYS.SEND_30MIN_REMINDERS, path: '/api/cron/send-30min-reminders', label: '30min reminders' },
  {
    jobKey: CRON_JOB_KEYS.SEND_IIT_REMINDERS,
    path: '/api/cron/send-iit-reminders',
    label: 'IIT counselling reminders',
  },
  {
    jobKey: CRON_JOB_KEYS.SEND_IIT_TELUGU_SMS,
    path: '/api/cron/send-iit-telugu-sms',
    label: 'IIT Telugu SMS (MSG91)',
  },
  { jobKey: CRON_JOB_KEYS.RETRY_WHATSAPP, path: '/api/cron/retry-whatsapp', label: 'retry WhatsApp' },
];

function cronMaxAgeMs() {
  const windowMs = parseInt(process.env.WA_PRE4HR_CRON_WINDOW_MS || '', 10) || 10 * 60 * 1000;
  return Math.max(
    20 * 60 * 1000,
    parseInt(process.env.WA_CRON_HEALTH_MAX_AGE_MS || '', 10) || windowMs * 2
  );
}

/**
 * @returns {Promise<{ configuredInVercel: boolean, maxAgeMs: number, jobs: object[], warnings: string[], healthy: boolean }>}
 */
async function getCronScheduleHealth() {
  const maxAgeMs = cronMaxAgeMs();
  const now = Date.now();
  const warnings = [];
  const jobs = [];

  for (const def of REQUIRED_CAMPAIGN_CRONS) {
    const last = await MessagingCronRun.findOne({
      jobKey: def.jobKey,
      success: true,
      trigger: 'cron'
    })
      .sort({ finishedAt: -1, startedAt: -1 })
      .select('startedAt finishedAt stats waAttempted waSucceeded')
      .lean();

    const finishedAt = last && last.finishedAt ? new Date(last.finishedAt).getTime() : null;
    const ageMs = finishedAt != null ? now - finishedAt : null;
    const stale = ageMs == null || ageMs > maxAgeMs;

    if (stale) {
      warnings.push(
        ageMs == null
          ? `${def.label} (${def.jobKey}): no successful run recorded`
          : `${def.label} (${def.jobKey}): last success ${Math.round(ageMs / 60000)}m ago (max ${Math.round(maxAgeMs / 60000)}m)`
      );
    }

    jobs.push({
      jobKey: def.jobKey,
      path: def.path,
      label: def.label,
      lastSuccessAt: last && last.finishedAt ? last.finishedAt : null,
      lastStartedAt: last && last.startedAt ? last.startedAt : null,
      ageMs,
      stale,
      stats: last && last.stats ? last.stats : null
    });
  }

  return {
    configuredInVercel: true,
    maxAgeMs,
    jobs,
    warnings,
    healthy: warnings.length === 0
  };
}

module.exports = {
  REQUIRED_CAMPAIGN_CRONS,
  getCronScheduleHealth,
  cronMaxAgeMs
};
