const express = require('express');
const router = express.Router();
const { login, getAdminLeads, getLeadById, updateLeadNotes, updateLeadSlotBooking, updateLeadSlotByPhone, getAdminStats, exportLeads, getSlotConfigs, getSlotsForDate, updateSlotConfig, getSlotBookingCounts, getSlotOverrides, setSlotOverride, getAssessmentSubmissions, getAssessment2Submissions, getAssessment3Submissions, getAssessmentSubmissionById, getAssessment2SubmissionById, getAssessment3SubmissionById, getAssessment4Submissions, getAssessment4SubmissionById, getAssessment5Submissions, getAssessment5SubmissionById, getMissingLeads, getIitCounsellingSubmissions, getIitCounsellingSubmissionById, getIitCounsellingVisitAnalytics, getIitCounsellingUtmAnalytics } = require('../controllers/adminController');
const {
  listIitCounsellingSavedUtmLinks,
  createIitCounsellingSavedUtmLink,
  deleteIitCounsellingSavedUtmLink,
} = require('../controllers/iitCounsellingUtmSavedLinkController');
const {
  listSalesAnalyticsSavedUtmLinks,
  createSalesAnalyticsSavedUtmLink,
  deleteSalesAnalyticsSavedUtmLink,
} = require('../controllers/salesAnalyticsSavedUtmController');
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
const requireOsviAdminToken = require('../middleware/requireOsviAdminToken');
const { listAdmins, createAdmin, deleteAdmin, resetAdminPassword, changeMyPassword } = require('../controllers/adminUserController');
const { adminListProgress, adminProgressStats, adminProgressDetail, adminAssessmentDetail, adminUpdateProgress, adminBulkProgress, adminProgressExport } = require('../controllers/webinarProgressController');
const {
  listPosters,
  getPoster,
  createPoster,
  updatePoster,
  deletePoster,
  publishPoster,
  unpublishPoster,
  setPosterMarketingFeatured,
} = require('../controllers/posterTemplateController');
const {
  getOsviEnabled,
  setOsviEnabled,
  getOsviAbandonedDelayMs,
  setOsviAbandonedDelayMs,
} = require('../utils/appSettings');
const {
  getCertifiedCounsellors,
  getCertifiedCounsellorDetail,
} = require('../controllers/certifiedCounsellorsController');

router.post('/login', login);
router.get('/admins', requireAdmin, requireSuperAdmin, listAdmins);
router.post('/admins', requireAdmin, requireSuperAdmin, createAdmin);
router.delete('/admins/:id', requireAdmin, requireSuperAdmin, deleteAdmin);
router.patch('/admins/:id/password', requireAdmin, requireSuperAdmin, resetAdminPassword);
router.patch('/me/password', requireAdmin, changeMyPassword);
router.get('/leads', requireAdmin, getAdminLeads);
router.get('/leads/:id', requireAdmin, getLeadById);
router.patch('/leads/:id', requireAdmin, updateLeadNotes);
router.patch('/leads/:id/slot', requireAdmin, updateLeadSlotBooking);
router.patch('/leads/slot-by-phone', requireOsviAdminToken, updateLeadSlotByPhone);
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
router.get('/iit-counselling', requireAdmin, getIitCounsellingSubmissions);
router.get('/iit-counselling/visits', requireAdmin, getIitCounsellingVisitAnalytics);
router.get('/iit-counselling/utm-analytics', requireAdmin, getIitCounsellingUtmAnalytics);
// Must be registered before GET /iit-counselling/:id so "saved-utm-links" is never parsed as an ObjectId.
router.get('/iit-counselling/saved-utm-links', requireAdmin, listIitCounsellingSavedUtmLinks);
router.post('/iit-counselling/saved-utm-links', requireAdmin, createIitCounsellingSavedUtmLink);
router.delete('/iit-counselling/saved-utm-links/:id', requireAdmin, deleteIitCounsellingSavedUtmLink);
// Flat aliases (older clients); keep after the /iit-counselling/* literals above.
router.get('/iit-utm-saved-links', requireAdmin, listIitCounsellingSavedUtmLinks);
router.post('/iit-utm-saved-links', requireAdmin, createIitCounsellingSavedUtmLink);
router.delete('/iit-utm-saved-links/:id', requireAdmin, deleteIitCounsellingSavedUtmLink);
// Admin → Analytics page only (not InfluencerLink / influencer tracking).
router.get('/sales-analytics-saved-utm-links', requireAdmin, listSalesAnalyticsSavedUtmLinks);
router.post('/sales-analytics-saved-utm-links', requireAdmin, createSalesAnalyticsSavedUtmLink);
router.delete('/sales-analytics-saved-utm-links/:id', requireAdmin, deleteSalesAnalyticsSavedUtmLink);
router.get('/iit-counselling/:id', requireAdmin, getIitCounsellingSubmissionById);
router.get('/certified-counsellors', requireAdmin, getCertifiedCounsellors);
router.get('/certified-counsellors/:id', requireAdmin, getCertifiedCounsellorDetail);
router.get('/announcements', requireAdmin, adminList);
router.post('/announcements', requireAdmin, adminCreate);
router.get('/announcements/:id/analytics', requireAdmin, adminAnalytics);
router.get('/announcements/:id', requireAdmin, adminGetOne);
router.patch('/announcements/:id', requireAdmin, adminUpdate);
router.delete('/announcements/:id', requireAdmin, adminDelete);
router.post('/announcements/:id/publish', requireAdmin, adminPublish);
router.post('/announcements/:id/unpublish', requireAdmin, adminUnpublish);

