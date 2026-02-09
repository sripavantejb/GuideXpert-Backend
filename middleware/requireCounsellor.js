const jwt = require('jsonwebtoken');
const Counsellor = require('../models/Counsellor');

const JWT_SECRET = process.env.COUNSELLOR_JWT_SECRET;

const isDev = process.env.NODE_ENV !== 'production';
const DEV_DEFAULT_EMAIL = 'counsellor@guidexpert.com';
const DEV_DEFAULT_PASSWORD = 'counsellor123';

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
        // No counsellor in DB: in development auto-create one so you can add students without seeding
        if (isDev) {
          return Counsellor.create({
            name: 'Default Counsellor',
            email: DEV_DEFAULT_EMAIL,
            password: DEV_DEFAULT_PASSWORD,
            role: 'counsellor',
          })
            .then((created) => {
              console.log('[requireCounsellor] Dev: auto-created default counsellor (email: ' + DEV_DEFAULT_EMAIL + ')');
              req.counsellor = created;
              next();
            })
            .catch((err) => {
              if (err.code === 11000) {
                return Counsellor.findOne({ email: DEV_DEFAULT_EMAIL }).then((c) => {
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
        }
        return res.status(401).json({
          success: false,
          message: 'No counsellor set up. Run: node scripts/seedCounsellor.js',
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
