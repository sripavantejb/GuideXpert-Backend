const express = require('express');
const router = express.Router();
const requireCounsellor = require('../middleware/requireCounsellor');
const {
  counsellorList,
  counsellorGetOne,
  counsellorMarkRead,
  counsellorMarkAllRead,
} = require('../controllers/announcementController');

router.use(requireCounsellor);
router.get('/', counsellorList);
router.post('/read-all', counsellorMarkAllRead);
router.get('/:id', counsellorGetOne);
router.post('/:id/read', counsellorMarkRead);

module.exports = router;
