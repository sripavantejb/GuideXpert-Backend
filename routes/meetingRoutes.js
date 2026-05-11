const express = require('express');
const router = express.Router();
const {
  registerForMeeting,
  meetingHealth,
  demoMeetEligibility,
  orientationMeetEligibility,
  registerForOrientationMeeting,
} = require('../controllers/meetingController');

router.get('/health', meetingHealth);
router.post('/demo-eligibility', demoMeetEligibility);
router.post('/orientation-eligibility', orientationMeetEligibility);
router.post('/orientation-register', registerForOrientationMeeting);
router.post('/register', registerForMeeting);

module.exports = router;
