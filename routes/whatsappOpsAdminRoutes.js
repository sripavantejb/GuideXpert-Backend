const express = require('express');
const router = express.Router();
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const ctrl = require('../controllers/whatsappOpsAdminController');

router.get('/meta', ctrl.getOpsMeta);
router.get('/summary', ctrl.getSummary);
router.get('/calendar/month', ctrl.getCalendarMonthOverview);
router.get('/calendar/day', ctrl.getCalendarDayOverview);
router.get('/cron-runs', ctrl.listCronRuns);
router.get('/cron-runs/:id', ctrl.getCronRunDetail);
router.get('/messages', ctrl.listMessages);
router.get('/messages/:id/timeline', ctrl.getMessageTimeline);
router.get('/retries/analytics', ctrl.retriesAnalytics);
router.get('/retries/preview', ctrl.previewRetries);
router.post('/retries/execute', requireSuperAdmin, ctrl.executeRetries);
router.get('/retry-groups/:id', ctrl.getRetryGroupDetail);
router.get('/attempt-analytics', ctrl.getAttemptAnalytics);
router.get('/webhooks', ctrl.listWebhooks);
router.get('/failures', ctrl.failuresRollup);
router.get('/export', ctrl.exportCsv);
router.post('/actions/resend', requireSuperAdmin, ctrl.manualResend);
router.post('/actions/retry-batch', requireSuperAdmin, ctrl.triggerRetryBatch);

module.exports = router;
