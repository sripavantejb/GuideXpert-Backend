const express = require('express');
const requireBda = require('../middleware/requireBda');
const { login, me, logout } = require('../controllers/bdaAuthController');
const {
  getDashboardStats,
  listLeads,
  getLead,
  updateLead,
  getLeadHistory,
  getNotifications,
  markNotificationsRead,
} = require('../controllers/bdaPortalController');

const router = express.Router();
const { attachRouteIndex } = require('../utils/routeIndex');

attachRouteIndex(router, {
  name: 'bda',
  routes: [
    { method: 'POST', path: '/login' },
    { method: 'GET', path: '/me', note: 'auth required' },
    { method: 'POST', path: '/logout', note: 'auth required' },
    { method: 'GET', path: '/dashboard/stats', note: 'auth required' },
    { method: 'GET', path: '/notifications', note: 'auth required' },
    { method: 'GET', path: '/leads', note: 'auth required' },
  ],
});

router.post('/login', login);
router.get('/me', requireBda, me);
router.post('/logout', requireBda, logout);

router.get('/dashboard/stats', requireBda, getDashboardStats);
router.get('/notifications', requireBda, getNotifications);
router.post('/notifications/mark-read', requireBda, markNotificationsRead);
router.get('/leads', requireBda, listLeads);
router.get('/leads/:id', requireBda, getLead);
router.patch('/leads/:id/update', requireBda, updateLead);
router.get('/leads/:id/history', requireBda, getLeadHistory);

module.exports = router;
