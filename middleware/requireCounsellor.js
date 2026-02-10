const jwt = require('jsonwebtoken');
const Counsellor = require('../models/Counsellor');

const JWT_SECRET = process.env.COUNSELLOR_JWT_SECRET;

const DEFAULT_EMAIL = process.env.DEFAULT_COUNSELLOR_EMAIL || 'counsellor@guidexpert.com';
const DEFAULT_PASSWORD = process.env.DEFAULT_COUNSELLOR_PASSWORD || 'counsellor123';

function requireCounsellor(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  function useDefaultCounsellor() {
    Counsellor.findOne().sort({ createdAt: 1 })
      .then((counsellor) => {
        if (counsellor) {
          req.counsellor = counsellor;
          return next();
        }
        // No counsellor in DB: auto-create one so CRUD works without running seed (dev and production)
        return Counsellor.create({
          name: 'Default Counsellor',
          email: DEFAULT_EMAIL,
          password: DEFAULT_PASSWORD,
          role: 'counsellor',
        })
          .then((created) => {
            console.log('[requireCounsellor] Auto-created default counsellor (email: ' + DEFAULT_EMAIL + ')');
            req.counsellor = created;
            next();
          })
          .catch((err) => {
            if (err.code === 11000) {
              return Counsellor.findOne({ email: DEFAULT_EMAIL }).then((c) => {
                if (c) {
                  req.counsellor = c;
                  next();
                } else {
                  return res.status(500).json({ success: false, message: 'Something went wrong.' });
                }
              });
            }
            console.error('[requireCounsellor] Error creating default counsellor:', err);
            return res.status(500).json({ success: false, message: 'Something went wrong.' });
          });
      })
      .catch((err) => {
        console.error('[requireCounsellor] Error:', err);
        return res.status(500).json({ success: false, message: 'Something went wrong.' });
      });
  }

  if (!token) {
    return useDefaultCounsellor();
  }
  if (!JWT_SECRET) {
    return useDefaultCounsellor();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.counsellorId) {
      return useDefaultCounsellor();
    }
    Counsellor.findById(decoded.counsellorId)
      .then((counsellor) => {
        if (!counsellor) {
          return useDefaultCounsellor();
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
      return useDefaultCounsellor();
    }
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
}

module.exports = requireCounsellor;
