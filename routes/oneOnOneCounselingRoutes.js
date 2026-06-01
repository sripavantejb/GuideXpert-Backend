const express = require('express');
const router = express.Router();
const { submitOneOnOneCounselingLead } = require('../controllers/oneOnOneCounselingController');

router.post('/', submitOneOnOneCounselingLead);

module.exports = router;
