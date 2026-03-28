const WebinarProgress = require('../models/WebinarProgress');
const WebinarAssessmentSubmission = require('../models/WebinarAssessmentSubmission');
const { getWebinarUserFromToken, webinarAuthErrorResponse } = require('../utils/webinarJwtAuth');

const STATUS_RANK = { locked: 0, unlocked: 1, in_progress: 2, completed: 3 };
const ALL_MODULE_IDS = ['intro', 's2', 'a1', 's3', 'a2', 's4', 'a3', 's5', 'a4', 's6', 'a5'];
const TOTAL_MODULES = ALL_MODULE_IDS.length;

/** Display titles aligned with frontend mockWebinarData (for lastActivityEvent.moduleTitle). */
const MODULE_TITLES = {
  intro: 'Introduction to GuideXpert Counsellor training program',
  s2: 'Introduction to GuideXpert Counselling & Core Principles',
  a1: 'Assessment 1',
  s3: 'Mastering Counselling: Objection Handling & Communication Skills',
  a2: 'Assessment 2',
  s4: 'Lead Generation Methods & Strategies for Career Counsellors',
  a3: 'Assessment 3',
  s5: 'How to Position Yourself as a Trusted Career Counsellor',
  a4: 'Assessment 4',
  s6: 'GuideXpert Portal, Tools & Referral Process',
  a5: 'Assessment 5',
};

function isAssessmentModuleId(id) {
  return typeof id === 'string' && /^a\d+$/.test(id);
}

function pickPreferredModuleId(candidates, lastActiveModule) {
  if (!candidates.length) return null;
  if (typeof lastActiveModule === 'string' && candidates.includes(lastActiveModule)) return lastActiveModule;
  let best = candidates[0];
  let bestIdx = ALL_MODULE_IDS.indexOf(best);
  for (let i = 1; i < candidates.length; i += 1) {
    const id = candidates[i];
    const idx = ALL_MODULE_IDS.indexOf(id);
    if (idx > bestIdx) {
      best = id;
      bestIdx = idx;
    }
  }
  return best;
}

/**
 * Infer a compact last activity snapshot from the sync body.
 * Priority: assessment completed → session/video completed → in-progress video → active module focus → generic.
 */
function deriveLastActivityEvent({ completedModules, modules, lastActiveModule, now }) {
  const at = now;
  const title = (id) => (id && MODULE_TITLES[id]) || id || 'Module';

  if (modules && typeof modules === 'object') {
    const completedIds = Object.entries(modules)
      .filter(([, mod]) => mod && mod.status === 'completed')
      .map(([id]) => id);

    const assessmentDone = completedIds.filter(isAssessmentModuleId);
    const sessionDone = completedIds.filter((id) => !isAssessmentModuleId(id));

    if (assessmentDone.length) {
      const id = pickPreferredModuleId(assessmentDone, lastActiveModule);
      return {
        type: 'assessment_completed',
        moduleId: id,
        moduleTitle: title(id),
        progressPercent: 100,
        watchedSeconds: null,
        at,
      };
    }
    if (sessionDone.length) {
      const id = pickPreferredModuleId(sessionDone, lastActiveModule);
      return {
        type: 'video_completed',
        moduleId: id,
        moduleTitle: title(id),
        progressPercent: 100,
        watchedSeconds: null,
        at,
      };
    }

    for (const id of ALL_MODULE_IDS) {
      const mod = modules[id];
      if (!mod || mod.status !== 'in_progress') continue;
      if (isAssessmentModuleId(id)) continue;
      const ws = typeof mod.watchedSeconds === 'number' ? mod.watchedSeconds : 0;
      const pp = typeof mod.progressPercent === 'number' ? mod.progressPercent : 0;
      if (ws > 0 || pp > 0) {
        return {
          type: 'video_progress',
          moduleId: id,
          moduleTitle: title(id),
          watchedSeconds: ws,
          progressPercent: Math.round(pp),
          at,
        };
      }
    }
  }

  if (typeof lastActiveModule === 'string' && ALL_MODULE_IDS.includes(lastActiveModule)) {
    return {
      type: 'module_unlocked',
      moduleId: lastActiveModule,
      moduleTitle: title(lastActiveModule),
      watchedSeconds: null,
      progressPercent: null,
      at,
    };
  }

  const fallbackId =
    Array.isArray(completedModules) && completedModules.length
      ? pickPreferredModuleId(completedModules.filter((id) => ALL_MODULE_IDS.includes(id)), lastActiveModule)
      : null;

  return {
    type: 'resume_seek',
    moduleId: fallbackId,
    moduleTitle: fallbackId ? title(fallbackId) : 'Training',
    watchedSeconds: null,
    progressPercent: null,
    at,
  };
}

