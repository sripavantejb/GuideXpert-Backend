const express = require('express');
const router = express.Router();
const { sendOtp, verifyOtp, getDemoSlots, submitApplication } = require('../controllers/formController');

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.get('/demo-slots', getDemoSlots);
router.post('/submit-application', submitApplication);

module.exports = router;



