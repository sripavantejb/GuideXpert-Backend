const express = require('express');
const router = express.Router();
const { createCertificate, getCertificateById, migrateToShortId } = require('../controllers/certificateController');

router.post('/migrate-short-id', migrateToShortId);
router.post('/', createCertificate);
router.get('/:id', getCertificateById);

module.exports = router;
