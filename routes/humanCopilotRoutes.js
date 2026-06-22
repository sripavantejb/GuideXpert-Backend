'use strict';

const express = require('express');
const ctrl = require('../controllers/humanCopilotController');
const { requireHumanCopilot } = require('../middleware/requireHumanCopilot');

const router = express.Router();

router.use(requireHumanCopilot);

router.get('/queue', ctrl.listQueue);
router.get('/notifications', ctrl.getNotifications);
router.get('/metrics', ctrl.getMetrics);
router.get('/analytics/overview', ctrl.getAnalyticsOverview);
router.get('/analytics/workloads', ctrl.getAnalyticsWorkloads);
router.get('/analytics/ai-usage', ctrl.getAnalyticsAiUsage);
router.get('/analytics/escalations', ctrl.getAnalyticsEscalations);
router.get('/analytics/delivery', ctrl.getAnalyticsDelivery);
router.get('/analytics/lead-quality', ctrl.getAnalyticsLeadQuality);
router.get('/learning/overview', ctrl.getLearningOverview);
router.get('/learning/edit-patterns', ctrl.getLearningEditPatterns);
router.get('/learning/topics', ctrl.getLearningTopics);
router.get('/learning/examples', ctrl.getLearningExamples);
router.get('/followups/recommended', ctrl.getRecommendedFollowups);
router.get('/followups/:handoffId', ctrl.getFollowupForHandoff);
router.post('/followups/:handoffId/send', ctrl.sendFollowup);
router.post('/followups/:handoffId/skip', ctrl.skipFollowup);
router.get('/agents', ctrl.listAgents);
router.post('/agents/status', ctrl.updateAgentStatus);
router.post('/agents/settings', ctrl.updateAgentSettings);
router.get('/routing', ctrl.getRouting);
router.get('/handoffs/:id', ctrl.getHandoffDetail);
router.post('/handoffs/:id/auto-assign', ctrl.autoAssignHandoff);
router.post('/handoffs/:id/assign', ctrl.assignHandoff);
router.post('/handoffs/:id/notes', ctrl.addNote);
router.post('/handoffs/:id/suggest-reply', ctrl.suggestReply);
router.post('/handoffs/:id/reply', ctrl.reply);
router.post('/handoffs/:id/retry-reply', ctrl.retryReply);
router.post('/handoffs/:id/resolve', ctrl.resolve);

module.exports = router;
