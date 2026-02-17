const express = require('express');
const router = express.Router();
const FormSubmission = require('../models/FormSubmission');
const { sendBulkReminderSms, sendBulkMeetLinkSms, sendBulkReminder30MinSms } = require('../utils/msg91Service');

/**
 * Middleware to verify cron secret key
 */
function verifyCronSecret(req, res, next) {
  const providedKey = req.query.key || req.headers['x-cron-key'];
  const expectedKey = process.env.CRON_SECRET;

  if (!expectedKey) {
    console.error('[Cron] CRON_SECRET not configured');
    return res.status(500).json({ success: false, message: 'Cron not configured' });
  }

  if (providedKey !== expectedKey) {
    console.warn('[Cron] Invalid cron key attempt');
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  next();
}

/**
 * GET /api/cron/send-reminders
 * Send reminder SMS to all users with slots in the next 4 hours
 * Protected by CRON_SECRET
 */
router.get('/send-reminders', verifyCronSecret, async (req, res) => {
  try {
    console.log('[Cron] Starting reminder SMS job...');

    // Calculate time window: now to 4 hours from now (in IST)
    const now = new Date();
    const fourHoursFromNow = new Date(now.getTime() + 4 * 60 * 60 * 1000);

    console.log('[Cron] Time window:', {
      now: now.toISOString(),
      fourHoursFromNow: fourHoursFromNow.toISOString()
    });

    // Find all registered users with slots in the next 4 hours who haven't received reminder
    const usersToRemind = await FormSubmission.find({
      isRegistered: true,
      reminderSent: { $ne: true },
      'step3Data.slotDate': {
        $gte: now,
        $lte: fourHoursFromNow
      }
    }).lean();

    console.log('[Cron] Found', usersToRemind.length, 'users to send reminders');

    if (usersToRemind.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No reminders to send',
        stats: { found: 0, sent: 0, failed: 0 }
      });
    }

    // Extract phone numbers
    const phones = usersToRemind.map(user => user.phone);

    // Prepare variables for the SMS template (if needed)
    // Since all users in this batch have slots in similar time window,
    // we can use generic variables or skip them if template doesn't need them
    const variables = {};

    // Send bulk SMS
    const smsResult = await sendBulkReminderSms(phones, variables);

    if (smsResult.success) {
      // Mark all users as reminder sent
      const phoneList = usersToRemind.map(u => u.phone);
      await FormSubmission.updateMany(
        { phone: { $in: phoneList } },
        {
          $set: {
            reminderSent: true,
            reminderSentAt: new Date()
          }
        }
      );

      console.log('[Cron] Successfully sent reminders and updated', phoneList.length, 'records');
    } else {
      console.error('[Cron] Failed to send bulk SMS:', smsResult.error);
    }

    return res.status(200).json({
      success: true,
      message: smsResult.success ? 'Reminders sent successfully' : 'Failed to send some reminders',
      stats: {
        found: usersToRemind.length,
        sent: smsResult.sentCount,
        failed: smsResult.failedCount
      },
      error: smsResult.error || null
    });

  } catch (error) {
    console.error('[Cron] Error in send-reminders:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * GET /api/cron/send-meetlinks
 * Send meet link SMS to all users with slots in the next 1 hour
 * Protected by CRON_SECRET
 */
router.get('/send-meetlinks', verifyCronSecret, async (req, res) => {
  try {
    console.log('[Cron] Starting meet link SMS job...');

    // Calculate time window: now to 1 hour from now
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 1 * 60 * 60 * 1000);

    console.log('[Cron] Meet link time window:', {
      now: now.toISOString(),
      oneHourFromNow: oneHourFromNow.toISOString()
    });

    // Find all registered users with slots in the next 1 hour who haven't received meet link
    const usersToSendMeetLink = await FormSubmission.find({
      isRegistered: true,
      meetLinkSent: { $ne: true },
      'step3Data.slotDate': {
        $gte: now,
        $lte: oneHourFromNow
      }
    }).lean();

    console.log('[Cron] Found', usersToSendMeetLink.length, 'users to send meet links');

    if (usersToSendMeetLink.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No meet links to send',
        stats: { found: 0, sent: 0, failed: 0 }
      });
    }

    // Extract phone numbers
    const phones = usersToSendMeetLink.map(user => user.phone);

    // Prepare variables for the SMS template
    // var = meeting link (maps to ##var## in MSG91 template)
    const meetingLink = process.env.DEMO_MEETING_LINK || 'https://guidexpert.co.in/demo';
    const variables = {
      var: meetingLink
    };

    console.log('[Cron] Using meeting link:', meetingLink);

    // Send bulk SMS
    const smsResult = await sendBulkMeetLinkSms(phones, variables);

    if (smsResult.success) {
      // Mark all users as meet link sent
      const phoneList = usersToSendMeetLink.map(u => u.phone);
      await FormSubmission.updateMany(
        { phone: { $in: phoneList } },
        {
          $set: {
            meetLinkSent: true,
            meetLinkSentAt: new Date()
          }
        }
      );

      console.log('[Cron] Successfully sent meet links and updated', phoneList.length, 'records');
    } else {
      console.error('[Cron] Failed to send bulk meet link SMS:', smsResult.error);
    }

    return res.status(200).json({
      success: true,
      message: smsResult.success ? 'Meet links sent successfully' : 'Failed to send some meet links',
      stats: {
        found: usersToSendMeetLink.length,
        sent: smsResult.sentCount,
        failed: smsResult.failedCount
      },
      error: smsResult.error || null
    });

  } catch (error) {
    console.error('[Cron] Error in send-meetlinks:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * GET /api/cron/send-30min-reminders
 * Send 30-min live reminder SMS to all users with slots in the next 30 minutes
 * Protected by CRON_SECRET
 */
router.get('/send-30min-reminders', verifyCronSecret, async (req, res) => {
  try {
    console.log('[Cron] Starting 30-min reminder SMS job...');

    // Calculate time window: now to 30 minutes from now
    const now = new Date();
    const thirtyMinFromNow = new Date(now.getTime() + 30 * 60 * 1000);

    console.log('[Cron] 30-min reminder time window:', {
      now: now.toISOString(),
      thirtyMinFromNow: thirtyMinFromNow.toISOString()
    });

    // Find all registered users with slots in the next 30 min who haven't received 30-min reminder
    const usersToSend30MinReminder = await FormSubmission.find({
      isRegistered: true,
      reminder30MinSent: { $ne: true },
      'step3Data.slotDate': {
        $gte: now,
        $lte: thirtyMinFromNow
      }
    }).lean();

    console.log('[Cron] Found', usersToSend30MinReminder.length, 'users to send 30-min reminders');

    if (usersToSend30MinReminder.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No 30-min reminders to send',
        stats: { found: 0, sent: 0, failed: 0 }
      });
    }

    // Extract phone numbers
    const phones = usersToSend30MinReminder.map(user => user.phone);

    // Prepare variables for the SMS template
    // var = meeting link (maps to ##var## in MSG91 template)
    const meetingLink = process.env.DEMO_MEETING_LINK || 'https://guidexpert.co.in/demo';
    const variables = {
      var: meetingLink
    };

    console.log('[Cron] Using meeting link for 30-min reminder:', meetingLink);

    // Send bulk SMS
    const smsResult = await sendBulkReminder30MinSms(phones, variables);

    if (smsResult.success) {
      // Mark all users as 30-min reminder sent
      const phoneList = usersToSend30MinReminder.map(u => u.phone);
      await FormSubmission.updateMany(
        { phone: { $in: phoneList } },
        {
          $set: {
            reminder30MinSent: true,
            reminder30MinSentAt: new Date()
          }
        }
      );

      console.log('[Cron] Successfully sent 30-min reminders and updated', phoneList.length, 'records');
    } else {
      console.error('[Cron] Failed to send bulk 30-min reminder SMS:', smsResult.error);
    }

    return res.status(200).json({
      success: true,
      message: smsResult.success ? '30-min reminders sent successfully' : 'Failed to send some 30-min reminders',
      stats: {
        found: usersToSend30MinReminder.length,
        sent: smsResult.sentCount,
        failed: smsResult.failedCount
      },
      error: smsResult.error || null
    });

  } catch (error) {
    console.error('[Cron] Error in send-30min-reminders:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

/**
 * GET /api/cron/health
 * Health check endpoint for cron monitoring
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Cron service is healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
