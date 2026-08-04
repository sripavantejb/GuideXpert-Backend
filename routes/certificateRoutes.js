const express = require('express');
const router = express.Router();
const { attachRouteIndex } = require('../utils/routeIndex');
const { createCertificate, getCertificateById, migrateToShortId } = require('../controllers/certificateController');

// GET / index must be registered before /:id
attachRouteIndex(router, {
  name: 'certificate',
  routes: [
    { method: 'POST', path: '/migrate-short-id' },
    { method: 'POST', path: '/' },
    { method: 'GET', path: '/:id' },
  ],
});
router.post('/migrate-short-id', migrateToShortId);
router.post('/', createCertificate);
router.get('/:id', getCertificateById);

module.exports = router;
