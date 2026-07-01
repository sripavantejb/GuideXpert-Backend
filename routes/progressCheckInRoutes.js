const express = require('express');
const router = express.Router();
const {
  submitProgressCheckIn,
  getProgressCheckInStatus,
} = require('../controllers/progressCheckInController');

router.get('/check/:phone', getProgressCheckInStatus);
router.post('/', submitProgressCheckIn);

module.exports = router;
