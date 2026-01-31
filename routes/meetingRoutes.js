const express = require('express');
const router = express.Router();
const { registerForMeeting } = require('../controllers/meetingController');

router.post('/register', registerForMeeting);

module.exports = router;
