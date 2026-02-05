const express = require('express');
const router = express.Router();
const { login, getAdminLeads, getLeadById, updateLeadNotes, getAdminStats, exportLeads, getSlotConfigs, getSlotsForDate, updateSlotConfig, getSlotBookingCounts, getSlotOverrides, setSlotOverride } = require('../controllers/adminController');
const { getMeetingAttendance } = require('../controllers/meetingController');
const requireAdmin = require('../middleware/requireAdmin');

router.post('/login', login);
router.get('/leads', requireAdmin, getAdminLeads);
router.get('/leads/:id', requireAdmin, getLeadById);
router.patch('/leads/:id', requireAdmin, updateLeadNotes);
router.get('/stats', requireAdmin, getAdminStats);
router.get('/leads/export', requireAdmin, exportLeads);
router.get('/slots', requireAdmin, getSlotConfigs);
router.get('/slots/for-date', requireAdmin, getSlotsForDate);
router.get('/slots/booking-counts', requireAdmin, getSlotBookingCounts);
router.get('/slots/overrides', requireAdmin, getSlotOverrides);
router.put('/slots/overrides', requireAdmin, setSlotOverride);
router.put('/slots/:slotId', requireAdmin, updateSlotConfig);
router.get('/meeting-attendance', requireAdmin, getMeetingAttendance);

module.exports = router;
