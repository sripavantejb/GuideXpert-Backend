const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const formRoutes = require('./routes/formRoutes');
const assessmentRoutes = require('./routes/assessmentRoutes');
const assessment2Routes = require('./routes/assessment2Routes');
const assessment3Routes = require('./routes/assessment3Routes');
const assessment4Routes = require('./routes/assessment4Routes');
const assessment5Routes = require('./routes/assessment5Routes');
const adminRoutes = require('./routes/adminRoutes');
const influencerRoutes = require('./routes/influencerRoutes');
const meetingRoutes = require('./routes/meetingRoutes');
const trainingRoutes = require('./routes/trainingRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const trainingFormRoutes = require('./routes/trainingFormRoutes');
const referralRoutes = require('./routes/referralRoutes');
const cronRoutes = require('./routes/cronRoutes');
const counsellorAuthRoutes = require('./routes/counsellorAuthRoutes');
const counsellorWebinarProgressRoutes = require('./routes/counsellorWebinarProgressRoutes');
const posterRoutes = require('./routes/posterRoutes');
const studentRoutes = require('./routes/studentRoutes');
const collegePredictorRoutes = require('./routes/collegePredictorRoutes');
const collegePredictorPublicRoutes = require('./routes/collegePredictorPublicRoutes');
const rankPredictorPublicRoutes = require('./routes/rankPredictorPublicRoutes');
const counsellorAssessmentRoutes = require('./routes/counsellorAssessmentRoutes');
const assessmentCareerDnaRoutes = require('./routes/assessmentCareerDnaRoutes');
const assessmentCourseFitRoutes = require('./routes/assessmentCourseFitRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const certificateRoutes = require('./routes/certificateRoutes');
const webinarAssessmentRoutes = require('./routes/webinarAssessmentRoutes');
const webinarProgressRoutes = require('./routes/webinarProgressRoutes');
const blogRoutes = require('./routes/blogRoutes');
const { configStatus: counsellorConfigStatus } = require('./controllers/counsellorAuthController');

const app = express();

// OTP (MSG91): required in production only; in dev allow startup without them
const requiredOtpEnv = ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID', 'OTP_SECRET'];
const missing = requiredOtpEnv.filter((k) => !process.env[k] || !String(process.env[k]).trim());
if (missing.length > 0) {
  // Never crash the whole API for OTP-only env gaps.
  // Keep non-OTP routes (blogs, health, etc.) available.
  console.warn(
    '[env] OTP not fully configured:',
    missing.join(', '),
    '— OTP/SMS routes may fail until env vars are set.'
  );
}
const envStatus = {
  MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY ? `set (${process.env.MSG91_AUTH_KEY.length} chars)` : 'missing',
  MSG91_TEMPLATE_ID: process.env.MSG91_TEMPLATE_ID ? 'set' : 'missing',
  OTP_SECRET: process.env.OTP_SECRET ? 'set' : 'missing',
  ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET ? 'set' : 'missing',
};
console.log('[env] OTP (MSG91) config:', envStatus);
if (!process.env.ADMIN_JWT_SECRET) {
  console.warn('[env] ADMIN_JWT_SECRET is not set — admin login and /api/admin/leads will return 500. Add it to .env');
}
if (!process.env.COUNSELLOR_JWT_SECRET) {
  console.warn('[env] COUNSELLOR_JWT_SECRET is not set — counsellor login and /api/counsellor/students will return 500. Add it to .env');
}
if (!process.env.WEBINAR_JWT_SECRET && !process.env.COUNSELLOR_JWT_SECRET) {
  console.warn('[env] WEBINAR_JWT_SECRET and COUNSELLOR_JWT_SECRET are both missing — webinar login will fail. Set at least one in .env / Vercel env vars.');
}

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://www.guidexpert.co.in',
  'https://guidexpert.co.in',
  'https://guide-xpert-frontend.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean);
if (allowedOrigins.length === 0) allowedOrigins.push('https://guidexpert.co.in');
// Allow any Vercel preview/production frontend (*.vercel.app)
const vercelOriginRegex = /^https:\/\/[a-z0-9-]+(-[a-z0-9-]+)*\.vercel\.app$/;
// Any localhost / 127.0.0.1 port (Vite may use 5173, 5174, etc.)
const localhostDevOriginRegex = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
app.use(cors({
  origin: function(origin, callback) {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      vercelOriginRegex.test(origin) ||
      localhostDevOriginRegex.test(origin)
    ) {
      return callback(null, origin || allowedOrigins[0]);
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure MongoDB is connected before handling requests (Vercel serverless cold start)
let dbConnectPromise = null;
app.use(async (req, res, next) => {
  if (mongoose.connection.readyState === 1) return next();
  if (!dbConnectPromise) dbConnectPromise = connectDB();
  try {
    await dbConnectPromise;
    next();
  } catch (err) {
    console.error('[ensureDB]', err?.message || err);
    next(err);
  }
});

// Public college predictor (no auth) — mount before counsellor routes
app.use('/api/college-predictor', collegePredictorPublicRoutes);
// Public rank predictor (strict dataset lookup)
app.use('/api/rank-predictor', rankPredictorPublicRoutes);
// Mount more specific paths first so /api/counsellor/students is never handled by generic /api
app.use('/api/counsellor/students', studentRoutes);
app.use('/api/counsellor/announcements', announcementRoutes);
app.use('/api/counsellor/college-predictor', collegePredictorRoutes);
app.get('/api/counsellor/config-status', counsellorConfigStatus);
app.use('/api/counsellor', counsellorAssessmentRoutes);
app.use('/api/counsellor', posterRoutes);
app.use('/api/counsellor', counsellorAuthRoutes);
app.use('/api/counsellor', counsellorWebinarProgressRoutes);
app.use('/api', formRoutes);
app.use('/api/assessment', assessmentRoutes);
app.use('/api/assessment-2', assessment2Routes);
app.use('/api/assessment-3', assessment3Routes);
app.use('/api/assessment-4', assessment4Routes);
app.use('/api/assessment-5', assessment5Routes);
app.use('/api/assessment-career-dna', assessmentCareerDnaRoutes);
app.use('/api/assessment-course-fit', assessmentCourseFitRoutes);
app.use('/api', influencerRoutes);
// Blogs API (public read, admin-protected writes)
app.use('/blogs', blogRoutes);
// Backward compatible alias (can be removed once all clients migrate)
app.use('/api/blogs', blogRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/meeting', meetingRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/training-form', trainingFormRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/certificate', certificateRoutes);
app.use('/api/webinar-assessment', webinarAssessmentRoutes);
app.use('/api/webinar-progress', webinarProgressRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'GuideXpert API is running' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('[Server error]', err);
  const message = process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong.';
  res.status(500).json({ success: false, message });
});

const PORT = process.env.PORT || 5000;

// Start server only after MongoDB connection is established (local dev only)
const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`MongoDB connection established. Server ready to accept requests.`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

if (process.env.VERCEL !== '1') {
  startServer();
}

module.exports = app;
