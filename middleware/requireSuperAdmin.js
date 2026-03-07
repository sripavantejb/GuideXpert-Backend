/**
 * Must be used after requireAdmin. Ensures req.admin.isSuperAdmin === true.
 */
function requireSuperAdmin(req, res, next) {
  if (!req.admin) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (req.admin.isSuperAdmin !== true) {
    return res.status(403).json({ success: false, message: 'Super admin access required' });
  }
  next();
}

module.exports = requireSuperAdmin;
