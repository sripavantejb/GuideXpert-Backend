const express = require('express');
const router = express.Router();
const FormSubmission = require('../models/FormSubmission');
const MessagingCronRun = require('../models/MessagingCronRun');
const { sendBulkReminderSms, sendBulkMeetLinkSms, sendBulkReminder30MinSms } = require('../utils/msg91Service');
const { buildSlotNotificationVariables } = require('../utils/slotNotificationFormatters');
const {
  sendPre4HrReminderWhatsApp,
  sendMeetLinkWhatsApp,
  sendReminder30MinWhatsApp
} = require('../services/gupshupService');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { safeSendWhatsApp } = require('../utils/safeSendWhatsApp');
const { executeRetryWhatsAppBatch } = require('../services/retryWhatsAppBatch');
const { isOsviConfigured } = require('../utils/osviService');
const { processOsviOutboundForPhone } = require('../utils/osviOutboundProcessor');
const { hasCronSecretConfigured, isValidCronSecret } = require('../utils/cronSecret');
const {
  getPre4hrCronConfigFromEnv,
  getPre4hrSlotDateBoundsForCron
} = require('../utils/pre4hrSchedule');
const {
  getMeetCronConfigFromEnv,
  getMeetSlotDateBoundsForCron,
  get30MinCronConfigFromEnv,
  get30MinSlotDateBoundsForCron
} = require('../utils/waSlotRelativeSchedule');
const {
  claimSubmissionsForCronJob,
  clearCronClaimForPhone,
  clearCronClaimsForPhones
} = require('../utils/waCronReminderClaims');
const {
  campaignSlotDateNotBeforeSendBoundaryExpr,
  mergeExprIntoFilter
} = require('../utils/waCronCampaignFilters');
const {
  tryAcquireCronCampaignInitialSendLease,
  releaseCronCampaignInitialSendLease,
  leaseFieldForKind
} = require('../utils/waCronCampaignSendGate');

const PRE4HR_CLAIM = 'waPre4hrCronClaimUntil';
const MEET_CLAIM = 'waMeetCronClaimUntil';
const MIN30_CLAIM = 'wa30minCronClaimUntil';

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
 * Atomic FormSubmission lease so only winners run SMS+WA (claim TTL alone is not enough).
 */
async function gateCronCampaignUsersForInitialSend(FormSubmission, params) {
  const { kind, users, now, slotDateMin, slotDateMax, boundaryExpr, cronRunId, claimKey } = params;
  const out = [];
  for (const user of users) {
    const { acquired } = await tryAcquireCronCampaignInitialSendLease(FormSubmission, {
      kind,
      submissionId: user._id,
      now,
      slotDateMin,
      slotDateMax,
      boundaryExpr,
      cronRunId
    });
    if (!acquired) {
      await clearCronClaimForPhone(FormSubmission, user.phone, claimKey);
      continue;
    }
    out.push(user);
  }
  return out;
}

