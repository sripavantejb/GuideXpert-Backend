const express = require('express');
const { getRankPredictorExams, predictRank } = require('../controllers/rankPredictorController');

const router = express.Router();

router.get('/exams', getRankPredictorExams);
router.post('/predict', predictRank);

module.exports = router;
