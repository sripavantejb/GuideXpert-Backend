const express = require('express');
const router = express.Router();
const { submitNatCampaignForm } = require('../controllers/natCampaignController');

router.post('/submit', submitNatCampaignForm);

module.exports = router;
