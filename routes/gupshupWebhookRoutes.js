const express = require('express');
const router = express.Router();
const { ingestGupshupWebhook } = require('../controllers/gupshupWebhookController');

router.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Gupshup webhook route reachable',
    route: '/webhook/gupshup'
  });
});

router.post('/', ingestGupshupWebhook);

module.exports = router;
