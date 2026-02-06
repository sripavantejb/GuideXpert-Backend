const mongoose = require('mongoose');
const InfluencerLink = require('../models/InfluencerLink');
const FormSubmission = require('../models/FormSubmission');

const DEFAULT_BASE_URL = 'https://guidexpert.co.in/register';
const PLATFORM_TO_SOURCE = {
  Instagram: 'instagram',
  YouTube: 'youtube',
  Twitter: 'twitter',
  WhatsApp: 'whatsapp'
};

function getBaseUrl() {
  const base = process.env.REGISTRATION_BASE_URL || DEFAULT_BASE_URL;
  return base.replace(/\/?$/, '');
}

/**
 * Build UTM link from influencer name, platform, and campaign.
 */
function buildUtmLink(influencerName, platform, campaign) {
  const base = getBaseUrl();
  const params = new URLSearchParams({
    utm_source: PLATFORM_TO_SOURCE[platform] || platform.toLowerCase(),
    utm_medium: 'influencer',
    utm_campaign: campaign || 'guide_xperts',
    utm_content: encodeURIComponent(influencerName.trim())
  });
  return `${base}?${params.toString()}`;
}

/**
 * POST /api/influencer-links — create and optionally save influencer UTM link.
 * Body: { influencerName, platform, campaign? } or { influencerName, platform, campaign?, save?: boolean }
 */
exports.createInfluencerLink = async (req, res) => {
  try {
    console.log('[createInfluencerLink] Request body:', JSON.stringify(req.body));
    const { influencerName, platform, campaign } = req.body || {};
    if (!influencerName || typeof influencerName !== 'string' || !influencerName.trim()) {
      return res.status(400).json({ success: false, message: 'Influencer name is required.' });
    }
    const platformVal = platform || 'Instagram';
    const allowed = ['Instagram', 'YouTube', 'Twitter', 'WhatsApp'];
    if (!allowed.includes(platformVal)) {
      return res.status(400).json({ success: false, message: 'Invalid platform. Use Instagram, YouTube, Twitter, or WhatsApp.' });
    }
    const campaignVal = (campaign && typeof campaign === 'string' && campaign.trim()) ? campaign.trim() : 'guide_xperts';
    const utmLink = buildUtmLink(influencerName.trim(), platformVal, campaignVal);

    const payload = {
      influencerName: influencerName.trim(),
      platform: platformVal,
      campaign: campaignVal,
      utmLink
    };

    if (req.body.save === true) {
      console.log('[createInfluencerLink] Saving to database:', payload);
      const doc = await InfluencerLink.create(payload);
      console.log('[createInfluencerLink] Saved successfully, id:', doc._id);
      return res.status(201).json({
        success: true,
        data: {
          id: doc._id,
          influencerName: doc.influencerName,
          platform: doc.platform,
          campaign: doc.campaign,
          utmLink: doc.utmLink,
          createdAt: doc.createdAt
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: { ...payload, createdAt: new Date() }
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors).map(e => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[createInfluencerLink]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /api/influencer-links — list all saved influencer links.
 */
exports.listInfluencerLinks = async (req, res) => {
  try {
    const links = await InfluencerLink.find({}).sort({ createdAt: -1 }).lean();
    console.log('[listInfluencerLinks] Found', links.length, 'links');
    const data = links.map(doc => ({
      id: doc._id,
      influencerName: doc.influencerName,
      platform: doc.platform,
      campaign: doc.campaign,
      utmLink: doc.utmLink,
      createdAt: doc.createdAt
    }));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[listInfluencerLinks]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * DELETE /api/influencer-links/:id — delete a saved influencer link.
 */
exports.deleteInfluencerLink = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Link ID is required.' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid link ID.' });
    }
    const doc = await InfluencerLink.findByIdAndDelete(id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Link not found.' });
    }
    return res.status(200).json({ success: true, message: 'Link deleted.' });
  } catch (err) {
    console.error('[deleteInfluencerLink]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /api/influencer-analytics — aggregate registrations by utm_content (influencer).
 * Only counts users who completed slot booking (Step 3); link clicks are not counted.
 * Query: from, to (ISO date), sort=registrations|latest (default: registrations)
 */
exports.getInfluencerAnalytics = async (req, res) => {
  try {
    const { from, to, sort } = req.query || {};
    const match = { applicationStatus: { $in: ['registered', 'completed'] } };
    if (from || to) {
      match.registeredAt = {};
      if (from) match.registeredAt.$gte = new Date(from);
      if (to) match.registeredAt.$lte = new Date(to);
    }
    const pipeline = [
      { $match: match },
      { $match: { utm_content: { $exists: true, $ne: null, $ne: '' } } },
      {
        $group: {
          _id: '$utm_content',
          totalRegistrations: { $sum: 1 },
          latestRegistration: { $max: '$registeredAt' },
          utm_source: { $first: '$utm_source' }
        }
      },
      {
        $project: {
          influencerName: '$_id',
          platform: '$utm_source',
          totalRegistrations: 1,
          latestRegistration: 1,
          _id: 0
        }
      }
    ];
    if (sort === 'latest') {
      pipeline.push({ $sort: { latestRegistration: -1 } });
    } else {
      pipeline.push({ $sort: { totalRegistrations: -1 } });
    }

    const results = await FormSubmission.aggregate(pipeline);
    const data = results.map(r => {
      // Decode URL-encoded influencer name (utm_content stores encoded value)
      let name = r.influencerName || r._id || '';
      try {
        name = decodeURIComponent(name);
      } catch {
        // Keep original if decode fails
      }
      return {
        influencerName: name,
        platform: r.platform || '',
        totalRegistrations: r.totalRegistrations,
        latestRegistration: r.latestRegistration || null
      };
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[getInfluencerAnalytics]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /api/influencer-analytics/trend — registrations per day (for chart).
 * Query: from, to (ISO date strings, optional).
 */
exports.getInfluencerTrend = async (req, res) => {
  try {
    const { from, to } = req.query || {};
    const match = { applicationStatus: { $in: ['registered', 'completed'] } };
    if (from || to) {
      match.registeredAt = {};
      if (from) match.registeredAt.$gte = new Date(from);
      if (to) match.registeredAt.$lte = new Date(to);
    }
    match.utm_content = { $exists: true, $ne: null, $ne: '' };
    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$registeredAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      { $project: { date: '$_id', count: 1, _id: 0 } }
    ];
    const results = await FormSubmission.aggregate(pipeline);
    return res.status(200).json({ success: true, data: results });
  } catch (err) {
    console.error('[getInfluencerTrend]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
