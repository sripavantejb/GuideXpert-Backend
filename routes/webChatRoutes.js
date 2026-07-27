'use strict';

const express = require('express');
const { postWebChatMessage, postWebChatReset } = require('../controllers/webChatController');

const router = express.Router();

router.post('/message', postWebChatMessage);
router.post('/reset', postWebChatReset);

module.exports = router;
