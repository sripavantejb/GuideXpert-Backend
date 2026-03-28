const jwt = require('jsonwebtoken');
const TrainingFormSubmission = require('../models/TrainingFormSubmission');
const TrainingFormResponse = require('../models/TrainingFormResponse');

function getWebinarSecret() {
  return process.env.WEBINAR_JWT_SECRET || process.env.COUNSELLOR_JWT_SECRET || process.env.JWT_SECRET || '';
}

/**
 * Decode webinar portal JWT from Authorization: Bearer <token>.
 * @returns {Promise<{ phone: string|null, fullName: string|null, authFailure?: string }>}
 * authFailure: missing_header | missing_token | server_misconfigured | token_expired | token_invalid | bad_payload
 */
async function getWebinarUserFromToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return { phone: null, fullName: null, authFailure: 'missing_header' };
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return { phone: null, fullName: null, authFailure: 'missing_token' };
  }
  const secret = getWebinarSecret();
  if (!secret || !String(secret).trim()) {
    return { phone: null, fullName: null, authFailure: 'server_misconfigured' };
  }
  try {
    const decoded = jwt.verify(token, secret.trim());
    const phone = decoded?.webinarPhone && /^\d{10}$/.test(String(decoded.webinarPhone))
      ? String(decoded.webinarPhone)
      : null;
    if (!phone) {
      return { phone: null, fullName: null, authFailure: 'bad_payload' };
    }
    let fullName = null;
    let record = await TrainingFormSubmission.findOne({ mobileNumber: phone }).sort({ createdAt: -1 }).lean();
    if (!record) record = await TrainingFormResponse.findOne({ mobileNumber: phone }).sort({ createdAt: -1 }).lean();
    if (record && record.fullName) fullName = String(record.fullName).trim();
    return { phone, fullName };
  } catch (e) {
    const name = e?.name || '';
    if (name === 'TokenExpiredError') {
      return { phone: null, fullName: null, authFailure: 'token_expired' };
    }
    return { phone: null, fullName: null, authFailure: 'token_invalid' };
  }
}

function webinarAuthErrorResponse(user) {
  const f = user?.authFailure;
  if (f === 'server_misconfigured') {
    return {
      status: 503,
      body: {
        success: false,
        message: 'Webinar login is temporarily unavailable.',
        code: 'WEBINAR_SERVER_MISCONFIGURED',
      },
    };
  }
  if (f === 'token_expired') {
    return {
      status: 401,
      body: {
        success: false,
        message: 'Session expired. Please log in again.',
        code: 'WEBINAR_TOKEN_EXPIRED',
      },
    };
  }
  return {
    status: 401,
    body: {
      success: false,
      message: 'Authentication required.',
      code: 'WEBINAR_AUTH_REQUIRED',
    },
  };
}

module.exports = {
  getWebinarSecret,
  getWebinarUserFromToken,
  webinarAuthErrorResponse,
};
