const express = require('express');
const router = express.Router();
const { attachRouteIndex } = require('../utils/routeIndex');
const { submitIitFirstForm } = require('../controllers/iitFirstFormController');

attachRouteIndex(router, {
  name: 'iit-first-form',
  routes: [{ method: 'POST', path: '/submit' }],
});
router.post('/submit', submitIitFirstForm);

module.exports = router;
