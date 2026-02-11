const express = require('express');
const router = express.Router();
const { login, getAdminLeads, getLeadById, updateLeadNotes, getAdminStats, exportLeads, getSlotConfigs, getSlotsForDate, updateSlotConfig, getSlotBookingCounts, getSlotOverrides, setSlotOverride, getAssessmentSubmissions, getAssessment2Submissions, getAssessment3Submissions, getAssessmentSubmissionById, getAssessment2SubmissionById, getAssessment3SubmissionById } = require('../controllers/adminController');
const { getMeetingAttendance } = require('../controllers/meetingController');
const { getTrainingAttendance } = require('../controllers/trainingController');
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
router.get('/training-attendance', requireAdmin, getTrainingAttendance);
router.get('/assessment-submissions', requireAdmin, getAssessmentSubmissions);
router.get('/assessment-submissions/:id', requireAdmin, getAssessmentSubmissionById);
router.get('/assessment-2-submissions', requireAdmin, getAssessment2Submissions);
router.get('/assessment-2-submissions/:id', requireAdmin, getAssessment2SubmissionById);
router.get('/assessment-3-submissions', requireAdmin, getAssessment3Submissions);
router.get('/assessment-3-submissions/:id', requireAdmin, getAssessment3SubmissionById);

module.exports = router;
