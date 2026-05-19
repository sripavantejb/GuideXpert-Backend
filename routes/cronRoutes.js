const express = require('express');
const router = express.Router();
const FormSubmission = require('../models/FormSubmission');
const MessagingCronRun = require('../models/MessagingCronRun');
const { executeRetryWhatsAppBatch } = require('../services/retryWhatsAppBatch');
const { isOsviConfigured } = require('../utils/osviService');
const { processOsviOutboundForPhone } = require('../utils/osviOutboundProcessor');
const { hasCronSecretConfigured, isValidCronSecret } = require('../utils/cronSecret');
const {
  dispatchDueReminderJobs,
  cronJobKeyForKind
} = require('../services/whatsappReminderJobDispatcher');

function verifyCronSecret(req, res, next) {
  if (!hasCronSecretConfigured()) {
    console.error('[Cron] No cron secret — set GUIDEXPERT_CRON_SECRET or CRON_SECRET');
    return res.status(500).json({ success: false, message: 'Cron not configured' });
  }

  const queryKey = req.query.key;
  const headerKey = req.headers['x-cron-key'];
  const authHeader = req.headers.authorization || req.headers.Authorization;
  let bearerKey;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    bearerKey = authHeader.slice(7).trim();
  }

  const providedKey = queryKey || headerKey || bearerKey;

  if (!isValidCronSecret(providedKey)) {
    console.warn('[Cron] Invalid cron key attempt');
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const authMode = bearerKey ? 'bearer' : (headerKey ? 'x-cron-key' : 'query');
  console.log('[Cron] Authenticated request', {
    path: req.path,
    mode: authMode,
    userAgent: req.headers['user-agent'] || 'unknown'
  });

  next();
}

async function startCronRun(jobKey) {
  return MessagingCronRun.create({
    jobKey,
    startedAt: new Date(),
    success: false,
    trigger: 'cron',
    stats: {}
  });
}

async function finishCronRun(run, baseStats, overrides = {}) {
  const finishedAt = new Date();
  const durationMs = run && run.startedAt ? finishedAt - new Date(run.startedAt).getTime() : null;
  const mergedStats = { ...baseStats, ...(overrides.stats || {}) };
  await MessagingCronRun.updateOne(
    { _id: run._id },
    {
      $set: {
        finishedAt,
        durationMs,
        stats: mergedStats,
        success: overrides.success !== undefined ? overrides.success : true,
        errorSummary: overrides.errorSummary ?? null
      }
    }
  );
}

/**
 * P3: dispatch due WhatsAppReminderJob rows for one campaign kind.
 */
