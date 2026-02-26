const express = require('express');
const router = express.Router();
const requireCounsellor = require('../middleware/requireCounsellor');
const {
  counsellorList,
  counsellorGetOne,
  counsellorMarkRead,
  counsellorMarkAllRead,
  counsellorFeed,
  counsellorReact,
  counsellorAcknowledge,
  counsellorEngagement,
} = require('../controllers/announcementController');

router.use(requireCounsellor);
router.get('/feed', counsellorFeed);
router.get('/', counsellorList);
router.post('/read-all', counsellorMarkAllRead);
router.post('/:id/react', counsellorReact);
router.post('/:id/acknowledge', counsellorAcknowledge);
router.get('/:id/engagement', counsellorEngagement);
router.get('/:id', counsellorGetOne);
router.post('/:id/read', counsellorMarkRead);

module.exports = router;
