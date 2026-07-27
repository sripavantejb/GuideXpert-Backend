const express = require('express');
const router = express.Router();
const {
  getPredictedColleges,
  searchCollegeComparisonOptions,
  compareColleges,
  chatCollegeComparison,
} = require('../controllers/collegePredictorController');

router.post('/colleges', getPredictedColleges);
router.get('/comparison/options', searchCollegeComparisonOptions);
router.post('/comparison', compareColleges);
router.post('/comparison/chat', chatCollegeComparison);

module.exports = router;