async function runReminderJobCron(req, res, messageKind) {
  let cronRun = null;
  const jobKey = cronJobKeyForKind(messageKind);
  try {
    cronRun = await startCronRun(jobKey);
    const now = new Date();
    const stats = await dispatchDueReminderJobs({
      messageKinds: [messageKind],
      now,
      cronRunId: cronRun._id,
      cronJobKey: jobKey
    });

    const payload = {
      scheduler: 'reminder_job_v3',
      messageKind,
      nowIso: now.toISOString(),
      ...stats
    };

    await finishCronRun(
      cronRun,
      {
        found: stats.jobsClaimed,
        eligibleAfterInitialSendLease: stats.jobsClaimed,
        smsSent: 0,
        smsFailed: 0,
        waAttempted: stats.jobsDispatched + stats.jobsFailed,
        waSucceeded: stats.jobsDispatched,
        waFailed: stats.jobsFailed,
        retriesAttempted: 0,
        flagsUpdated: stats.jobsDispatched,
        ...stats
      },
      { success: true }
    );

    return res.status(200).json({
      success: true,
      message: `${messageKind} reminder jobs processed`,
      stats: payload
    });
  } catch (error) {
    console.error(`[Cron] Error in ${jobKey}:`, error);
    if (cronRun) {
      await finishCronRun(
        cronRun,
        { found: 0, waAttempted: 0, waSucceeded: 0, waFailed: 0 },
        { success: false, errorSummary: error.message }
      ).catch(() => {});
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
}

router.get('/send-reminders', verifyCronSecret, (req, res) =>
  runReminderJobCron(req, res, 'pre4hr')
);

router.get('/send-meetlinks', verifyCronSecret, (req, res) =>
  runReminderJobCron(req, res, 'meet')
);

router.get('/send-30min-reminders', verifyCronSecret, (req, res) =>
  runReminderJobCron(req, res, '30min')
);

router.get('/send-iit-reminders', verifyCronSecret, async (req, res) => {
  let cronRun = null;
  const jobKey = 'send_iit_reminders';
  const { IIT_REMINDER_MESSAGE_KINDS } = require('../models/WhatsAppReminderJob');
  try {
    cronRun = await startCronRun(jobKey);
    const now = new Date();
    const stats = await dispatchDueReminderJobs({
      messageKinds: [...IIT_REMINDER_MESSAGE_KINDS],
      now,
      cronRunId: cronRun._id,
      cronJobKey: jobKey,
    });

    const payload = {
      scheduler: 'iit_reminder_job_v1',
      messageKinds: IIT_REMINDER_MESSAGE_KINDS,
      nowIso: now.toISOString(),
      ...stats,
    };

    await finishCronRun(
      cronRun,
      {
        found: stats.jobsClaimed,
        waAttempted: stats.jobsDispatched + stats.jobsFailed,
        waSucceeded: stats.jobsDispatched,
        waFailed: stats.jobsFailed,
        ...stats,
      },
      { success: true }
    );

    return res.status(200).json({
      success: true,
      message: 'IIT reminder jobs processed',
      stats: payload,
    });
  } catch (error) {
    console.error('[Cron] Error in send-iit-reminders:', error);
    if (cronRun) {
      await finishCronRun(
        cronRun,
        { found: 0, waAttempted: 0, waSucceeded: 0, waFailed: 0 },
        { success: false, errorSummary: error.message }
      ).catch(() => {});
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

router.get('/retry-whatsapp', verifyCronSecret, async (req, res) => {
  let cronRun = null;
  try {
    console.log('[Cron] Starting retry WhatsApp job...');
    cronRun = await startCronRun('retry_whatsapp');

    const batch = await executeRetryWhatsAppBatch(cronRun._id);
    console.log('[Cron] Retry WhatsApp batch result', {
      cronRunId: String(cronRun._id),
      found: batch.found || 0,
      groupsTouched: batch.groupsTouched || 0,
      attempted: batch.attempted || 0,
      succeeded: batch.succeeded || 0,
      failed: batch.failed || 0,
      reconcileStale: batch.reconcileStale || null,
      slotBookedImmediate: batch.slotBookedImmediate || null
    });

    await finishCronRun(
      cronRun,
      {
        found: batch.found,
        smsSent: 0,
        smsFailed: 0,
        waAttempted: batch.attempted,
        waSucceeded: batch.succeeded,
        waFailed: batch.failed,
        retriesAttempted: batch.attempted,
        flagsUpdated: 0,
        reconcileStale: batch.reconcileStale || null
      },
      { success: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Retry WhatsApp batch completed',
      stats: batch
    });
  } catch (error) {
    console.error('[Cron] retry-whatsapp:', error);
    if (cronRun) {
      await finishCronRun(
        cronRun,
        { found: 0, smsSent: 0, smsFailed: 0, waAttempted: 0, waSucceeded: 0, waFailed: 0, retriesAttempted: 0, flagsUpdated: 0 },
        { success: false, errorSummary: error.message }
      ).catch(() => {});
    }
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

router.get('/osvi-outbound-due', verifyCronSecret, async (req, res) => {
  try {
    if (!isOsviConfigured()) {
      return res.status(200).json({
        success: true,
        message: 'OSVI not configured',
        processed: 0
      });
    }

    const now = new Date();
    const due = await FormSubmission.find({
      osviOutboundCallStatus: 'pending',
      osviOutboundScheduledAt: { $lte: now }
    })
      .limit(50)
      .lean();

    const results = [];

    for (const doc of due) {
      const r = await processOsviOutboundForPhone(doc.phone);
      results.push({
        phoneSuffix: doc.phone.slice(-4),
        ...r
      });
    }

    return res.status(200).json({
      success: true,
      message: `Processed ${due.length} OSVI outbound job(s)`,
      processed: due.length,
      results
    });
  } catch (error) {
    console.error('[Cron] osvi-outbound-due:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Cron service is healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
