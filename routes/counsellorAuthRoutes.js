const express = require('express');
const router = express.Router();
const { login, loginWithPhone } = require('../controllers/counsellorAuthController');

router.post('/login', login);
router.post('/login-with-phone', loginWithPhone);

module.exports = router;
