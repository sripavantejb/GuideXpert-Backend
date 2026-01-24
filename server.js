require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const formRoutes = require('./routes/formRoutes');

const app = express();
const envStatus = {
  GUPSHUP_API_KEY: process.env.GUPSHUP_API_KEY ? `set (${process.env.GUPSHUP_API_KEY.length} chars)` : 'missing',
  GUPSHUP_SANDBOX_SOURCE: process.env.GUPSHUP_SANDBOX_SOURCE || 'missing',
  GUPSHUP_APP_NAME: process.env.GUPSHUP_APP_NAME || 'missing'
};
console.log('[env] WhatsApp config:', envStatus);
connectDB();

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', formRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'GuideXpert API is running' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Something went wrong.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
