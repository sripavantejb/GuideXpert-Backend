/**
 * whatsaapBotTej — Gupshup inbound webhook for the simple WhatsApp AI bot.
 * Configure in the Gupshup console: POST https://<backend-domain>/webhook/gupshup-simple
 * Always answers 200 so Gupshup does not retry-storm; errors are logged only.
 */
const express = require('express');
const router = express.Router();
const { handleInboundWebhook } = require('./simpleChatbotService');

router.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'whatsaapBotTej webhook reachable',
    route: '/webhook/gupshup-simple',
  });
});

router.post('/', async (req, res) => {
  try {
    const result = await handleInboundWebhook(req.body || {});
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[whatsaapBotTej] webhook error:', err);
    res.status(200).json({ success: false, message: 'internal error (logged)' });
  }
});

module.exports = router;
