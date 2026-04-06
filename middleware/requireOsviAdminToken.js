function requireOsviAdminToken(req, res, next) {
  const expected = process.env.OSVI_ADMIN_API_TOKEN;
  if (!expected || !String(expected).trim()) {
    console.error('[requireOsviAdminToken] OSVI_ADMIN_API_TOKEN not configured');
    return res.status(500).json({ success: false, message: 'Server configuration error' });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const token = authHeader.slice(7).trim();
  if (token !== String(expected).trim()) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  return next();
}

module.exports = requireOsviAdminToken;
