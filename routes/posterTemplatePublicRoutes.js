const express = require('express');
const router = express.Router();
const { getPosterByRoute, verifyPosterActivation } = require('../controllers/posterTemplateController');

router.get('/by-route', getPosterByRoute);
router.post('/verify-activation', verifyPosterActivation);

module.exports = router;
