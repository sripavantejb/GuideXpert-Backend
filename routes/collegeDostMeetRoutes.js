const express = require('express');
const router = express.Router();
const { registerForCollegeDostMeet } = require('../controllers/collegeDostMeetController');

router.post('/register', registerForCollegeDostMeet);

module.exports = router;
