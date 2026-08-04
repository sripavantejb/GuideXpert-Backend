const express = require('express');
const router = express.Router();
const { attachRouteIndex } = require('../utils/routeIndex');
const { registerForTraining } = require('../controllers/trainingController');

attachRouteIndex(router, {
  name: 'training',
  routes: [{ method: 'POST', path: '/register' }],
});
router.post('/register', registerForTraining);

module.exports = router;
