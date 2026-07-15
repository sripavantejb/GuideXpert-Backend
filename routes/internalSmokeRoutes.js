'use strict';

const express = require('express');
const { requireInternalSmoke } = require('../middleware/requireInternalSmoke');
const { sendSmokeMessage } = require('../controllers/internalSmokeController');
const { isInternalSmokeEndpointEnabled } = require('../utils/internalSmokeSecret');

function createInternalSmokeRouter() {
  const router = express.Router();
  router.use(requireInternalSmoke);
  router.post('/send', sendSmokeMessage);
  return router;
}

module.exports = {
  createInternalSmokeRouter,
  isInternalSmokeEndpointEnabled,
};
