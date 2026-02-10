const express = require('express');
const router = express.Router();
const requireCounsellor = require('../middleware/requireCounsellor');
const { getPredictedColleges } = require('../controllers/collegePredictorController');

router.use(requireCounsellor);
router.post('/colleges', getPredictedColleges);

module.exports = router;