router.get('/send-reminders', verifyCronSecret, async (req, res) => {
  let cronRun = null;
  try {
    console.log('[Cron] Starting reminder SMS job...');
    cronRun = await startCronRun('send_reminders');

    const now = new Date();
    const pre4hrCfg = getPre4hrCronConfigFromEnv();
    const { slotDateMin, slotDateMax, deadlineForwardSlackMs } = getPre4hrSlotDateBoundsForCron(now, pre4hrCfg);

    const pre4hrWindowStats = {
      pre4hrSlotDateMinIso: slotDateMin.toISOString(),
      pre4hrSlotDateMaxIso: slotDateMax.toISOString(),
      pre4hrOffsetMs: pre4hrCfg.offsetMs,
      pre4hrWindowMs: pre4hrCfg.windowMs,
      pre4hrDeadlineForwardSlackMs: deadlineForwardSlackMs
    };

    console.log('[Cron] pre4hr slotDate window (deadline-backward: last windowMs before now+offset)', {
      nowIso: now.toISOString(),
      slotDateMinIso: slotDateMin.toISOString(),
      slotDateMaxIso: slotDateMax.toISOString(),
      offsetMs: pre4hrCfg.offsetMs,
      windowMs: pre4hrCfg.windowMs,
      deadlineForwardSlackMs
    });

    const pre4hrExpr = campaignSlotDateNotBeforeSendBoundaryExpr(pre4hrCfg.offsetMs, now);
    const usersToRemind = await claimSubmissionsForCronJob(
      FormSubmission,
      mergeExprIntoFilter(
        {
          isRegistered: true,
          reminderSent: { $ne: true },
          'step3Data.slotDate': {
            $gt: now,
            $gte: slotDateMin,
            $lte: slotDateMax
          }
        },
        pre4hrExpr
      ),
      PRE4HR_CLAIM
    );

    console.log('[Cron] Found', usersToRemind.length, 'users to send reminders (pre4hr band, claimed)');

    if (usersToRemind.length === 0) {
      await finishCronRun(cronRun, {
        found: 0,
        smsSent: 0,
        smsFailed: 0,
        waAttempted: 0,
        waSucceeded: 0,
        waFailed: 0,
        retriesAttempted: 0,
        flagsUpdated: 0,
        ...pre4hrWindowStats
      });
      return res.status(200).json({
        success: true,
        message: 'No reminders to send',
        stats: { found: 0, sent: 0, failed: 0, ...pre4hrWindowStats }
      });
    }

    const pre4hrLeasePath = leaseFieldForKind('pre4hr');
    const gatedUsers = await gateCronCampaignUsersForInitialSend(FormSubmission, {
      kind: 'pre4hr',
      users: usersToRemind,
      now,
      slotDateMin,
      slotDateMax,
      boundaryExpr: pre4hrExpr,
      cronRunId: cronRun._id,
      claimKey: PRE4HR_CLAIM
    });

    console.log('[Cron] pre4hr claimed vs initial-send lease', {
      claimed: usersToRemind.length,
      leased: gatedUsers.length
    });

    if (gatedUsers.length === 0) {
      await finishCronRun(cronRun, {
        found: usersToRemind.length,
        eligibleAfterInitialSendLease: 0,
        smsSent: 0,
        smsFailed: 0,
        waAttempted: 0,
        waSucceeded: 0,
        waFailed: 0,
        retriesAttempted: 0,
        flagsUpdated: 0,
        ...pre4hrWindowStats
      });
      return res.status(200).json({
        success: true,
        message: 'No reminders to send (initial-send lease not acquired)',
        stats: {
          found: usersToRemind.length,
          eligibleAfterInitialSendLease: 0,
          sent: 0,
          failed: 0,
          ...pre4hrWindowStats
        }
      });
    }

    const phones = gatedUsers.map((user) => user.phone);
    const variables = {};
    const smsResult = await sendBulkReminderSms(phones, variables);

    let whatsappReminderAttempted = 0;
    let whatsappReminderFailed = 0;
    let whatsappReminderSucceeded = 0;
    let flagsUpdated = 0;

    if (!smsResult.success) {
      console.error('[Cron] Failed to send bulk SMS:', smsResult.error);
      await clearCronClaimsForPhones(FormSubmission, phones, PRE4HR_CLAIM);
      for (const user of gatedUsers) {
        await releaseCronCampaignInitialSendLease(FormSubmission, 'pre4hr', user._id);
      }
    }

    if (smsResult.success) {
      const waRetryGroup = await WhatsAppRetryGroup.create({
        messageKind: 'pre4hr',
        cronRunId: cronRun._id,
        trigger: 'cron',
        status: 'open'
      });
      for (const user of gatedUsers) {
        whatsappReminderAttempted += 1;
        const waVars = buildSlotNotificationVariables(user);
        const wa = await safeSendWhatsApp({
          phone10: user.phone,
          formSubmissionId: user._id,
          vars: waVars,
          retryKind: 'pre4hr',
          source: 'cron',
          cronRunId: cronRun._id,
          cronJobKey: 'send_reminders',
          sendFn: (phone10, vars, sendOpts) => sendPre4HrReminderWhatsApp(phone10, vars, sendOpts || {}),
          retryGroupId: waRetryGroup._id,
          attemptNumber: 1,
          attemptBatchId: cronRun._id
        });
        if (wa.duplicateInFlight) {
          await releaseCronCampaignInitialSendLease(FormSubmission, 'pre4hr', user._id);
          await clearCronClaimForPhone(FormSubmission, user.phone, PRE4HR_CLAIM);
          continue;
        }
        if (wa.skippedOutsideWindow) {
          await releaseCronCampaignInitialSendLease(FormSubmission, 'pre4hr', user._id);
          await clearCronClaimForPhone(FormSubmission, user.phone, PRE4HR_CLAIM);
          continue;
        }
        if (wa.success) {
          whatsappReminderSucceeded += 1;
          await FormSubmission.updateOne(
            { phone: user.phone },
            {
              $set: {
                reminderSent: true,
                reminderSentAt: new Date()
              },
              $unset: { [PRE4HR_CLAIM]: '', [pre4hrLeasePath]: '' }
            }
          );
          flagsUpdated += 1;
        } else {
          whatsappReminderFailed += 1;
          await releaseCronCampaignInitialSendLease(FormSubmission, 'pre4hr', user._id);
          await clearCronClaimForPhone(FormSubmission, user.phone, PRE4HR_CLAIM);
        }
      }

      console.log('[Cron] Successfully sent reminders; WA flags updated per user:', flagsUpdated);
    }

    await finishCronRun(cronRun, {
      found: usersToRemind.length,
      eligibleAfterInitialSendLease: gatedUsers.length,
      smsSent: smsResult.sentCount || 0,
      smsFailed: smsResult.failedCount || 0,
      waAttempted: whatsappReminderAttempted,
      waSucceeded: whatsappReminderSucceeded,
      waFailed: whatsappReminderFailed,
      retriesAttempted: 0,
      flagsUpdated,
      ...pre4hrWindowStats
    }, { success: smsResult.success });

    return res.status(200).json({
      success: true,
      message: smsResult.success ? 'Reminders sent successfully' : 'Failed to send some reminders',
      stats: {
        found: usersToRemind.length,
        eligibleAfterInitialSendLease: gatedUsers.length,
        sent: smsResult.sentCount,
        failed: smsResult.failedCount,
        whatsappAttempted: whatsappReminderAttempted,
        whatsappFailed: whatsappReminderFailed,
        whatsappSucceeded: whatsappReminderSucceeded,
        ...pre4hrWindowStats
      },
      error: smsResult.error || null
    });
  } catch (error) {
    console.error('[Cron] Error in send-reminders:', error);
    if (cronRun) {
      await finishCronRun(
        cronRun,
        { found: 0, smsSent: 0, smsFailed: 0, waAttempted: 0, waSucceeded: 0, waFailed: 0, retriesAttempted: 0, flagsUpdated: 0 },
        { success: false, errorSummary: error.message }
      ).catch(() => {});
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

router.get('/send-meetlinks', verifyCronSecret, async (req, res) => {
  let cronRun = null;
  try {
    console.log('[Cron] Starting meet link SMS job...');
    cronRun = await startCronRun('send_meetlinks');

    const now = new Date();
    const meetCfg = getMeetCronConfigFromEnv();
    const { slotDateMin: meetSlotMin, slotDateMax: meetSlotMax, deadlineForwardSlackMs: meetSlack } =
      getMeetSlotDateBoundsForCron(now, meetCfg);

    console.log('[Cron] meet slotDate window (deadline-backward)', {
      nowIso: now.toISOString(),
      slotDateMinIso: meetSlotMin.toISOString(),
      slotDateMaxIso: meetSlotMax.toISOString(),
      offsetMs: meetCfg.offsetMs,
      windowMs: meetCfg.windowMs,
      deadlineForwardSlackMs: meetSlack
    });

    const meetExpr = campaignSlotDateNotBeforeSendBoundaryExpr(meetCfg.offsetMs, now);
    const usersToSendMeetLink = await claimSubmissionsForCronJob(
      FormSubmission,
      mergeExprIntoFilter(
        {
          isRegistered: true,
          meetLinkSent: { $ne: true },
          'step3Data.slotDate': {
            $gt: now,
            $gte: meetSlotMin,
            $lte: meetSlotMax
          }
        },
        meetExpr
      ),
      MEET_CLAIM
    );

    console.log('[Cron] Found', usersToSendMeetLink.length, 'users to send meet links (meet band, claimed)');

    const meetWindowStats = {
      meetSlotDateMinIso: meetSlotMin.toISOString(),
      meetSlotDateMaxIso: meetSlotMax.toISOString(),
      meetOffsetMs: meetCfg.offsetMs,
      meetWindowMs: meetCfg.windowMs,
      meetDeadlineForwardSlackMs: meetSlack
    };

    if (usersToSendMeetLink.length === 0) {
      await finishCronRun(cronRun, {
        found: 0,
        smsSent: 0,
        smsFailed: 0,
        waAttempted: 0,
        waSucceeded: 0,
        waFailed: 0,
        retriesAttempted: 0,
        flagsUpdated: 0,
        ...meetWindowStats
      });
      return res.status(200).json({
        success: true,
        message: 'No meet links to send',
        stats: { found: 0, sent: 0, failed: 0, ...meetWindowStats }
      });
    }

    const meetLeasePath = leaseFieldForKind('meet');
    const gatedMeetUsers = await gateCronCampaignUsersForInitialSend(FormSubmission, {
      kind: 'meet',
      users: usersToSendMeetLink,
      now,
      slotDateMin: meetSlotMin,
      slotDateMax: meetSlotMax,
      boundaryExpr: meetExpr,
      cronRunId: cronRun._id,
      claimKey: MEET_CLAIM
    });

    console.log('[Cron] meet claimed vs initial-send lease', {
      claimed: usersToSendMeetLink.length,
      leased: gatedMeetUsers.length
    });

    if (gatedMeetUsers.length === 0) {
      await finishCronRun(cronRun, {
        found: usersToSendMeetLink.length,
        eligibleAfterInitialSendLease: 0,
        smsSent: 0,
        smsFailed: 0,
        waAttempted: 0,
        waSucceeded: 0,
        waFailed: 0,
        retriesAttempted: 0,
        flagsUpdated: 0,
        ...meetWindowStats
      });
      return res.status(200).json({
        success: true,
        message: 'No meet links to send (initial-send lease not acquired)',
        stats: {
          found: usersToSendMeetLink.length,
          eligibleAfterInitialSendLease: 0,
          sent: 0,
          failed: 0,
          ...meetWindowStats
        }
      });
    }

    const phones = gatedMeetUsers.map((user) => user.phone);
    const meetingLink = process.env.DEMO_MEETING_LINK || 'https://guidexpert.co.in/demo';
    const variables = {
      var: meetingLink
    };

    console.log('[Cron] Using meeting link:', meetingLink);

    const smsResult = await sendBulkMeetLinkSms(phones, variables);

    let whatsappMeetAttempted = 0;
    let whatsappMeetFailed = 0;
    let whatsappMeetSucceeded = 0;
    let meetFlagsUpdated = 0;

    if (!smsResult.success) {
      console.error('[Cron] Failed to send bulk meet link SMS:', smsResult.error);
      await clearCronClaimsForPhones(FormSubmission, phones, MEET_CLAIM);
      for (const user of gatedMeetUsers) {
        await releaseCronCampaignInitialSendLease(FormSubmission, 'meet', user._id);
      }
    }

    if (smsResult.success) {
      const waRetryGroup = await WhatsAppRetryGroup.create({
        messageKind: 'meet',
        cronRunId: cronRun._id,
        trigger: 'cron',
        status: 'open'
      });
      for (const user of gatedMeetUsers) {
        whatsappMeetAttempted += 1;
        const waVars = buildSlotNotificationVariables(user, { withMeetingLink: true });
        const wa = await safeSendWhatsApp({
          phone10: user.phone,
          formSubmissionId: user._id,
          vars: waVars,
          retryKind: 'meet',
          source: 'cron',
          cronRunId: cronRun._id,
          cronJobKey: 'send_meetlinks',
          sendFn: (phone10, vars, sendOpts) => sendMeetLinkWhatsApp(phone10, vars, sendOpts || {}),
          retryGroupId: waRetryGroup._id,
          attemptNumber: 1,
          attemptBatchId: cronRun._id
        });
        if (wa.duplicateInFlight) {
          await releaseCronCampaignInitialSendLease(FormSubmission, 'meet', user._id);
          await clearCronClaimForPhone(FormSubmission, user.phone, MEET_CLAIM);
          continue;
        }
        if (wa.skippedOutsideWindow) {
          await releaseCronCampaignInitialSendLease(FormSubmission, 'meet', user._id);
          await clearCronClaimForPhone(FormSubmission, user.phone, MEET_CLAIM);
          continue;
        }
        if (wa.success) {
          whatsappMeetSucceeded += 1;
          await FormSubmission.updateOne(
            { phone: user.phone },
            {
              $set: {
                meetLinkSent: true,
                meetLinkSentAt: new Date()
              },
              $unset: { [MEET_CLAIM]: '', [meetLeasePath]: '' }
            }
          );
          meetFlagsUpdated += 1;
        } else {
          whatsappMeetFailed += 1;
          await releaseCronCampaignInitialSendLease(FormSubmission, 'meet', user._id);
          await clearCronClaimForPhone(FormSubmission, user.phone, MEET_CLAIM);
        }
      }

      console.log('[Cron] Successfully sent meet links; WA flags updated per user:', meetFlagsUpdated);
    }

    await finishCronRun(cronRun, {
      found: usersToSendMeetLink.length,
      eligibleAfterInitialSendLease: gatedMeetUsers.length,
      smsSent: smsResult.sentCount || 0,
      smsFailed: smsResult.failedCount || 0,
      waAttempted: whatsappMeetAttempted,
      waSucceeded: whatsappMeetSucceeded,
      waFailed: whatsappMeetFailed,
      retriesAttempted: 0,
      flagsUpdated: meetFlagsUpdated,
      ...meetWindowStats
    }, { success: smsResult.success });

    return res.status(200).json({
      success: true,
      message: smsResult.success ? 'Meet links sent successfully' : 'Failed to send some meet links',
      stats: {
        found: usersToSendMeetLink.length,
        eligibleAfterInitialSendLease: gatedMeetUsers.length,
        sent: smsResult.sentCount,
        failed: smsResult.failedCount,
        whatsappAttempted: whatsappMeetAttempted,
        whatsappFailed: whatsappMeetFailed,
        whatsappSucceeded: whatsappMeetSucceeded,
        ...meetWindowStats
      },
      error: smsResult.error || null
    });
  } catch (error) {
    console.error('[Cron] Error in send-meetlinks:', error);
    if (cronRun) {
      await finishCronRun(
        cronRun,
        { found: 0, smsSent: 0, smsFailed: 0, waAttempted: 0, waSucceeded: 0, waFailed: 0, retriesAttempted: 0, flagsUpdated: 0 },
        { success: false, errorSummary: error.message }
      ).catch(() => {});
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

router.get('/send-30min-reminders', verifyCronSecret, async (req, res) => {
  let cronRun = null;
  try {
    console.log('[Cron] Starting 30-min reminder SMS job...');
    cronRun = await startCronRun('send_30min_reminders');

    const now = new Date();
    const thirtyCfg = get30MinCronConfigFromEnv();
    const { slotDateMin: thirtySlotMin, slotDateMax: thirtySlotMax, deadlineForwardSlackMs: thirtySlack } =
      get30MinSlotDateBoundsForCron(now, thirtyCfg);

    console.log('[Cron] 30min slotDate window (deadline-backward)', {
      nowIso: now.toISOString(),
      slotDateMinIso: thirtySlotMin.toISOString(),
      slotDateMaxIso: thirtySlotMax.toISOString(),
      offsetMs: thirtyCfg.offsetMs,
      windowMs: thirtyCfg.windowMs,
      deadlineForwardSlackMs: thirtySlack
    });

    const thirtyExpr = campaignSlotDateNotBeforeSendBoundaryExpr(thirtyCfg.offsetMs, now);
    const usersToSend30MinReminder = await claimSubmissionsForCronJob(
      FormSubmission,
      mergeExprIntoFilter(
        {
          isRegistered: true,
          reminder30MinSent: { $ne: true },
          'step3Data.slotDate': {
            $gt: now,
            $gte: thirtySlotMin,
            $lte: thirtySlotMax
          }
        },
        thirtyExpr
      ),
      MIN30_CLAIM
    );

    console.log('[Cron] Found', usersToSend30MinReminder.length, 'users to send 30-min reminders (30min band, claimed)');

    const thirtyMinWindowStats = {
      thirtyMinSlotDateMinIso: thirtySlotMin.toISOString(),
      thirtyMinSlotDateMaxIso: thirtySlotMax.toISOString(),
      thirtyMinOffsetMs: thirtyCfg.offsetMs,
      thirtyMinWindowMs: thirtyCfg.windowMs,
      thirtyMinDeadlineForwardSlackMs: thirtySlack
    };

    if (usersToSend30MinReminder.length === 0) {
      await finishCronRun(cronRun, {
        found: 0,
        smsSent: 0,
        smsFailed: 0,
        waAttempted: 0,
        waSucceeded: 0,
        waFailed: 0,
        retriesAttempted: 0,
        flagsUpdated: 0,
        ...thirtyMinWindowStats
      });
      return res.status(200).json({
        success: true,
        message: 'No 30-min reminders to send',
        stats: { found: 0, sent: 0, failed: 0, ...thirtyMinWindowStats }
      });
    }

    const min30LeasePath = leaseFieldForKind('30min');
    const gated30Users = await gateCronCampaignUsersForInitialSend(FormSubmission, {
      kind: '30min',
      users: usersToSend30MinReminder,
      now,
      slotDateMin: thirtySlotMin,
      slotDateMax: thirtySlotMax,
      boundaryExpr: thirtyExpr,
      cronRunId: cronRun._id,
      claimKey: MIN30_CLAIM
    });

    console.log('[Cron] 30min claimed vs initial-send lease', {
      claimed: usersToSend30MinReminder.length,
      leased: gated30Users.length
    });

    if (gated30Users.length === 0) {
      await finishCronRun(cronRun, {
        found: usersToSend30MinReminder.length,
        eligibleAfterInitialSendLease: 0,
        smsSent: 0,
        smsFailed: 0,
        waAttempted: 0,
        waSucceeded: 0,
        waFailed: 0,
        retriesAttempted: 0,
        flagsUpdated: 0,
        ...thirtyMinWindowStats
      });
      return res.status(200).json({
        success: true,
        message: 'No 30-min reminders to send (initial-send lease not acquired)',
        stats: {
          found: usersToSend30MinReminder.length,
          eligibleAfterInitialSendLease: 0,
          sent: 0,
          failed: 0,
          ...thirtyMinWindowStats
        }
      });
    }

    const phones = gated30Users.map((user) => user.phone);
    const meetingLink = process.env.DEMO_MEETING_LINK || 'https://guidexpert.co.in/demo';
    const variables = {
      var: meetingLink
    };

    console.log('[Cron] Using meeting link for 30-min reminder:', meetingLink);

    const smsResult = await sendBulkReminder30MinSms(phones, variables);

    let whatsapp30Attempted = 0;
    let whatsapp30Failed = 0;
    let whatsapp30Succeeded = 0;
    let min30FlagsUpdated = 0;

    if (!smsResult.success) {
      console.error('[Cron] Failed to send bulk 30-min reminder SMS:', smsResult.error);
      await clearCronClaimsForPhones(FormSubmission, phones, MIN30_CLAIM);
      for (const user of gated30Users) {
        await releaseCronCampaignInitialSendLease(FormSubmission, '30min', user._id);
      }
    }

    if (smsResult.success) {
      const waRetryGroup = await WhatsAppRetryGroup.create({
        messageKind: '30min',
        cronRunId: cronRun._id,
        trigger: 'cron',
        status: 'open'
      });
      for (const user of gated30Users) {
        whatsapp30Attempted += 1;
        const waVars = buildSlotNotificationVariables(user, { withMeetingLink: true });
        const wa = await safeSendWhatsApp({
          phone10: user.phone,
          formSubmissionId: user._id,
          vars: waVars,
          retryKind: '30min',
          source: 'cron',
          cronRunId: cronRun._id,
          cronJobKey: 'send_30min_reminders',
          sendFn: (phone10, vars, sendOpts) => sendReminder30MinWhatsApp(phone10, vars, sendOpts || {}),
          retryGroupId: waRetryGroup._id,
          attemptNumber: 1,
          attemptBatchId: cronRun._id
        });
        if (wa.duplicateInFlight) {
          await releaseCronCampaignInitialSendLease(FormSubmission, '30min', user._id);
          await clearCronClaimForPhone(FormSubmission, user.phone, MIN30_CLAIM);
          continue;
        }
        if (wa.skippedOutsideWindow) {
          await releaseCronCampaignInitialSendLease(FormSubmission, '30min', user._id);
          await clearCronClaimForPhone(FormSubmission, user.phone, MIN30_CLAIM);
          continue;
        }
        if (wa.success) {
          whatsapp30Succeeded += 1;
          await FormSubmission.updateOne(
            { phone: user.phone },
            {
              $set: {
                reminder30MinSent: true,
                reminder30MinSentAt: new Date()
              },
              $unset: { [MIN30_CLAIM]: '', [min30LeasePath]: '' }
            }
          );
          min30FlagsUpdated += 1;
        } else {
          whatsapp30Failed += 1;
          await releaseCronCampaignInitialSendLease(FormSubmission, '30min', user._id);
          await clearCronClaimForPhone(FormSubmission, user.phone, MIN30_CLAIM);
        }
      }

      console.log('[Cron] Successfully sent 30-min reminders; WA flags updated per user:', min30FlagsUpdated);
    }

    await finishCronRun(cronRun, {
      found: usersToSend30MinReminder.length,
      eligibleAfterInitialSendLease: gated30Users.length,
      smsSent: smsResult.sentCount || 0,
      smsFailed: smsResult.failedCount || 0,
      waAttempted: whatsapp30Attempted,
      waSucceeded: whatsapp30Succeeded,
      waFailed: whatsapp30Failed,
      retriesAttempted: 0,
      flagsUpdated: min30FlagsUpdated,
      ...thirtyMinWindowStats
    }, { success: smsResult.success });

    return res.status(200).json({
      success: true,
      message: smsResult.success ? '30-min reminders sent successfully' : 'Failed to send some 30-min reminders',
      stats: {
        found: usersToSend30MinReminder.length,
        eligibleAfterInitialSendLease: gated30Users.length,
        sent: smsResult.sentCount,
        failed: smsResult.failedCount,
        whatsappAttempted: whatsapp30Attempted,
        whatsappFailed: whatsapp30Failed,
        whatsappSucceeded: whatsapp30Succeeded,
        ...thirtyMinWindowStats
      },
      error: smsResult.error || null
    });
  } catch (error) {
    console.error('[Cron] Error in send-30min-reminders:', error);
    if (cronRun) {
      await finishCronRun(
        cronRun,
        { found: 0, smsSent: 0, smsFailed: 0, waAttempted: 0, waSucceeded: 0, waFailed: 0, retriesAttempted: 0, flagsUpdated: 0 },
        { success: false, errorSummary: error.message }
      ).catch(() => {});
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
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
        flagsUpdated: 0
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
        processed: 0,
      });
    }

    const now = new Date();
    const due = await FormSubmission.find({
      osviOutboundCallStatus: 'pending',
      osviOutboundScheduledAt: { $lte: now },
    })
      .limit(50)
      .lean();

    const results = [];

    for (const doc of due) {
      const r = await processOsviOutboundForPhone(doc.phone);
      results.push({
        phoneSuffix: doc.phone.slice(-4),
        ...r,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Processed ${due.length} OSVI outbound job(s)`,
      processed: due.length,
      results,
    });
  } catch (error) {
    console.error('[Cron] osvi-outbound-due:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
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
