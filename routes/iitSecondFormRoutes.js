const express = require('express');
const router = express.Router();
const { submitIitSecondForm } = require('../controllers/iitSecondFormController');

router.post('/submit', submitIitSecondForm);

module.exports = router;
