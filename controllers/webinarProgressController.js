const jwt = require('jsonwebtoken');
const WebinarProgress = require('../models/WebinarProgress');
const WebinarAssessmentSubmission = require('../models/WebinarAssessmentSubmission');
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
    if (!user.phone) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const { completedModules, modules, lastActiveModule, overallPercent } = req.body || {};

    const updateData = {
      fullName: user.fullName || '',
      lastActivityAt: new Date(),
    };
    if (Array.isArray(completedModules)) updateData.completedModules = completedModules;
    if (modules && typeof modules === 'object') {
      updateData.modules = new Map(Object.entries(modules));
    }
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

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    return res.status(200).json({ success: true, data: { users, total, page, limit } });
  } catch (err) {
    console.error('[adminListProgress]', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch progress list.' });
  }
}

// GET /api/admin/webinar-progress/stats
async function adminProgressStats(req, res) {
  try {
    const assessmentIds = ['a1', 'a2', 'a3', 'a4', 'a5'];

    const [totalResult, completedResult, avgResult, activeResult, perModuleResult, highScorerResult, assessmentAggResult] = await Promise.all([
      WebinarProgress.countDocuments(),
      WebinarProgress.countDocuments({ overallPercent: 100 }),
      WebinarProgress.aggregate([{ $group: { _id: null, avg: { $avg: '$overallPercent' } } }]),
      WebinarProgress.countDocuments({ lastActivityAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
      WebinarProgress.aggregate([
        { $unwind: '$completedModules' },
        { $group: { _id: '$completedModules', count: { $sum: 1 } } },
      ]),
      WebinarAssessmentSubmission.aggregate([
        { $match: { assessmentId: { $in: assessmentIds } } },
        { $addFields: { pct: { $cond: [{ $gt: ['$total', 0] }, { $divide: ['$score', '$total'] }, 0] } } },
        { $match: { pct: { $gte: 0.8 } } },
        { $group: { _id: { assessmentId: '$assessmentId', phone: '$phone' } } },
        { $group: { _id: '$_id.assessmentId', count: { $sum: 1 } } },
      ]),
      WebinarAssessmentSubmission.aggregate([
        { $match: { assessmentId: { $in: assessmentIds }, total: { $gt: 0 } } },
        { $addFields: { pct: { $divide: ['$score', '$total'] } } },
        {
          $group: {
            _id: { assessmentId: '$assessmentId', phone: '$phone' },
            bestPct: { $max: '$pct' },
            bestScore: { $max: '$score' },
            bestTotal: { $first: '$total' },
            attempts: { $sum: 1 },
            avgPct: { $avg: '$pct' },
            isPerfect: { $max: { $cond: [{ $eq: ['$score', '$total'] }, 1, 0] } },
          },
        },
        {
          $group: {
            _id: '$_id.assessmentId',
            avgScorePct: { $avg: '$bestPct' },
            highestScorePct: { $max: '$bestPct' },
            totalAttempts: { $sum: '$attempts' },
            uniqueAttempters: { $sum: 1 },
            perfectScorers: { $sum: '$isPerfect' },
            highScorers: { $sum: { $cond: [{ $gte: ['$bestPct', 0.8] }, 1, 0] } },
            lowScorers: { $sum: { $cond: [{ $lt: ['$bestPct', 0.5] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const perModule = {};
    for (const item of perModuleResult) {
      perModule[item._id] = item.count;
    }

    const perModuleHighScorers = {};
    for (const item of highScorerResult) {
      perModuleHighScorers[item._id] = item.count;
    }

    const assessmentAnalytics = {};
    for (const item of assessmentAggResult) {
      assessmentAnalytics[item._id] = {
        avgScorePct: Math.round((item.avgScorePct || 0) * 1000) / 10,
        highestScorePct: Math.round((item.highestScorePct || 0) * 1000) / 10,
        totalAttempts: item.totalAttempts || 0,
        uniqueAttempters: item.uniqueAttempters || 0,
        perfectScorers: item.perfectScorers || 0,
        highScorers: item.highScorers || 0,
        lowScorers: item.lowScorers || 0,
      };
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    return res.status(200).json({
      success: true,
      data: {
        totalEnrolled: totalResult,
        fullyCompleted: completedResult,
        averagePercent: Math.round((avgResult[0]?.avg || 0) * 10) / 10,
        activeLast24h: activeResult,
        perModuleCompletion: perModule,
        perModuleHighScorers,
        assessmentAnalytics,
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

// GET /api/admin/webinar-progress/:phone/assessments
async function adminAssessmentDetail(req, res) {
  try {
    const phone = (req.params.phone || '').trim();
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number.' });
    }

    const submissions = await WebinarAssessmentSubmission.find({ phone })
      .sort({ submittedAt: -1 })
      .lean();

    const grouped = {};
    for (const sub of submissions) {
      if (!grouped[sub.assessmentId]) grouped[sub.assessmentId] = [];
      grouped[sub.assessmentId].push(sub);
    }

    const assessments = Object.entries(grouped).map(([assessmentId, attempts]) => {
      const best = attempts.reduce((a, b) => (a.score > b.score ? a : b), attempts[0]);
      const latest = attempts[0];
      const accuracy = best.total > 0 ? Math.round((best.score / best.total) * 1000) / 10 : 0;

      return {
        assessmentId,
        attemptCount: attempts.length,
        bestScore: best.score,
        bestTotal: best.total,
        accuracy,
        latestScore: latest.score,
        latestTotal: latest.total,
        lastAttemptedAt: latest.submittedAt,
        attempts: attempts.map((a) => ({
          _id: a._id,
          score: a.score,
          total: a.total,
          accuracy: a.total > 0 ? Math.round((a.score / a.total) * 1000) / 10 : 0,
          submittedAt: a.submittedAt,
          results: a.results || [],
        })),
      };
    });

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    return res.status(200).json({ success: true, data: { phone, assessments } });
  } catch (err) {
    console.error('[adminAssessmentDetail]', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch assessment details.' });
  }
}

const ALL_MODULE_IDS = ['intro', 's2', 'a1', 's3', 'a2', 's4', 'a3', 's5', 'a4', 's6', 'a5'];

// PATCH /api/admin/webinar-progress/:phone
async function adminUpdateProgress(req, res) {
  try {
    const phone = (req.params.phone || '').trim();
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number.' });
    }

    const { moduleUpdates, bulkAction } = req.body || {};

    let doc = await WebinarProgress.findOne({ phone });
    if (!doc) {
      doc = new WebinarProgress({ phone, completedModules: [], modules: new Map() });
    }

    const completed = new Set(doc.completedModules || []);
    const now = new Date();

    if (bulkAction === 'complete_all') {
      for (const id of ALL_MODULE_IDS) {
        completed.add(id);
        doc.modules.set(id, {
          status: 'completed',
          progressPercent: 100,
          completedAt: now,
          unlockedAt: now,
          watchedSeconds: 0,
          maxWatchedSeconds: 0,
          score: null,
          totalScore: null,
        });
      }
    } else if (bulkAction === 'reset') {
      completed.clear();
      for (const id of ALL_MODULE_IDS) {
        doc.modules.set(id, {
          status: id === 'intro' ? 'unlocked' : 'locked',
          progressPercent: 0,
          completedAt: null,
          unlockedAt: id === 'intro' ? now : null,
          watchedSeconds: 0,
          maxWatchedSeconds: 0,
          score: null,
          totalScore: null,
        });
      }
    } else if (moduleUpdates && typeof moduleUpdates === 'object') {
      for (const [moduleId, action] of Object.entries(moduleUpdates)) {
        if (!ALL_MODULE_IDS.includes(moduleId)) continue;
        const existing = doc.modules.get(moduleId) || {};

        if (action === 'complete') {
          completed.add(moduleId);
          doc.modules.set(moduleId, {
            ...existing,
            status: 'completed',
            progressPercent: 100,
            completedAt: now,
            unlockedAt: existing.unlockedAt || now,
          });
        } else if (action === 'uncomplete') {
          completed.delete(moduleId);
          doc.modules.set(moduleId, {
            ...existing,
            status: 'unlocked',
            progressPercent: 0,
            completedAt: null,
          });
        }
      }
    } else {
      return res.status(400).json({ success: false, message: 'Provide moduleUpdates or bulkAction.' });
    }

    doc.completedModules = Array.from(completed);
    doc.overallPercent = Math.round((doc.completedModules.length / ALL_MODULE_IDS.length) * 100);
    doc.lastActivityAt = now;

    await doc.save();

    const lean = doc.toObject();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: lean });
  } catch (err) {
    console.error('[adminUpdateProgress]', err);
    return res.status(500).json({ success: false, message: 'Failed to update progress.' });
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
  adminAssessmentDetail,
  adminUpdateProgress,
  adminProgressExport,
};
