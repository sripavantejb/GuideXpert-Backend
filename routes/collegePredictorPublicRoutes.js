const express = require('express');
const router = express.Router();
const { getPredictedColleges } = require('../controllers/collegePredictorController');

router.post('/colleges', getPredictedColleges);

module.exports = router;
