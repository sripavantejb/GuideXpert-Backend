const express = require('express');
const router = express.Router();
const { submitCourseFit } = require('../controllers/careerDnaCourseFitController');

router.post('/submit', submitCourseFit);

module.exports = router;
