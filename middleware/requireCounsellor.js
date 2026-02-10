const jwt = require('jsonwebtoken');
const Counsellor = require('../models/Counsellor');

const JWT_SECRET = process.env.COUNSELLOR_JWT_SECRET;

function requireCounsellor(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  function unauthorized(message) {
    return res.status(401).json({ success: false, message: message || 'Unauthorized' });
  }

  if (!token) {
    return unauthorized('Token required');
  }
  if (!JWT_SECRET) {
    return res.status(500).json({ success: false, message: 'Server configuration error' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.counsellorId) {
      return unauthorized('Invalid token');
    }
    Counsellor.findById(decoded.counsellorId)
      .then((counsellor) => {
        if (!counsellor) {
          return unauthorized('Counsellor not found');
        }
        req.counsellor = counsellor;
        next();
      })
      .catch((err) => {
        console.error('[requireCounsellor] Error:', err);
        return res.status(500).json({ success: false, message: 'Something went wrong.' });
      });
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return unauthorized('Invalid or expired token');
    }
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
}

module.exports = requireCounsellor;
