const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const JWT_SECRET = process.env.ADMIN_JWT_SECRET;

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const token = authHeader.slice(7);
  if (!JWT_SECRET) {
    console.error('[requireAdmin] ADMIN_JWT_SECRET not set');
    return res.status(500).json({ success: false, message: 'Server configuration error' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.adminId) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    Admin.findById(decoded.adminId)
      .then((admin) => {
        if (!admin) {
          return res.status(401).json({ success: false, message: 'Admin not found' });
        }
        req.admin = admin;
        next();
      })
      .catch((err) => {
        console.error('[requireAdmin] Error:', err);
        return res.status(500).json({ success: false, message: 'Something went wrong.' });
      });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

module.exports = requireAdmin;
