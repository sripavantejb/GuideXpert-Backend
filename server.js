const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const formRoutes = require('./routes/formRoutes');
const adminRoutes = require('./routes/adminRoutes');
const meetRoutes = require('./routes/meetRoutes');

const app = express();

// OTP env optional so app can start without MSG91 (e.g. meet/register still works)
const requiredOtpEnv = ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID', 'OTP_SECRET'];
const missingOtp = requiredOtpEnv.filter((k) => !process.env[k] || !String(process.env[k]).trim());
if (missingOtp.length > 0) {
  console.warn('[env] Missing OTP env (send-otp/verify-otp will fail):', missingOtp.join(', '));
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

// On Vercel, ensure MongoDB connects on first request (serverless cold start)
app.use(async (req, res, next) => {
  if (mongoose.connection.readyState === 1) return next();
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('[DB connection failed]', err.message);
    // Return clear message so you can see cause of 500 in Network tab
    res.status(503).json({
      success: false,
      message: process.env.MONGODB_URI
        ? 'Database connection failed. In MongoDB Atlas add 0.0.0.0/0 under Network Access.'
        : 'Database not configured. Set MONGODB_URI in Vercel (or in .env for local).',
    });
  }
});

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://www.guidexpert.co.in',
  'https://guidexpert.co.in',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean);
if (allowedOrigins.length === 0) allowedOrigins.push('http://localhost:5173');
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
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

app.use('/api', formRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/meet', meetRoutes);

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

// Vercel: export app for serverless. Local: also start listening.
module.exports = app;

if (!process.env.VERCEL) {
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
  startServer();
}
