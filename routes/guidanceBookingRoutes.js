const express = require('express');
const router = express.Router();
const { attachRouteIndex } = require('../utils/routeIndex');
const {
  checkMobile,
  getActiveSlots,
  bookSlot,
  meetJoin,
} = require('../controllers/guidanceBookingPublicController');

attachRouteIndex(router, {
  name: 'guidance-booking',
  routes: [
    { method: 'POST', path: '/check-mobile' },
    { method: 'GET', path: '/active-slots' },
    { method: 'POST', path: '/book-slot' },
    { method: 'POST', path: '/meet-join' },
  ],
});
router.post('/check-mobile', checkMobile);
router.get('/active-slots', getActiveSlots);
router.post('/book-slot', bookSlot);
router.post('/meet-join', meetJoin);

module.exports = router;
