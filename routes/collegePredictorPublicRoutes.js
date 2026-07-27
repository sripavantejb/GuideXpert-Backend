const express = require('express');
const router = express.Router();
const {
  getPredictedColleges,
  searchCollegeComparisonOptions,
  compareColleges,
} = require('../controllers/collegePredictorController');

router.post('/colleges', getPredictedColleges);
router.get('/comparison/options', searchCollegeComparisonOptions);
router.post('/comparison', compareColleges);

module.exports = router;
