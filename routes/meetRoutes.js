const express = require('express');
const router = express.Router();
const meetController = require('../controllers/meetController');
const requireAdmin = require('../middleware/requireAdmin');

// Public routes - for users registering for meet
router.post('/send-otp', meetController.sendOtp);
router.post('/verify-otp', meetController.verifyOtpAndRegister);
router.post('/mark-joined/:mobile', meetController.markJoined);
router.post('/cleanup', meetController.cleanupMobile);

// Protected admin routes
router.get('/entries', requireAdmin, meetController.getMeetEntries);
router.get('/stats', requireAdmin, meetController.getMeetStats);

module.exports = router;
