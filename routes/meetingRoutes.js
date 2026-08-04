const express = require('express');
const router = express.Router();
const { attachRouteIndex } = require('../utils/routeIndex');
const {
  registerForMeeting,
  meetingHealth,
  demoMeetEligibility,
  orientationMeetEligibility,
  registerForOrientationMeeting,
} = require('../controllers/meetingController');

attachRouteIndex(router, {
  name: 'meeting',
  routes: [
    { method: 'GET', path: '/health' },
    { method: 'POST', path: '/demo-eligibility' },
    { method: 'POST', path: '/orientation-eligibility' },
    { method: 'POST', path: '/orientation-register' },
    { method: 'POST', path: '/register' },
  ],
});
router.get('/health', meetingHealth);
router.post('/demo-eligibility', demoMeetEligibility);
router.post('/orientation-eligibility', orientationMeetEligibility);
router.post('/orientation-register', registerForOrientationMeeting);
router.post('/register', registerForMeeting);

module.exports = router;
