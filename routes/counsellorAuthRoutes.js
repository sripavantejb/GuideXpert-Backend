const express = require('express');
const router = express.Router();
const { login, loginWithPhone, configStatus } = require('../controllers/counsellorAuthController');

router.get('/config-status', configStatus);
router.post('/login', login);
router.post('/login-with-phone', loginWithPhone);

module.exports = router;
