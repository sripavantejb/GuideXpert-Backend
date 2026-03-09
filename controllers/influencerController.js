const mongoose = require('mongoose');
const InfluencerLink = require('../models/InfluencerLink');
const FormSubmission = require('../models/FormSubmission');

const DEFAULT_BASE_URL = 'https://guidexpert.co.in/register';
const PLATFORM_TO_SOURCE = {
  Instagram: 'instagram',
  YouTube: 'youtube',
  Twitter: 'twitter',
  X: 'x',
  WhatsApp: 'whatsapp',
  Telegram: 'telegram',
  Facebook: 'facebook',
  LinkedIn: 'linkedin'
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
 * Parse and validate optional cost from request (non-negative number or null).
 */
function parseCost(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) return undefined;
  return n;
}

/**
 * POST /api/influencer-links — create and optionally save influencer UTM link.
 * Body: { influencerName, platform, campaign?, cost?, save?: boolean }
 */
exports.createInfluencerLink = async (req, res) => {
  try {
    console.log('[createInfluencerLink] Request body:', JSON.stringify(req.body));
    const { influencerName, platform, campaign, cost } = req.body || {};
    if (!influencerName || typeof influencerName !== 'string' || !influencerName.trim()) {
      return res.status(400).json({ success: false, message: 'Influencer name is required.' });
    }
    const platformVal = platform || 'Instagram';
    const allowed = ['Instagram', 'YouTube', 'Twitter', 'X', 'WhatsApp', 'Telegram', 'Facebook', 'LinkedIn'];
    if (!allowed.includes(platformVal)) {
      return res.status(400).json({ success: false, message: 'Invalid platform. Use Instagram, YouTube, Twitter, X, WhatsApp, Telegram, Facebook, or LinkedIn.' });
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
      const costVal = parseCost(cost);
      if (costVal === undefined) {
        return res.status(400).json({ success: false, message: 'Cost must be a non-negative number.' });
      }
      if (costVal !== null) payload.cost = costVal;

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
          cost: doc.cost ?? null,
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
 * GET /api/influencer-links — list all saved influencer links with per-link lead count.
 */
exports.listInfluencerLinks = async (req, res) => {
  try {
    const links = await InfluencerLink.find({}).sort({ createdAt: -1 }).lean();
    console.log('[listInfluencerLinks] Found', links.length, 'links');

    const data = await Promise.all(
      links.map(async (doc) => {
        const utmCampaign = ((doc.campaign || '').trim() || 'guide_xperts').toLowerCase();
        const utmContentRaw = (doc.influencerName || '').trim();
        const utmContentNorm = utmContentRaw.toLowerCase();
        const utmContentEncoded = utmContentRaw ? encodeURIComponent(utmContentRaw) : '';
        const utmContentValues = utmContentRaw
          ? (utmContentEncoded !== utmContentRaw ? [utmContentRaw, utmContentEncoded] : [utmContentRaw])
          : [];

        // Match by influencer name (utm_content) + campaign name (utm_campaign), so lead count is per link/campaign.
        // Campaign compared case-insensitive; allow empty utm_campaign in DB to match default 'guide_xperts'.
        const leadFilter = {
          applicationStatus: { $in: ['registered', 'completed'] },
          $expr: {
            $and: [
              { $or: [
                { $eq: [{ $toLower: { $trim: { input: { $ifNull: ['$utm_campaign', ''] } } } }, utmCampaign] },
                { $and: [
                  { $eq: [{ $trim: { input: { $ifNull: ['$utm_campaign', ''] } } }, ''] },
                  { $in: [utmCampaign, ['guide_xperts', '']] },
                ]},
              ]},
              utmContentNorm
                ? {
                    $or: [
                      { $in: ['$utm_content', utmContentValues] },
                      { $eq: [{ $toLower: { $trim: { input: { $ifNull: ['$utm_content', ''] } } } }, utmContentNorm] },
                    ],
                  }
                : { $eq: [{ $trim: { input: { $ifNull: ['$utm_content', ''] } } }, ''] },
            ],
          },
        };

        const [leadCount, latestDoc] = await Promise.all([
          FormSubmission.countDocuments(leadFilter),
          FormSubmission.findOne(leadFilter, { registeredAt: 1 }).sort({ registeredAt: -1 }).lean(),
        ]);

        const count = leadCount || 0;
        const costNum = doc.cost != null && typeof doc.cost === 'number' ? doc.cost : null;
        const costPerLead = (costNum != null && costNum > 0 && count > 0) ? costNum / count : null;

        return {
          id: doc._id,
          influencerName: doc.influencerName,
          platform: doc.platform,
          campaign: doc.campaign,
          utmLink: doc.utmLink,
          cost: costNum,
          costPerLead,
          createdAt: doc.createdAt,
          leadCount: count,
          latestLeadAt: latestDoc?.registeredAt || null,
        };
      })
    );

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
 * Build lead filter for a link doc (same logic as listInfluencerLinks).
 */
async function getLeadStatsForLink(doc) {
  const utmCampaign = ((doc.campaign || '').trim() || 'guide_xperts').toLowerCase();
  const utmContentRaw = (doc.influencerName || '').trim();
  const utmContentNorm = utmContentRaw.toLowerCase();
  const utmContentEncoded = utmContentRaw ? encodeURIComponent(utmContentRaw) : '';
  const utmContentValues = utmContentRaw
    ? (utmContentEncoded !== utmContentRaw ? [utmContentRaw, utmContentEncoded] : [utmContentRaw])
    : [];

  const leadFilter = {
    applicationStatus: { $in: ['registered', 'completed'] },
    $expr: {
      $and: [
        { $or: [
          { $eq: [{ $toLower: { $trim: { input: { $ifNull: ['$utm_campaign', ''] } } } }, utmCampaign] },
          { $and: [
            { $eq: [{ $trim: { input: { $ifNull: ['$utm_campaign', ''] } } }, ''] },
            { $in: [utmCampaign, ['guide_xperts', '']] },
          ]},
        ]},
        utmContentNorm
          ? {
              $or: [
                { $in: ['$utm_content', utmContentValues] },
                { $eq: [{ $toLower: { $trim: { input: { $ifNull: ['$utm_content', ''] } } } }, utmContentNorm] },
              ],
            }
          : { $eq: [{ $trim: { input: { $ifNull: ['$utm_content', ''] } } }, ''] },
      ],
    },
  };

  const [leadCount, latestDoc] = await Promise.all([
    FormSubmission.countDocuments(leadFilter),
    FormSubmission.findOne(leadFilter, { registeredAt: 1 }).sort({ registeredAt: -1 }).lean(),
  ]);
  return { leadCount: leadCount || 0, latestLeadAt: latestDoc?.registeredAt || null };
}

/**
 * PATCH /api/influencer-links/:id — update a saved link (e.g. cost).
 * Body: { cost?: number | null }
 */
exports.updateInfluencerLink = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Link ID is required.' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid link ID.' });
    }
    const costVal = parseCost(req.body?.cost);
    if (costVal === undefined) {
      return res.status(400).json({ success: false, message: 'Cost must be a non-negative number or null.' });
    }

    const doc = await InfluencerLink.findByIdAndUpdate(
      id,
      { cost: costVal },
      { new: true, runValidators: true }
    ).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Link not found.' });
    }

    const { leadCount, latestLeadAt } = await getLeadStatsForLink(doc);
    const costNum = doc.cost != null && typeof doc.cost === 'number' ? doc.cost : null;
    const costPerLead = (costNum != null && costNum > 0 && leadCount > 0) ? costNum / leadCount : null;

    return res.status(200).json({
      success: true,
      data: {
        id: doc._id,
        influencerName: doc.influencerName,
        platform: doc.platform,
        campaign: doc.campaign,
        utmLink: doc.utmLink,
        cost: costNum,
        costPerLead,
        createdAt: doc.createdAt,
        leadCount,
        latestLeadAt,
      },
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors).map(e => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[updateInfluencerLink]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

// Treat date query as YYYY-MM-DD: from = start of day UTC, to = end of day UTC (accurate full-day filter)
function parseDateRange(from, to) {
  const range = {};
  if (from && typeof from === 'string') {
    const fromStr = from.trim().length === 10 ? `${from.trim()}T00:00:00.000Z` : from.trim();
    range.$gte = new Date(fromStr);
  }
  if (to && typeof to === 'string') {
    const toStr = to.trim().length === 10 ? `${to.trim()}T23:59:59.999Z` : to.trim();
    range.$lte = new Date(toStr);
  }
  return Object.keys(range).length ? range : null;
}

/**
 * GET /api/influencer-analytics — aggregate registrations by utm_content (influencer).
 * Only counts users who completed slot booking (Step 3); link clicks are not counted.
 * Query: from, to (ISO date), sort=registrations|latest (default: registrations)
 */
exports.getInfluencerAnalytics = async (req, res) => {
  try {
    const { from, to, sort } = req.query || {};
    const match = { applicationStatus: { $in: ['registered', 'completed'] } };
    const dateRange = parseDateRange(from, to);
    if (dateRange) match.registeredAt = dateRange;
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

    // Normalize utm_content for merging: decode, trim, lowercase key
    function normalizeUtmContent(raw) {
      if (raw == null || typeof raw !== 'string') return '';
      let s = raw.trim();
      try {
        s = decodeURIComponent(s);
      } catch {
        // keep as-is if decode fails
      }
      return s.trim().toLowerCase();
    }

    // Merge rows with same normalized name + platform (one row per influencer)
    const byKey = new Map();
    for (const r of results) {
      let name = r.influencerName || r._id || '';
      try {
        name = decodeURIComponent(name);
      } catch {
        // keep original
      }
      name = name.trim();
      const platform = (r.platform || '').trim();
      const platformLower = platform.toLowerCase();
      const key = `${normalizeUtmContent(r.influencerName || r._id)}|${platformLower}`;

      if (byKey.has(key)) {
        const existing = byKey.get(key);
        existing.totalRegistrations += r.totalRegistrations ?? 0;
        if (r.latestRegistration && (!existing.latestRegistration || new Date(r.latestRegistration) > new Date(existing.latestRegistration))) {
          existing.latestRegistration = r.latestRegistration;
        }
        if (name.length > (existing.influencerName || '').length) {
          existing.influencerName = name;
        }
      } else {
        byKey.set(key, {
          influencerName: name,
          platform,
          totalRegistrations: r.totalRegistrations ?? 0,
          latestRegistration: r.latestRegistration || null
        });
      }
    }

    // Only show influencers that exist in influencerlinks (MongoDB); one row per unique influencer+platform
    const savedLinks = await InfluencerLink.find({}, { influencerName: 1, platform: 1 }).lean();
    const resultRows = [];
    const seenKeys = new Set();
    for (const link of savedLinks) {
      const key = `${normalizeUtmContent(link.influencerName)}|${(link.platform || '').trim().toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const analyticsRow = byKey.get(key);
      if (analyticsRow) {
        resultRows.push({
          influencerName: link.influencerName,
          platform: link.platform || analyticsRow.platform,
          totalRegistrations: analyticsRow.totalRegistrations ?? 0,
          latestRegistration: analyticsRow.latestRegistration || null
        });
      } else {
        resultRows.push({
          influencerName: link.influencerName,
          platform: link.platform || '',
          totalRegistrations: 0,
          latestRegistration: null
        });
      }
    }

    let data = resultRows;
    if (sort === 'latest') {
      data = [...data].sort((a, b) => new Date(b.latestRegistration || 0) - new Date(a.latestRegistration || 0));
    } else {
      data = [...data].sort((a, b) => (b.totalRegistrations ?? 0) - (a.totalRegistrations ?? 0));
    }

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
    const dateRange = parseDateRange(from, to);
    if (dateRange) match.registeredAt = dateRange;
    match.utm_content = { $exists: true, $ne: null, $ne: '' };
    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$registeredAt', timezone: 'Asia/Kolkata' } },
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
