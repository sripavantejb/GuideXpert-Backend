const jwt = require('jsonwebtoken');
const Counsellor = require('../models/Counsellor');

const JWT_SECRET = process.env.COUNSELLOR_JWT_SECRET;

function requireCounsellor(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  if (!JWT_SECRET || !String(JWT_SECRET).trim()) {
    console.error('[requireCounsellor] COUNSELLOR_JWT_SECRET is not set');
    return res.status(500).json({ success: false, message: 'Counsellor login is not configured.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
    console.error('[requireCounsellor] JWT verify error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }

  if (!decoded.counsellorId) {
    return res.status(401).json({ success: false, message: 'Invalid token payload' });
  }

  Counsellor.findById(decoded.counsellorId)
    .then((counsellor) => {
      if (!counsellor) {
        return res.status(401).json({ success: false, message: 'Account not found' });
      }
      req.counsellor = counsellor;
      next();
    })
    .catch((err) => {
      console.error('[requireCounsellor] Error:', err);
      return res.status(500).json({ success: false, message: 'Something went wrong.' });
    });
}

module.exports = requireCounsellor;