function statusRankExpr(fieldPath) {
  return {
    $switch: {
      branches: [
        { case: { $eq: [fieldPath, 'completed'] }, then: 3 },
        { case: { $eq: [fieldPath, 'in_progress'] }, then: 2 },
        { case: { $eq: [fieldPath, 'unlocked'] }, then: 1 },
      ],
      default: 0,
    },
  };
}

// POST /api/webinar-progress/sync
// Uses an aggregation-pipeline update so every merge operation happens
// atomically inside MongoDB -- no read-then-write race.
async function syncProgress(req, res) {
  try {
    const user = await getWebinarUserFromToken(req);
    if (!user.phone) {
      const { status, body } = webinarAuthErrorResponse(user);
      return res.status(status).json(body);
    }

    const { completedModules, modules, lastActiveModule } = req.body || {};
    const now = new Date();
    const lastActivityEvent = deriveLastActivityEvent({
      completedModules,
      modules,
      lastActiveModule,
      now,
    });

    const stage1 = {
      fullName: user.fullName || '',
      lastActivityAt: now,
      lastActivityEvent,
    };

    if (Array.isArray(completedModules)) {
      stage1.completedModules = {
        $setUnion: [{ $ifNull: ['$completedModules', []] }, completedModules],
      };
    }

    if (typeof lastActiveModule === 'string') {
      stage1.lastActiveModule = lastActiveModule;
    }

    if (modules && typeof modules === 'object') {
      for (const [moduleId, mod] of Object.entries(modules)) {
        if (!mod || typeof mod !== 'object') continue;
        const p = `modules.${moduleId}`;
        const curStatus = { $ifNull: [`$${p}.status`, 'locked'] };

        if (mod.status && STATUS_RANK[mod.status] != null) {
          const incoming = STATUS_RANK[mod.status];
          stage1[`${p}.status`] = {
            $cond: {
              if: { $gt: [incoming, statusRankExpr(curStatus)] },
              then: mod.status,
              else: curStatus,
            },
          };
        }

        if (typeof mod.progressPercent === 'number') {
          stage1[`${p}.progressPercent`] = {
            $max: [{ $ifNull: [`$${p}.progressPercent`, 0] }, mod.progressPercent],
          };
        }
        if (typeof mod.watchedSeconds === 'number') {
          stage1[`${p}.watchedSeconds`] = {
            $max: [{ $ifNull: [`$${p}.watchedSeconds`, 0] }, mod.watchedSeconds],
          };
        }
        if (typeof mod.maxWatchedSeconds === 'number') {
          stage1[`${p}.maxWatchedSeconds`] = {
            $max: [{ $ifNull: [`$${p}.maxWatchedSeconds`, 0] }, mod.maxWatchedSeconds],
          };
        }
        if (mod.completedAt) {
          stage1[`${p}.completedAt`] = {
            $ifNull: [`$${p}.completedAt`, new Date(mod.completedAt)],
          };
        }
        if (mod.unlockedAt) {
          stage1[`${p}.unlockedAt`] = {
            $ifNull: [`$${p}.unlockedAt`, new Date(mod.unlockedAt)],
          };
        }
      }
    }

    const pipeline = [{ $set: stage1 }];

    if (Array.isArray(completedModules)) {
      pipeline.push({
        $set: {
          overallPercent: {
            $round: [
              { $multiply: [{ $divide: [{ $size: { $ifNull: ['$completedModules', []] } }, TOTAL_MODULES] }, 100] },
              0,
            ],
          },
        },
      });
    }

    const updated = await WebinarProgress.findOneAndUpdate(
      { phone: user.phone },
      pipeline,
      { upsert: true, new: true, updatePipeline: true }
    ).lean();

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: updated });
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
      const { status, body } = webinarAuthErrorResponse(user);
      return res.status(status).json(body);
    }

    const doc = await WebinarProgress.findOne({ phone: user.phone }).lean();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    if (!doc) {
      return res.status(200).json({ success: true, data: null });
    }

    return res.status(200).json({ success: true, data: doc });
  } catch (err) {
    console.error('[getProgress]', err);
    return res.status(500).json({ success: false, message: 'Failed to get progress.' });
  }
}