router.get('/posters', requireAdmin, listPosters);
router.post('/posters', requireAdmin, createPoster);
router.get('/posters/:id', requireAdmin, getPoster);
router.put('/posters/:id', requireAdmin, updatePoster);
router.delete('/posters/:id', requireAdmin, deletePoster);
router.post('/posters/:id/publish', requireAdmin, publishPoster);
router.post('/posters/:id/unpublish', requireAdmin, unpublishPoster);
router.post('/posters/:id/marketing-featured', requireAdmin, setPosterMarketingFeatured);

// OSVI outbound call history
router.get('/osvi-calls', requireAdmin, async (req, res) => {
  try {
    const FormSubmission = require('../models/FormSubmission');
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    const statusFilter = req.query.status;

    const query = { osviOutboundCallStatus: { $exists: true } };
    if (statusFilter && ['pending', 'processing', 'completed', 'failed', 'cancelled'].includes(statusFilter)) {
      query.osviOutboundCallStatus = statusFilter;
    }

    const [docs, total] = await Promise.all([
      FormSubmission.find(query)
        .sort({ osviOutboundScheduledAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('phone fullName step1Data osviOutboundCallStatus osviOutboundScheduledAt osviOutboundCompletedAt osviOutboundLastError selectedSlot registeredAt')
        .lean(),
      FormSubmission.countDocuments(query),
    ]);

    const rows = docs.map((d) => ({
      id: d._id,
      phone: d.phone ? `***${String(d.phone).slice(-4)}` : '—',
      name: d.step1Data?.fullName || d.fullName || '—',
      slot: d.selectedSlot || '—',
      status: d.osviOutboundCallStatus,
      scheduledAt: d.osviOutboundScheduledAt,
      completedAt: d.osviOutboundCompletedAt,
      lastError: d.osviOutboundLastError || null,
      registeredAt: d.registeredAt,
    }));

    return res.json({ success: true, rows, total, page, limit });
  } catch (err) {
    console.error('[Admin] osvi-calls error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// App-wide feature toggles
router.get('/app-settings/osvi', requireAdmin, async (req, res) => {
  try {
    const [osviEnabled, osviAbandonedDelayMs] = await Promise.all([
      getOsviEnabled(),
      getOsviAbandonedDelayMs(),
    ]);
    return res.json({ success: true, osviEnabled, osviAbandonedDelayMs });
  } catch (err) {
    console.error('[AppSettings] GET osvi error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.patch('/app-settings/osvi', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { enabled, osviAbandonedDelayMs } = req.body || {};
    const hasEnabled = typeof enabled === 'boolean';
    const hasDelay = osviAbandonedDelayMs != null;

    if (!hasEnabled && !hasDelay) {
      return res.status(400).json({
        success: false,
        message: 'Provide `enabled` (boolean) and/or `osviAbandonedDelayMs` (non-negative number)',
      });
    }
    if (hasDelay) {
      const delay = Number(osviAbandonedDelayMs);
      if (!Number.isFinite(delay) || delay < 0) {
        return res.status(400).json({
          success: false,
          message: '`osviAbandonedDelayMs` must be a non-negative number',
        });
      }
    }
    let nextEnabled;
    let nextDelayMs;

    if (hasEnabled) {
      nextEnabled = await setOsviEnabled(enabled);
      console.log(`[AppSettings] OSVI outbound calls set to: ${nextEnabled} by admin`);
    } else {
      nextEnabled = await getOsviEnabled();
    }

    if (hasDelay) {
      nextDelayMs = await setOsviAbandonedDelayMs(osviAbandonedDelayMs);
      console.log(`[AppSettings] OSVI abandoned delay set to ${nextDelayMs}ms by admin`);
    } else {
      nextDelayMs = await getOsviAbandonedDelayMs();
    }

    return res.json({
      success: true,
      osviEnabled: nextEnabled,
      osviAbandonedDelayMs: nextDelayMs,
    });
  } catch (err) {
    console.error('[AppSettings] PATCH osvi error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Webinar Progress
router.get('/webinar-progress/stats', requireAdmin, adminProgressStats);
router.get('/webinar-progress/export', requireAdmin, adminProgressExport);
router.post('/webinar-progress/bulk', requireAdmin, adminBulkProgress);
router.patch('/webinar-progress/:phone', requireAdmin, adminUpdateProgress);
router.get('/webinar-progress/:phone/assessments', requireAdmin, adminAssessmentDetail);
router.get('/webinar-progress/:phone', requireAdmin, adminProgressDetail);
router.get('/webinar-progress', requireAdmin, adminListProgress);

module.exports = router;
