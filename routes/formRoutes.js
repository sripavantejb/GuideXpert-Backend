const express = require('express');
const router = express.Router();
const { sendOtp, verifyOtp, getDemoSlots, submitApplication, saveStep1, saveStep2, saveStep3, checkRegistrationStatus, savePostRegistrationData, getAllSubmissions } = require('../controllers/formController');

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.get('/demo-slots', getDemoSlots);
router.post('/submit-application', submitApplication);
router.post('/save-step1', saveStep1);
router.post('/save-step2', saveStep2);
router.post('/save-step3', saveStep3);
router.get('/check-registration/:phone', checkRegistrationStatus);
router.post('/save-post-registration', savePostRegistrationData);
router.get('/submissions', getAllSubmissions); // Diagnostic endpoint

module.exports = router;



