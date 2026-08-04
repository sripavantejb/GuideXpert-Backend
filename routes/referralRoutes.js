const express = require('express');
const router = express.Router();
const { attachRouteIndex } = require('../utils/routeIndex');
const { sendOtp, verifyOtp } = require('../controllers/referralController');

attachRouteIndex(router, {
  name: 'referral',
  routes: [
    { method: 'POST', path: '/send-otp' },
    { method: 'POST', path: '/verify-otp' },
  ],
});
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);

module.exports = router;
