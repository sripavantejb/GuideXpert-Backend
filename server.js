require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const formRoutes = require('./routes/formRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const envStatus = {
  GUPSHUP_API_KEY: process.env.GUPSHUP_API_KEY ? `set (${process.env.GUPSHUP_API_KEY.length} chars)` : 'missing',
  GUPSHUP_SANDBOX_SOURCE: process.env.GUPSHUP_SANDBOX_SOURCE || 'missing',
  GUPSHUP_APP_NAME: process.env.GUPSHUP_APP_NAME || 'missing',
  ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET ? 'set' : 'missing',
};
console.log('[env] WhatsApp config:', envStatus);
if (!process.env.ADMIN_JWT_SECRET) {
  console.warn('[env] ADMIN_JWT_SECRET is not set — admin login and /api/admin/leads will return 500. Add it to .env');
}

const allowedOrigins = [
  process.env.FRONTEND_URL,
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

// Start server only after MongoDB connection is established
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
