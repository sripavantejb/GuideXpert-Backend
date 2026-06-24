const express = require('express');
const router = express.Router();
const { checkCollegeDostMeetStatus, registerForCollegeDostMeet } = require('../controllers/collegeDostMeetController');

router.get('/status', checkCollegeDostMeetStatus);
router.post('/register', registerForCollegeDostMeet);

module.exports = router;
