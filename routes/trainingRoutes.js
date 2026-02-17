const express = require('express');
const router = express.Router();
const { registerForTraining } = require('../controllers/trainingController');

router.post('/register', registerForTraining);

module.exports = router;
