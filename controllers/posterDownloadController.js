const mongoose = require('mongoose');
const PosterDownload = require('../models/PosterDownload');
const { POSTER_KEYS } = require('../utils/posterDownloadConstants');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function mapByPosterAggregate(doc) {
  const id = doc._id;
  if (typeof id === 'string' && id.startsWith('automated|')) {
    const slug = id.slice('automated|'.length);
    return {
      posterKey: 'automated',
      automatedRouteSlug: slug === '' ? null : slug,
      count: doc.count,
    };
  }
  return {
    posterKey: id,
    automatedRouteSlug: null,
    count: doc.count,
  };
}

async function aggregatePosterDownloadStats(match) {
  const [byPosterRaw, byDay] = await Promise.all([
    PosterDownload.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ['$posterKey', 'automated'] },
              {
                $concat: ['automated|', { $ifNull: ['$automatedRouteSlug', ''] }],
              },
              '$posterKey',
            ],
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),
    PosterDownload.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$downloadedAt', timezone: 'Asia/Kolkata' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 90 },
    ]),
  ]);
  const byPoster = byPosterRaw.map(mapByPosterAggregate);
  return {
    byPoster,
    byDay: byDay.map((x) => ({ date: x._id, count: x.count })),
  };
}

function parsePageLimit(query) {
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limitRaw = parseInt(String(query.limit || String(DEFAULT_LIMIT)), 10);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
}

function parseDateStart(value) {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateEnd(value) {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const end = new Date(d);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/**
 * GET /api/admin/poster-downloads
 */
exports.getPosterDownloads = async (req, res) => {
  try {
    const { page, limit, skip } = parsePageLimit(req.query);
    const filter = {};

    const from = parseDateStart(req.query.from);
    const to = parseDateEnd(req.query.to);
    if (from || to) {
      filter.downloadedAt = {};
      if (from) filter.downloadedAt.$gte = from;
      if (to) filter.downloadedAt.$lte = to;
    }

    if (req.query.posterKey && String(req.query.posterKey).trim()) {
      const key = String(req.query.posterKey).trim().toLowerCase();
      if (POSTER_KEYS.includes(key)) filter.posterKey = key;
    }

    if (req.query.counsellorId && mongoose.Types.ObjectId.isValid(String(req.query.counsellorId).trim())) {
      filter.counsellorId = new mongoose.Types.ObjectId(String(req.query.counsellorId).trim());
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(esc, 'i');
      filter.$or = [
        { displayNameSnapshot: regex },
        { mobileSnapshot: regex },
        { automatedRouteSlug: regex },
      ];
    }

    const includeStats =
      req.query.includeStats === '1' ||
      req.query.includeStats === 'true';

    const statsMatch = {};
    if (from || to) {
      statsMatch.downloadedAt = {};
      if (from) statsMatch.downloadedAt.$gte = from;
      if (to) statsMatch.downloadedAt.$lte = to;
    }

    const statsPromise = includeStats ? aggregatePosterDownloadStats(statsMatch) : null;

    const [total, items, stats] = await Promise.all([
      PosterDownload.countDocuments(filter),
      PosterDownload.find(filter)
        .sort({ downloadedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('counsellorId', 'name email phone')
        .lean(),
      statsPromise || Promise.resolve(null),
    ]);

    const rows = items.map((doc) => {
      const c = doc.counsellorId;
      return {
        _id: doc._id,
        posterKey: doc.posterKey,
        format: doc.format,
        identityMethod: doc.identityMethod,
        routeContext: doc.routeContext,
        automatedRouteSlug: doc.automatedRouteSlug || '',
        displayNameSnapshot: doc.displayNameSnapshot,
        mobileSnapshot: doc.mobileSnapshot,
        userAgent: doc.userAgent,
        downloadedAt: doc.downloadedAt,
        counsellor: c && typeof c === 'object' && c._id
          ? { _id: c._id, name: c.name, email: c.email, phone: c.phone }
          : null,
      };
    });

    const payload = {
      items: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
    if (stats) payload.stats = stats;

    return res.json({
      success: true,
      data: payload,
    });
  } catch (err) {
    console.error('[getPosterDownloads]', err);
    return res.status(500).json({ success: false, message: 'Failed to load poster downloads.' });
  }
};

/**
 * GET /api/admin/poster-downloads/stats
 */
exports.getPosterDownloadStats = async (req, res) => {
  try {
    const match = {};
    const from = parseDateStart(req.query.from);
    const to = parseDateEnd(req.query.to);
    if (from || to) {
      match.downloadedAt = {};
      if (from) match.downloadedAt.$gte = from;
      if (to) match.downloadedAt.$lte = to;
    }

    const stats = await aggregatePosterDownloadStats(match);

    return res.json({
      success: true,
      data: stats,
    });
  } catch (err) {
    console.error('[getPosterDownloadStats]', err);
    return res.status(500).json({ success: false, message: 'Failed to load stats.' });
  }
};
