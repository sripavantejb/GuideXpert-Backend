const express = require('express');
const router = express.Router();
const { login, getAdminLeads, getLeadById, updateLeadNotes, getAdminStats, exportLeads, getSlotConfigs, getSlotsForDate, updateSlotConfig, getSlotBookingCounts, getSlotOverrides, setSlotOverride, getAssessmentSubmissions, getAssessment2Submissions, getAssessment3Submissions, getAssessmentSubmissionById, getAssessment2SubmissionById, getAssessment3SubmissionById, getAssessment4Submissions, getAssessment4SubmissionById, getAssessment5Submissions, getAssessment5SubmissionById, getMissingLeads } = require('../controllers/adminController');
const { getMeetingAttendance } = require('../controllers/meetingController');
const { getTrainingAttendance } = require('../controllers/trainingController');
const { getTrainingFeedback } = require('../controllers/feedbackController');
const { getTrainingFormResponses } = require('../controllers/trainingFormController');
const {
  adminList,
  adminCreate,
  adminGetOne,
  adminUpdate,
  adminDelete,
  adminPublish,
  adminUnpublish,
  adminAnalytics,
} = require('../controllers/announcementController');
const requireAdmin = require('../middleware/requireAdmin');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const { listAdmins, createAdmin, deleteAdmin, resetAdminPassword, changeMyPassword } = require('../controllers/adminUserController');
const { adminListProgress, adminProgressStats, adminProgressDetail, adminAssessmentDetail, adminUpdateProgress, adminProgressExport } = require('../controllers/webinarProgressController');

router.post('/login', login);
router.get('/admins', requireAdmin, requireSuperAdmin, listAdmins);
router.post('/admins', requireAdmin, requireSuperAdmin, createAdmin);
router.delete('/admins/:id', requireAdmin, requireSuperAdmin, deleteAdmin);
router.patch('/admins/:id/password', requireAdmin, requireSuperAdmin, resetAdminPassword);
router.patch('/me/password', requireAdmin, changeMyPassword);
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
router.get('/training-feedback', requireAdmin, getTrainingFeedback);
router.get('/training-form-responses', requireAdmin, getTrainingFormResponses);
router.get('/assessment-submissions', requireAdmin, getAssessmentSubmissions);
router.get('/assessment-submissions/:id', requireAdmin, getAssessmentSubmissionById);
router.get('/assessment-2-submissions', requireAdmin, getAssessment2Submissions);
router.get('/assessment-2-submissions/:id', requireAdmin, getAssessment2SubmissionById);
router.get('/assessment-3-submissions', requireAdmin, getAssessment3Submissions);
router.get('/assessment-3-submissions/:id', requireAdmin, getAssessment3SubmissionById);
router.get('/assessment-4-submissions', requireAdmin, getAssessment4Submissions);
router.get('/assessment-4-submissions/:id', requireAdmin, getAssessment4SubmissionById);
router.get('/assessment-5-submissions', requireAdmin, getAssessment5Submissions);
router.get('/assessment-5-submissions/:id', requireAdmin, getAssessment5SubmissionById);
router.get('/missing-leads', requireAdmin, getMissingLeads);
router.get('/announcements', requireAdmin, adminList);
router.post('/announcements', requireAdmin, adminCreate);
router.get('/announcements/:id/analytics', requireAdmin, adminAnalytics);
router.get('/announcements/:id', requireAdmin, adminGetOne);
router.patch('/announcements/:id', requireAdmin, adminUpdate);
router.delete('/announcements/:id', requireAdmin, adminDelete);
router.post('/announcements/:id/publish', requireAdmin, adminPublish);
router.post('/announcements/:id/unpublish', requireAdmin, adminUnpublish);

// Webinar Progress
router.get('/webinar-progress/stats', requireAdmin, adminProgressStats);
router.get('/webinar-progress/export', requireAdmin, adminProgressExport);
router.patch('/webinar-progress/:phone', requireAdmin, adminUpdateProgress);
router.get('/webinar-progress/:phone/assessments', requireAdmin, adminAssessmentDetail);
router.get('/webinar-progress/:phone', requireAdmin, adminProgressDetail);
router.get('/webinar-progress', requireAdmin, adminListProgress);

module.exports = router;
