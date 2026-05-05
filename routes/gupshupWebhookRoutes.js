const express = require('express');
const router = express.Router();
const { ingestGupshupWebhook } = require('../controllers/gupshupWebhookController');

router.post('/', ingestGupshupWebhook);

module.exports = router;
