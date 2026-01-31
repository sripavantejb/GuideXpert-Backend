const express = require('express');
const router = express.Router();
const { registerForMeeting, meetingHealth } = require('../controllers/meetingController');

router.get('/health', meetingHealth);
router.post('/register', registerForMeeting);

module.exports = router;
