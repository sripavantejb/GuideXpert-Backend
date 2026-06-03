const express = require('express');
const router = express.Router();
const requireOneOnOneCounselor = require('../middleware/requireOneOnOneCounselor');
const {
  login,
  me,
  listMySlots,
  toggleMySlot,
  listMyBookings,
  patchBookingStatus,
  patchBookingRemarks,
  updateMyProfile,
  getCounselorStats,
} = require('../controllers/oneOnOneCounselorPortalController');

router.post('/login', login);
router.get('/me', requireOneOnOneCounselor, me);
router.get('/stats', requireOneOnOneCounselor, getCounselorStats);
router.patch('/profile', requireOneOnOneCounselor, updateMyProfile);
router.get('/slots', requireOneOnOneCounselor, listMySlots);
router.patch('/slots/:id/toggle', requireOneOnOneCounselor, toggleMySlot);
router.get('/bookings', requireOneOnOneCounselor, listMyBookings);
router.patch('/bookings/:id/status', requireOneOnOneCounselor, patchBookingStatus);
router.patch('/bookings/:id/remarks', requireOneOnOneCounselor, patchBookingRemarks);

module.exports = router;
