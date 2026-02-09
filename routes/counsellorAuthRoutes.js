const express = require('express');
const router = express.Router();
const { login } = require('../controllers/counsellorAuthController');

router.post('/login', login);

module.exports = router;
