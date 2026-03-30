const express = require('express');
const router = express.Router();
const { registerForMeeting, meetingHealth, demoMeetEligibility } = require('../controllers/meetingController');

router.get('/health', meetingHealth);
router.post('/demo-eligibility', demoMeetEligibility);
router.post('/register', registerForMeeting);

module.exports = router;
