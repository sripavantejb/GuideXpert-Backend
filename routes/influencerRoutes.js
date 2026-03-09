const express = require('express');
const router = express.Router();
const requireAdmin = require('../middleware/requireAdmin');
const {
  createInfluencerLink,
  listInfluencerLinks,
  deleteInfluencerLink,
  updateInfluencerLink,
  getInfluencerAnalytics,
  getInfluencerTrend
} = require('../controllers/influencerController');

router.post('/influencer-links', requireAdmin, createInfluencerLink);
router.get('/influencer-links', requireAdmin, listInfluencerLinks);
router.patch('/influencer-links/:id', requireAdmin, updateInfluencerLink);
router.delete('/influencer-links/:id', requireAdmin, deleteInfluencerLink);
router.get('/influencer-analytics/trend', requireAdmin, getInfluencerTrend);
router.get('/influencer-analytics', requireAdmin, getInfluencerAnalytics);

module.exports = router;
