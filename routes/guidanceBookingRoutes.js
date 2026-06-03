const express = require('express');
const router = express.Router();
const {
  checkMobile,
  getActiveSlots,
  bookSlot,
} = require('../controllers/guidanceBookingPublicController');

router.post('/check-mobile', checkMobile);
router.get('/active-slots', getActiveSlots);
router.post('/book-slot', bookSlot);

module.exports = router;
