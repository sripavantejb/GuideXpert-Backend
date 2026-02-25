const express = require('express');
const router = express.Router();
const { submitCareerDna } = require('../controllers/careerDnaCourseFitController');

router.post('/submit', submitCareerDna);

module.exports = router;
