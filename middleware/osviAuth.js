function extractBearerToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const trimmed = authHeader.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim() || null;
  }
  return trimmed || null;
}

function readWebhookToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const fromBearer = extractBearerToken(authHeader);
  if (fromBearer) return fromBearer;

  const altHeader = req.headers['x-osvi-webhook-token']
    || req.headers['x-webhook-token']
    || req.headers['x-api-key'];
  if (typeof altHeader === 'string' && altHeader.trim()) {
    return altHeader.trim();
  }

  return null;
}

function osviAuth(req, res, next) {
  const expectedToken = process.env.OSVI_WEBHOOK_TOKEN;
  if (!expectedToken || !String(expectedToken).trim()) {
    console.error('[osviAuth] OSVI_WEBHOOK_TOKEN is not configured');
    return res.status(500).json({ success: false, message: 'Server configuration error' });
  }

  const token = readWebhookToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized OSVI webhook',
      hint: 'Send Authorization: Bearer <OSVI_WEBHOOK_TOKEN> or X-OSVI-Webhook-Token: <OSVI_WEBHOOK_TOKEN>',
    });
  }

  if (token !== String(expectedToken).trim()) {
    return res.status(401).json({ success: false, message: 'Unauthorized OSVI webhook' });
  }

  return next();
}

module.exports = osviAuth;
