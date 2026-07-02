const express = require('express');
const router = express.Router();
const {
  getIitainSessionFeedbackCounselors,
  submitIitainSessionFeedback,
} = require('../controllers/iitainSessionFeedbackController');

router.get('/counselors', getIitainSessionFeedbackCounselors);
router.post('/', submitIitainSessionFeedback);

module.exports = router;
