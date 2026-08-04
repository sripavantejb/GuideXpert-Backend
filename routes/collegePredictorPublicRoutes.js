const express = require('express');
const router = express.Router();
const { attachRouteIndex } = require('../utils/routeIndex');
const {
  getPredictedColleges,
  searchCollegeComparisonOptions,
  compareColleges,
  chatCollegeComparison,
} = require('../controllers/collegePredictorController');

attachRouteIndex(router, {
  name: 'college-predictor',
  routes: [
    { method: 'POST', path: '/colleges' },
    { method: 'GET', path: '/comparison/options', note: 'query: q' },
    { method: 'POST', path: '/comparison' },
    { method: 'POST', path: '/comparison/chat' },
  ],
});
router.post('/colleges', getPredictedColleges);
router.get('/comparison/options', searchCollegeComparisonOptions);
router.post('/comparison', compareColleges);
router.post('/comparison/chat', chatCollegeComparison);

module.exports = router;
