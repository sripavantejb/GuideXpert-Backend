const express = require('express');
const router = express.Router();
const { submitCollegeDostForm } = require('../controllers/collegeDostFormController');

router.post('/submit', submitCollegeDostForm);

module.exports = router;
