const express = require('express');
const router = express.Router();
const { syncProgress, getProgress, recordCertificateDownload } = require('../controllers/webinarProgressController');

router.post('/sync', syncProgress);
router.post('/certificate-downloaded', recordCertificateDownload);
router.get('/', getProgress);

module.exports = router;
