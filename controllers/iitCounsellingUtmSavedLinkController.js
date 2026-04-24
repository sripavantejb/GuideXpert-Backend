const mongoose = require('mongoose');
const IitCounsellingUtmSavedLink = require('../models/IitCounsellingUtmSavedLink');

const DEFAULT_IIT_PAGE = 'https://guidexpert.co.in/iit-counselling';
const PLATFORM_TO_SOURCE = {
  Instagram: 'instagram',
  YouTube: 'youtube',
  Twitter: 'twitter',
  X: 'x',
  WhatsApp: 'whatsapp',
  Telegram: 'telegram',
  Facebook: 'facebook',
  LinkedIn: 'linkedin',
};

function getIitCounsellingBaseUrl() {
  const raw = process.env.IIT_COUNSELLING_PAGE_URL || DEFAULT_IIT_PAGE;
  const base = (raw && typeof raw === 'string' && raw.trim()) ? raw.trim() : DEFAULT_IIT_PAGE;
  return base.replace(/\/?$/, '');
}

function buildIitCounsellingUtmUrl(influencerName, platform, campaign) {
  const baseUrl = getIitCounsellingBaseUrl();
  const params = new URLSearchParams({
    utm_source: PLATFORM_TO_SOURCE[platform] || String(platform).toLowerCase(),
    utm_medium: 'influencer',
    utm_campaign: campaign || 'guide_xperts',
    utm_content: influencerName.trim(),
  });
  return `${baseUrl}?${params.toString()}`;
}

function parseCost(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) return undefined;
  return n;
}

function mapDoc(doc) {
  const costNum = doc.cost != null && typeof doc.cost === 'number' ? doc.cost : null;
  return {
    id: doc._id,
    influencerName: doc.influencerName,
    platform: doc.platform,
    campaign: doc.campaign,
    utmLink: doc.utmLink,
    cost: costNum,
    createdAt: doc.createdAt,
  };
}

/**
 * GET /api/admin/iit-counselling/saved-utm-links
 * (aliases: GET /api/admin/iit-utm-saved-links)
 */
exports.listIitCounsellingSavedUtmLinks = async (req, res) => {
  try {
    const docs = await IitCounsellingUtmSavedLink.find({}).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data: docs.map(mapDoc) });
  } catch (err) {
    console.error('[listIitCounsellingSavedUtmLinks]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * POST /api/admin/iit-counselling/saved-utm-links
 * Body: { influencerName, platform, campaign?, cost? }
 */
exports.createIitCounsellingSavedUtmLink = async (req, res) => {
  try {
    const { influencerName, platform, campaign, cost } = req.body || {};
    if (!influencerName || typeof influencerName !== 'string' || !influencerName.trim()) {
      return res.status(400).json({ success: false, message: 'Influencer name is required.' });
    }
    const platformVal = platform || 'Instagram';
    const allowed = ['Instagram', 'YouTube', 'Twitter', 'X', 'WhatsApp', 'Telegram', 'Facebook', 'LinkedIn'];
    if (!allowed.includes(platformVal)) {
      return res.status(400).json({ success: false, message: 'Invalid platform.' });
    }
    const campaignVal = (campaign && typeof campaign === 'string' && campaign.trim()) ? campaign.trim() : 'guide_xperts';
    const costVal = parseCost(cost);
    if (costVal === undefined) {
      return res.status(400).json({ success: false, message: 'Cost must be a non-negative number.' });
    }

    const utmLink = buildIitCounsellingUtmUrl(influencerName.trim(), platformVal, campaignVal);
    const payload = {
      influencerName: influencerName.trim(),
      platform: platformVal,
      campaign: campaignVal,
      utmLink,
    };
    if (costVal !== null) payload.cost = costVal;

    const doc = await IitCounsellingUtmSavedLink.create(payload);
    return res.status(201).json({ success: true, data: mapDoc(doc) });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors).map((e) => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[createIitCounsellingSavedUtmLink]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * DELETE /api/admin/iit-counselling/saved-utm-links/:id
 */
exports.deleteIitCounsellingSavedUtmLink = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid link ID.' });
    }
    const doc = await IitCounsellingUtmSavedLink.findByIdAndDelete(id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Link not found.' });
    }
    return res.status(200).json({ success: true, message: 'Link deleted.' });
  } catch (err) {
    console.error('[deleteIitCounsellingSavedUtmLink]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
