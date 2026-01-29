const express = require('express');
const router = express.Router();
const { login, getAdminLeads, getAdminStats, exportLeads } = require('../controllers/adminController');
const requireAdmin = require('../middleware/requireAdmin');

router.post('/login', login);
router.get('/leads', requireAdmin, getAdminLeads);
router.get('/stats', requireAdmin, getAdminStats);
router.get('/leads/export', requireAdmin, exportLeads);

module.exports = router;
