const express = require('express');
const router = express.Router();
const { syncProgress, getProgress } = require('../controllers/webinarProgressController');

router.post('/sync', syncProgress);
router.get('/', getProgress);

module.exports = router;
