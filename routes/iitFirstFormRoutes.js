const express = require('express');
const router = express.Router();
const { submitIitFirstForm } = require('../controllers/iitFirstFormController');

router.post('/submit', submitIitFirstForm);

module.exports = router;
