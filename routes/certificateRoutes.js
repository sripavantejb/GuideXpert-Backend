const express = require('express');
const router = express.Router();
const { createCertificate, getCertificateById } = require('../controllers/certificateController');

router.post('/', createCertificate);
router.get('/:id', getCertificateById);

module.exports = router;
