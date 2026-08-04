const express = require('express');
const { attachRouteIndex } = require('../utils/routeIndex');
const { getRankPredictorExams, predictRank } = require('../controllers/rankPredictorController');

const router = express.Router();

attachRouteIndex(router, {
  name: 'rank-predictor',
  routes: [
    { method: 'GET', path: '/exams' },
    { method: 'POST', path: '/predict' },
  ],
});
router.get('/exams', getRankPredictorExams);
router.post('/predict', predictRank);

module.exports = router;
