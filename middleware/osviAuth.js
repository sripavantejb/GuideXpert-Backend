function osviAuth(req, res, next) {
  const expectedToken = process.env.OSVI_WEBHOOK_TOKEN;
  if (!expectedToken || !String(expectedToken).trim()) {
    console.error('[osviAuth] OSVI_WEBHOOK_TOKEN is not configured');
    return res.status(500).json({ success: false, message: 'Server configuration error' });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized OSVI webhook' });
  }

  const token = authHeader.slice(7).trim();
  if (token !== String(expectedToken).trim()) {
    return res.status(401).json({ success: false, message: 'Unauthorized OSVI webhook' });
  }

  return next();
}

module.exports = osviAuth;
