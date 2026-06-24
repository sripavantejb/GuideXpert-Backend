const express = require('express');
const router = express.Router();
const { checkCollegeDostFormStatus, submitCollegeDostForm } = require('../controllers/collegeDostFormController');

router.get('/status', checkCollegeDostFormStatus);
router.post('/submit', submitCollegeDostForm);

module.exports = router;
