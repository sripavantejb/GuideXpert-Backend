const jwt = require('jsonwebtoken');
const OneOnOneCounselor = require('../models/OneOnOneCounselor');

function getOneOnOneCounselorJwtSecret() {
  return (
    process.env.ONE_ON_ONE_COUNSELOR_JWT_SECRET ||
    process.env.COUNSELLOR_JWT_SECRET ||
    ''
  );
}

function requireOneOnOneCounselor(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const secret = getOneOnOneCounselorJwtSecret();
  if (!secret || !String(secret).trim()) {
    console.error('[requireOneOnOneCounselor] JWT secret is not set');
    return res.status(500).json({ success: false, message: 'Counselor login is not configured.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
    console.error('[requireOneOnOneCounselor] JWT verify error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }

  if (!decoded.oneOnOneCounselorId) {
    return res.status(401).json({ success: false, message: 'Invalid token payload' });
  }

  OneOnOneCounselor.findById(decoded.oneOnOneCounselorId)
    .then((counselor) => {
      if (!counselor) {
        return res.status(401).json({ success: false, message: 'Account not found' });
      }
      if (!counselor.isActive) {
        return res.status(403).json({ success: false, message: 'Account is inactive. Contact admin.' });
      }
      req.oneOnOneCounselor = counselor;
      next();
    })
    .catch((err) => {
      console.error('[requireOneOnOneCounselor] Error:', err);
      return res.status(500).json({ success: false, message: 'Something went wrong.' });
    });
}

module.exports = requireOneOnOneCounselor;
module.exports.getOneOnOneCounselorJwtSecret = getOneOnOneCounselorJwtSecret;
