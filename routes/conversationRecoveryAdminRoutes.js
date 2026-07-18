'use strict';

const express = require('express');
const router = express.Router();
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const ctrl = require('../controllers/conversationRecoveryAdminController');

router.get('/overview', ctrl.getOverview);
router.get('/funnel', ctrl.getFunnel);
router.get('/daily', ctrl.getDaily);
router.get('/trends', ctrl.getTrends);
router.get('/by-phase', ctrl.getByPhase);
router.get('/delivery-status', ctrl.getDeliveryStatus);
router.get('/failure-reasons', ctrl.getFailureReasons);
router.get('/students', ctrl.listStudents);
router.get('/students/:id', ctrl.getStudentDetail);
router.get('/students/:id/timeline', ctrl.getStudentTimeline);

router.post('/students/:id/resend', requireSuperAdmin, ctrl.resend);
router.post('/students/:id/pause', requireSuperAdmin, ctrl.pause);
router.post('/students/:id/resume', requireSuperAdmin, ctrl.resume);
router.post('/students/:id/stop', requireSuperAdmin, ctrl.stop);
router.post('/students/:id/assign-human', requireSuperAdmin, ctrl.assignHuman);
router.post('/bulk', requireSuperAdmin, ctrl.bulkAction);

router.get('/config', ctrl.getConfig);
router.put('/config', requireSuperAdmin, ctrl.putConfig);

router.get('/health', ctrl.getHealth);
router.get('/alerts', ctrl.getAlerts);
router.post('/alerts/:id/acknowledge', requireSuperAdmin, ctrl.acknowledgeAlert);
router.post('/alerts/:id/resolve', requireSuperAdmin, ctrl.resolveAlertHandler);
router.get('/audit-logs', ctrl.getAuditLogs);
router.get('/campaign-performance', ctrl.getCampaignPerformance);
router.post('/message-preview', ctrl.previewMessage);
router.get('/system-metrics', ctrl.getSystemMetrics);

module.exports = router;
