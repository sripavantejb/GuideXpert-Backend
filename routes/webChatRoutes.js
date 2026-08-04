'use strict';

const express = require('express');
const { attachRouteIndex } = require('../utils/routeIndex');
const { postWebChatMessage, postWebChatReset } = require('../controllers/webChatController');

const router = express.Router();

attachRouteIndex(router, {
  name: 'web-chat',
  routes: [
    { method: 'POST', path: '/message' },
    { method: 'POST', path: '/reset' },
  ],
});
router.post('/message', postWebChatMessage);
router.post('/reset', postWebChatReset);

module.exports = router;
