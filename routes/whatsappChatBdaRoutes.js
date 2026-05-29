const express = require('express');
const requireBda = require('../middleware/requireBda');
const ctrl = require('../controllers/whatsappChatBdaController');

const router = express.Router();

router.get('/handoffs', requireBda, ctrl.listHandoffs);
router.post('/handoffs/:id/reply', requireBda, ctrl.replyHandoff);
router.post('/handoffs/:id/resolve', requireBda, ctrl.resolveHandoff);

module.exports = router;
