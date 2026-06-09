const express = require('express');
const ctrl = require('../controllers/aiCallsAdminController');

const router = express.Router();

router.get('/settings', ctrl.getSettings);
router.patch('/settings', ctrl.patchSettings);
router.get('/analytics', ctrl.getAnalytics);
router.get('/queue', ctrl.getQueue);
router.post('/test/preview', ctrl.previewTestCall);
router.post('/test', ctrl.createTestCall);
router.post('/bulk-schedule', ctrl.bulkSchedule);
router.post('/bulk-schedule-all-pending', ctrl.bulkScheduleAllPending);
router.get('/summary/stats', ctrl.getIitAiCallSummaryStats);
router.get('/summary', ctrl.listIitAiCallSummaries);
router.get('/summary/:id', ctrl.getIitAiCallSummary);
router.get('/', ctrl.listReminders);
router.get('/:id/preview-payload', ctrl.getPreviewPayload);
router.get('/:id', ctrl.getReminder);
router.patch('/:id', ctrl.patchReminder);
router.post('/:id/schedule', ctrl.scheduleReminder);
router.post('/:id/reject', ctrl.rejectReminder);
router.post('/:id/retry', ctrl.retryReminder);
router.patch('/:id/reschedule', ctrl.rescheduleReminder);
router.patch('/:id/cancel', ctrl.cancelReminder);
router.delete('/:id', ctrl.deleteReminder);

module.exports = router;
