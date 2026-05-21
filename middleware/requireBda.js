const jwt = require('jsonwebtoken');
const Bda = require('../models/Bda');

function getBdaJwtSecret() {
  return process.env.BDA_JWT_SECRET || process.env.COUNSELLOR_JWT_SECRET || '';
}

async function requireBda(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const secret = getBdaJwtSecret();
  if (!secret || !String(secret).trim()) {
    console.error('[requireBda] BDA_JWT_SECRET not set');
    return res.status(500).json({ success: false, message: 'Server configuration error' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, secret);
    if (!decoded.bdaId) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const bda = await Bda.findById(decoded.bdaId).select('+password').lean();
    if (!bda) {
      return res.status(401).json({ success: false, message: 'BDA not found' });
    }
    if (bda.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Account is inactive' });
    }
    req.bda = {
      _id: bda._id,
      id: String(bda._id),
      name: bda.name,
      email: bda.email,
      phone: bda.phone,
      role: bda.role || 'BDA',
      status: bda.status,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

module.exports = requireBda;
module.exports.getBdaJwtSecret = getBdaJwtSecret;
