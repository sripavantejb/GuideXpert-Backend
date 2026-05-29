const express = require('express');
const ctrl = require('../controllers/whatsappChatAdminController');

const router = express.Router();

router.get('/metrics', ctrl.getMetrics);
router.get('/handoffs', ctrl.listHandoffs);
router.get('/conversations/:conversationId/transcript', ctrl.getTranscript);
router.post('/handoffs/:id/claim', ctrl.claimHandoff);
router.post('/handoffs/:id/resolve', ctrl.resolveHandoff);
router.post('/handoffs/:id/reply', ctrl.replyHandoff);
router.post('/maintenance/run', ctrl.runMaintenance);

module.exports = router;
