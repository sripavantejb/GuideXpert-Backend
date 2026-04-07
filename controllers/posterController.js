const jwt = require('jsonwebtoken');
const TrainingFeedback = require('../models/TrainingFeedback');
const Counsellor = require('../models/Counsellor');
const PosterDownload = require('../models/PosterDownload');
const { POSTER_KEYS, FORMATS } = require('../utils/posterDownloadConstants');

function to10Digits(val) {
  if (val == null) return '';
  return String(val).replace(/\D/g, '').trim().slice(0, 10);
}

/**
 * POST /api/counsellor/poster-eligibility
 * Check if mobile number exists in trainingfeedbacks (training completed).
 * No auth required; used by counsellor poster download page.
 */
exports.checkPosterEligibility = async (req, res) => {
  try {
    const mobileNumber = to10Digits(req.body?.mobileNumber ?? req.query?.mobile ?? '');
    if (mobileNumber.length !== 10) {
      return res.status(400).json({
        success: false,
        eligible: false,
        message: 'Valid 10-digit mobile number is required.',
      });
    }
    const found = await TrainingFeedback.findOne({ mobileNumber }).lean();
    if (found) {
      return res.json({ success: true, eligible: true });
    }
    return res.json({
      success: true,
      eligible: false,
      message: 'Your training is not yet completed. Please complete the training to download the poster.',
    });
  } catch (err) {
    console.error('[checkPosterEligibility]', err);
    return res.status(500).json({
      success: false,
      eligible: false,
      message: 'Unable to check eligibility. Please try again.',
    });
  }
};

async function tryCounsellorIdFromOptionalBearer(authHeader) {
  const secret = process.env.COUNSELLOR_JWT_SECRET;
  if (!secret || !String(secret).trim()) return null;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, secret);
    if (!decoded || !decoded.counsellorId) return null;
    const exists = await Counsellor.findById(decoded.counsellorId).select('_id').lean();
    return exists ? exists._id : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/counsellor/poster-downloads/track
 * Fire-and-forget from client; optional Bearer counsellor JWT; never 401 for bad token.
 */
function normalizeTrackString(val) {
  if (val == null) return '';
  return String(val).trim().toLowerCase();
}

const TRACK_INVALID_DETAIL = `posterKey must be one of: ${POSTER_KEYS.join(', ')}; format must be one of: ${FORMATS.join(', ')}`;

exports.trackPosterDownload = async (req, res) => {
  try {
    const raw = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    let posterKey = normalizeTrackString(raw.posterKey ?? raw.poster_key);
    let format = normalizeTrackString(raw.format ?? raw.fileFormat);
    if (format === 'image/png') format = 'png';
    if (format === 'application/pdf') format = 'pdf';
    if (!POSTER_KEYS.includes(posterKey) || !FORMATS.includes(format)) {
      return res.status(400).json({
        success: false,
        message: `Invalid posterKey or format. ${TRACK_INVALID_DETAIL}`,
        received: { posterKey: posterKey || null, format: format || null },
      });
    }

    let routeContext = raw.routeContext ?? raw.route_context;
    if (routeContext != null && routeContext !== '') {
      routeContext = String(routeContext).trim().toLowerCase();
      if (!['public', 'portal'].includes(routeContext)) {
        return res.status(400).json({ success: false, message: 'Invalid routeContext.' });
      }
    } else {
      routeContext = undefined;
    }

    const displayNameSnapshot = String(raw.displayName ?? raw.display_name ?? '').trim().slice(0, 100);
    const mobileSnapshot = to10Digits(raw.mobileNumber ?? raw.mobile_number ?? raw.mobile ?? '');

    let counsellorId = await tryCounsellorIdFromOptionalBearer(req.headers.authorization);
    let identityMethod = 'anonymous';
    if (counsellorId) {
      identityMethod = 'jwt';
    } else if (mobileSnapshot.length === 10) {
      const byPhone = await Counsellor.findOne({ phone: mobileSnapshot }).select('_id').lean();
      if (byPhone) {
        counsellorId = byPhone._id;
        identityMethod = 'phone_match';
      }
    }

    const ua = req.get('user-agent');
    const userAgent = ua ? String(ua).slice(0, 512) : '';

    await PosterDownload.create({
      counsellorId: counsellorId || null,
      posterKey,
      format,
      identityMethod,
      routeContext,
      displayNameSnapshot,
      mobileSnapshot,
      userAgent,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[trackPosterDownload]', err);
    return res.status(500).json({ success: false, message: 'Unable to record download.' });
  }
};
