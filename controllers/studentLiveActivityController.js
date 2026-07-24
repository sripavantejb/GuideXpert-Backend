const StudentLiveActivity = require('../models/StudentLiveActivity');

const SKIP_TYPES = new Set(['profile_update', 'login', 'signup']);

function firstDisplayName(fullName) {
  const raw = String(fullName || '').trim();
  if (!raw) return 'A student';
  const first = raw.split(/\s+/).filter(Boolean)[0] || 'A student';
  const cleaned = first.replace(/[^a-zA-Z.'-]/g, '').slice(0, 24);
  if (!cleaned) return 'A student';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function toolLabelFromActivity(activity = {}) {
  const tool = String(activity.tool || '').trim();
  if (tool && !/^prediction$/i.test(tool)) return tool.slice(0, 80);
  const type = String(activity.type || '').trim();
  const map = {
    rank_predictor: 'Rank Predictor',
    college_predictor: 'College Predictor',
    branch_predictor: 'Branch Predictor',
    exam_predictor: 'Exam Predictor',
    college_comparison: 'College Comparison',
    course_fit: 'Course Fit Test',
    college_fit: 'College Fit Test',
    counselling_booking: 'IITian counselling session',
    one_on_one_counselling: 'IITian counselling session',
  };
  if (map[type]) return map[type];
  if (type) {
    return type
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .slice(0, 80);
  }
  return 'GuideXpert tools';
}

function resolveAction(activity = {}) {
  const type = String(activity?.type || '').trim();
  const action = String(activity?.action || '').trim();
  if (action === 'booked' || action === 'used') return action;
  if (
    type === 'counselling_booking' ||
    type === 'one_on_one_counselling' ||
    /book/i.test(String(activity?.title || ''))
  ) {
    return 'booked';
  }
  return 'used';
}

/**
 * Fire-and-forget write for hero live toast feed.
 */
async function recordStudentLiveActivity({ fullName, activity }) {
  try {
    const type = String(activity?.type || '').trim();
    if (SKIP_TYPES.has(type)) return null;
    const displayName = firstDisplayName(fullName);
    const toolLabel = toolLabelFromActivity(activity);
    const action = resolveAction(activity);
    const doc = await StudentLiveActivity.create({
      displayName,
      toolLabel,
      toolKey: type || String(activity?.tool || '').slice(0, 64),
      action,
    });
    // Keep collection lean
    const count = await StudentLiveActivity.countDocuments();
    if (count > 500) {
      const old = await StudentLiveActivity.find()
        .sort({ createdAt: 1 })
        .limit(Math.max(0, count - 400))
        .select('_id')
        .lean();
      if (old.length) {
        await StudentLiveActivity.deleteMany({ _id: { $in: old.map((o) => o._id) } });
      }
    }
    return doc;
  } catch (err) {
    console.error('[recordStudentLiveActivity]', err.message);
    return null;
  }
}

function relativeLabel(date) {
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 15_000) return 'just now';
  if (ms < 60_000) return 'moments ago';
  if (ms < 3_600_000) {
    const m = Math.max(1, Math.floor(ms / 60_000));
    return `${m} min ago`;
  }
  if (ms < 86_400_000) {
    const h = Math.max(1, Math.floor(ms / 3_600_000));
    return `${h}h ago`;
  }
  return 'recently';
}

exports.recordStudentLiveActivity = recordStudentLiveActivity;
exports.firstDisplayName = firstDisplayName;

exports.publicLiveFeed = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 40);
    const sinceMs = Math.min(Math.max(parseInt(req.query.sinceHours, 10) || 48, 1), 168) * 3600_000;
    const since = new Date(Date.now() - sinceMs);

    const list = await StudentLiveActivity.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      data: {
        items: list.map((row) => {
          const action =
            row.action ||
            (row.toolKey === 'counselling_booking' || row.toolKey === 'one_on_one_counselling'
              ? 'booked'
              : 'used');
          return {
            id: row._id.toString(),
            name: row.displayName,
            tool: row.toolLabel,
            action,
            when: relativeLabel(row.createdAt),
            at: row.createdAt,
          };
        }),
      },
    });
  } catch (err) {
    console.error('[StudentLiveActivity] publicLiveFeed:', err);
    return res.status(500).json({ success: false, message: 'Failed to load live activity' });
  }
};
