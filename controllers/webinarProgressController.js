const jwt = require('jsonwebtoken');
const WebinarProgress = require('../models/WebinarProgress');
const TrainingFormSubmission = require('../models/TrainingFormSubmission');
const TrainingFormResponse = require('../models/TrainingFormResponse');

function getWebinarSecret() {
  return process.env.WEBINAR_JWT_SECRET || process.env.COUNSELLOR_JWT_SECRET || process.env.JWT_SECRET || '';
}

async function getWebinarUserFromToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return { phone: null, fullName: null };
  }
  const token = authHeader.slice(7).trim();
  const secret = getWebinarSecret();
  if (!secret || !token) return { phone: null, fullName: null };
  try {
    const decoded = jwt.verify(token, secret);
    const phone = decoded?.webinarPhone && /^\d{10}$/.test(String(decoded.webinarPhone))
      ? String(decoded.webinarPhone)
      : null;
    let fullName = null;
    if (phone) {
      let record = await TrainingFormSubmission.findOne({ mobileNumber: phone }).sort({ createdAt: -1 }).lean();
      if (!record) record = await TrainingFormResponse.findOne({ mobileNumber: phone }).sort({ createdAt: -1 }).lean();
      if (record && record.fullName) fullName = String(record.fullName).trim();
    }
    return { phone, fullName };
  } catch {
    return { phone: null, fullName: null };
  }
}

// POST /api/webinar-progress/sync
async function syncProgress(req, res) {
  try {
    const user = await getWebinarUserFromToken(req);
    console.log('[syncProgress] phone:', user.phone, 'body keys:', req.body ? Object.keys(req.body) : 'NO BODY');
    if (!user.phone) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const { completedModules, modules, lastActiveModule, overallPercent } = req.body || {};

    const updateData = {
      fullName: user.fullName || '',
      lastActivityAt: new Date(),
    };
    if (Array.isArray(completedModules)) updateData.completedModules = completedModules;
    if (modules && typeof modules === 'object') updateData.modules = modules;
    if (typeof lastActiveModule === 'string') updateData.lastActiveModule = lastActiveModule;
    if (typeof overallPercent === 'number') updateData.overallPercent = Math.max(0, Math.min(100, overallPercent));

    await WebinarProgress.findOneAndUpdate(
      { phone: user.phone },
      { $set: updateData },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({ success: true, message: 'Progress synced.' });
  } catch (err) {
    console.error('[syncProgress]', err);
    return res.status(500).json({ success: false, message: 'Failed to sync progress.' });
  }
}

// GET /api/webinar-progress
async function getProgress(req, res) {
  try {
    const user = await getWebinarUserFromToken(req);
    if (!user.phone) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const doc = await WebinarProgress.findOne({ phone: user.phone }).lean();
    if (!doc) {
      return res.status(200).json({ success: true, data: null });
    }

    return res.status(200).json({ success: true, data: doc });
  } catch (err) {
    console.error('[getProgress]', err);
    return res.status(500).json({ success: false, message: 'Failed to get progress.' });
  }
}

// GET /api/admin/webinar-progress
async function adminListProgress(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const skip = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const status = (req.query.status || '').trim();
    const sort = (req.query.sort || '-lastActivityAt').trim();

    const filter = {};
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ fullName: regex }, { phone: regex }];
    }
    if (status === 'completed') {
      filter.overallPercent = 100;
    } else if (status === 'in_progress') {
      filter.overallPercent = { $gt: 0, $lt: 100 };
    } else if (status === 'not_started') {
      filter.overallPercent = 0;
    }

    const sortObj = {};
    if (sort.startsWith('-')) {
      sortObj[sort.slice(1)] = -1;
    } else {
      sortObj[sort] = 1;
    }

    const [users, total] = await Promise.all([
      WebinarProgress.find(filter).sort(sortObj).skip(skip).limit(limit).lean(),
      WebinarProgress.countDocuments(filter),
    ]);

    return res.status(200).json({ success: true, data: { users, total, page, limit } });
  } catch (err) {
    console.error('[adminListProgress]', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch progress list.' });
  }
}

// GET /api/admin/webinar-progress/stats
async function adminProgressStats(req, res) {
  try {
    const [totalResult, completedResult, avgResult, activeResult, perModuleResult] = await Promise.all([
      WebinarProgress.countDocuments(),
      WebinarProgress.countDocuments({ overallPercent: 100 }),
      WebinarProgress.aggregate([{ $group: { _id: null, avg: { $avg: '$overallPercent' } } }]),
      WebinarProgress.countDocuments({ lastActivityAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
      WebinarProgress.aggregate([
        { $unwind: '$completedModules' },
        { $group: { _id: '$completedModules', count: { $sum: 1 } } },
      ]),
    ]);

    const perModule = {};
    for (const item of perModuleResult) {
      perModule[item._id] = item.count;
    }

    return res.status(200).json({
      success: true,
      data: {
        totalEnrolled: totalResult,
        fullyCompleted: completedResult,
        averagePercent: Math.round((avgResult[0]?.avg || 0) * 10) / 10,
        activeLast24h: activeResult,
        perModuleCompletion: perModule,
      },
    });
  } catch (err) {
    console.error('[adminProgressStats]', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch stats.' });
  }
}

// GET /api/admin/webinar-progress/:phone
async function adminProgressDetail(req, res) {
  try {
    const phone = (req.params.phone || '').trim();
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number.' });
    }

    const doc = await WebinarProgress.findOne({ phone }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'No progress found for this user.' });
    }

    return res.status(200).json({ success: true, data: doc });
  } catch (err) {
    console.error('[adminProgressDetail]', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch user progress.' });
  }
}

// GET /api/admin/webinar-progress/export
async function adminProgressExport(req, res) {
  try {
    const docs = await WebinarProgress.find().sort({ lastActivityAt: -1 }).lean();

    const header = 'Name,Phone,Overall %,Completed Modules,Last Active Module,Last Activity\n';
    const rows = docs.map((d) => {
      const name = (d.fullName || '').replace(/,/g, ' ');
      const completed = (d.completedModules || []).join('; ');
      const lastActive = d.lastActivityAt ? new Date(d.lastActivityAt).toISOString() : '';
      return `${name},${d.phone},${d.overallPercent || 0},"${completed}",${d.lastActiveModule || ''},${lastActive}`;
    });

    const csv = header + rows.join('\n');
    const filename = `webinar-progress-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('[adminProgressExport]', err);
    return res.status(500).json({ success: false, message: 'Failed to export.' });
  }
}

module.exports = {
  syncProgress,
  getProgress,
  adminListProgress,
  adminProgressStats,
  adminProgressDetail,
  adminProgressExport,
};
