const express = require('express');
const router = express.Router();
const { registerForIitMeetHindi, iitMeetHindiHealth } = require('../controllers/iitMeetController');

router.get('/health', iitMeetHindiHealth);
router.post('/register', registerForIitMeetHindi);

module.exports = router;
