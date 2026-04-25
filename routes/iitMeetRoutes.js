const express = require('express');
const router = express.Router();
const { registerForIitMeet, iitMeetHealth } = require('../controllers/iitMeetController');

router.get('/health', iitMeetHealth);
router.post('/register', registerForIitMeet);

module.exports = router;
