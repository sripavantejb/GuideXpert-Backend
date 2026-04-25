const express = require('express');
const router = express.Router();
const { submitCounsellorSupportRequest } = require('../controllers/counsellorSupportController');

router.post('/', submitCounsellorSupportRequest);

module.exports = router;