// POST /api/webinar-progress/certificate-downloaded
async function recordCertificateDownload(req, res) {
  try {
    const user = await getWebinarUserFromToken(req);
    if (!user.phone) {
      const { status, body } = webinarAuthErrorResponse(user);
      return res.status(status).json(body);
    }

    await WebinarProgress.findOneAndUpdate(
      { phone: user.phone },
      { $set: { certificateDownloadedAt: new Date() } },
      { new: true, upsert: true }
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[recordCertificateDownload]', err);
    return res.status(500).json({ success: false, message: 'Failed to record certificate download.' });
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

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
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

// PATCH /api/admin/webinar-progress/:phone
async function adminUpdateProgress(req, res) {
  try {
    const phone = (req.params.phone || '').trim();
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number.' });
    }

    const { moduleUpdates, bulkAction } = req.body || {};
    const now = new Date();

    const existing = await WebinarProgress.findOne({ phone }).lean();
    const completed = new Set(existing?.completedModules || []);
    const $set = { lastActivityAt: now };

    if (bulkAction === 'complete_all') {
      for (const id of ALL_MODULE_IDS) {
        completed.add(id);
        $set[`modules.${id}.status`] = 'completed';
        $set[`modules.${id}.progressPercent`] = 100;
        $set[`modules.${id}.completedAt`] = now;
        $set[`modules.${id}.unlockedAt`] = now;
      }
    } else if (bulkAction === 'reset') {
      completed.clear();
      for (const id of ALL_MODULE_IDS) {
        $set[`modules.${id}.status`] = id === 'intro' ? 'unlocked' : 'locked';
        $set[`modules.${id}.progressPercent`] = 0;
        $set[`modules.${id}.completedAt`] = null;
        $set[`modules.${id}.unlockedAt`] = id === 'intro' ? now : null;
        $set[`modules.${id}.watchedSeconds`] = 0;
        $set[`modules.${id}.maxWatchedSeconds`] = 0;
        $set[`modules.${id}.score`] = null;
        $set[`modules.${id}.totalScore`] = null;
      }
    } else if (moduleUpdates && typeof moduleUpdates === 'object') {
      for (const [moduleId, action] of Object.entries(moduleUpdates)) {
        if (!ALL_MODULE_IDS.includes(moduleId)) continue;

        if (action === 'complete') {
          completed.add(moduleId);
          $set[`modules.${moduleId}.status`] = 'completed';
          $set[`modules.${moduleId}.progressPercent`] = 100;
          $set[`modules.${moduleId}.completedAt`] = now;
          const prev = existing?.modules?.[moduleId];
          $set[`modules.${moduleId}.unlockedAt`] = prev?.unlockedAt || now;
        } else if (action === 'uncomplete') {
          completed.delete(moduleId);
          $set[`modules.${moduleId}.status`] = 'unlocked';
          $set[`modules.${moduleId}.progressPercent`] = 0;
          $set[`modules.${moduleId}.completedAt`] = null;
        }
      }
    } else {
      return res.status(400).json({ success: false, message: 'Provide moduleUpdates or bulkAction.' });
    }

    const completedArr = Array.from(completed);
    $set.completedModules = completedArr;
    $set.overallPercent = Math.round((completedArr.length / ALL_MODULE_IDS.length) * 100);

    const updated = await WebinarProgress.findOneAndUpdate(
      { phone },
      { $set },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: updated });
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
  recordCertificateDownload,
  adminListProgress,
  adminProgressStats,
  adminProgressDetail,
  adminAssessmentDetail,
  adminUpdateProgress,
  adminProgressExport,
};
