const express = require('express');
const router = express.Router();
const { attachRouteIndex } = require('../utils/routeIndex');
const { submitTrainingFeedback } = require('../controllers/feedbackController');

attachRouteIndex(router, {
  name: 'feedback',
  routes: [{ method: 'POST', path: '/', note: 'submit training feedback' }],
});
router.post('/', submitTrainingFeedback);

module.exports = router;
