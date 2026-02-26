const Announcement = require('../models/Announcement');
const AnnouncementRead = require('../models/AnnouncementRead');
const Counsellor = require('../models/Counsellor');

function stripHtml(html, maxLen = 80) {
  if (!html || typeof html !== 'string') return '';
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

function getStatus(announcement) {
  if (announcement.status !== 'published') return announcement.status;
  if (announcement.expiryDate && new Date(announcement.expiryDate) < new Date()) return 'expired';
  return 'published';
}

// —— Admin ——

exports.adminList = async (req, res) => {
  try {
    const { status } = req.query || {};
    const filter = {};
    if (status === 'draft' || status === 'published') filter.status = status;

    const list = await Announcement.find(filter).sort({ createdAt: -1 }).lean();
    const announcementIds = list.map((a) => a._id);
    const engagement = await AnnouncementRead.aggregate([
      { $match: { announcement: { $in: announcementIds } } },
      {
        $group: {
          _id: '$announcement',
          viewCount: { $sum: 1 },
          helpful: { $sum: { $cond: [{ $eq: ['$reactionType', 'helpful'] }, 1, 0] } },
          appreciated: { $sum: { $cond: [{ $eq: ['$reactionType', 'appreciated'] }, 1, 0] } },
          great: { $sum: { $cond: [{ $eq: ['$reactionType', 'great'] }, 1, 0] } },
          important: { $sum: { $cond: [{ $eq: ['$reactionType', 'important'] }, 1, 0] } },
          acknowledgedCount: { $sum: { $cond: ['$acknowledged', 1, 0] } },
        },
      },
    ]);
    const engagementMap = {};
    engagement.forEach((e) => {
      engagementMap[e._id.toString()] = {
        viewCount: e.viewCount,
        reactionCounts: { helpful: e.helpful, appreciated: e.appreciated, great: e.great, important: e.important },
        acknowledgedCount: e.acknowledgedCount,
      };
    });
    const items = list.map((a) => {
      const eng = engagementMap[a._id.toString()] || { viewCount: 0, reactionCounts: { helpful: 0, appreciated: 0, great: 0, important: 0 }, acknowledgedCount: 0 };
      return {
        id: a._id != null ? a._id.toString() : a._id,
        title: a.title,
        preview: stripHtml(a.description),
        priority: a.priority,
        status: getStatus(a),
        expiryDate: a.expiryDate || null,
        pinned: !!a.pinned,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        viewCount: eng.viewCount,
        reactionCounts: eng.reactionCounts,
        acknowledgedCount: eng.acknowledgedCount,
      };
    });
    return res.json({ success: true, data: items });
  } catch (err) {
    console.error('[Announcement] adminList:', err);
    return res.status(500).json({ success: false, message: 'Failed to list announcements' });
  }
};

exports.adminCreate = async (req, res) => {
  try {
    const { title, description, priority, expiryDate, status } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'title is required' });
    }
    const doc = {
      title: title.trim(),
      description: typeof description === 'string' ? description : '',
      priority: ['normal', 'important', 'urgent'].includes(priority) ? priority : 'normal',
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      status: status === 'published' ? 'published' : 'draft',
      pinned: false,
    };
    const created = await Announcement.create(doc);
    return res.status(201).json({
      success: true,
      data: {
        id: created._id != null ? created._id.toString() : created._id,
        title: created.title,
        preview: stripHtml(created.description),
        priority: created.priority,
        status: created.status,
        expiryDate: created.expiryDate || null,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    });
  } catch (err) {
    console.error('[Announcement] adminCreate:', err);
    return res.status(500).json({ success: false, message: 'Failed to create announcement' });
  }
};

exports.adminGetOne = async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id).lean();
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    return res.json({
      success: true,
      data: {
        id: announcement._id != null ? announcement._id.toString() : announcement._id,
        title: announcement.title,
        description: announcement.description,
        priority: announcement.priority,
        status: getStatus(announcement),
        expiryDate: announcement.expiryDate || null,
        pinned: !!announcement.pinned,
        createdAt: announcement.createdAt,
        updatedAt: announcement.updatedAt,
      },
    });
  } catch (err) {
    console.error('[Announcement] adminGetOne:', err);
    return res.status(500).json({ success: false, message: 'Failed to get announcement' });
  }
};

exports.adminUpdate = async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    const { title, description, priority, expiryDate, status, pinned } = req.body || {};
    if (title !== undefined) announcement.title = typeof title === 'string' ? title.trim() : announcement.title;
    if (description !== undefined) announcement.description = typeof description === 'string' ? description : announcement.description;
    if (priority !== undefined && ['normal', 'important', 'urgent'].includes(priority)) announcement.priority = priority;
    if (expiryDate !== undefined) announcement.expiryDate = expiryDate ? new Date(expiryDate) : null;
    if (status !== undefined && ['draft', 'published'].includes(status)) announcement.status = status;
    if (pinned !== undefined && typeof pinned === 'boolean') announcement.pinned = pinned;
    await announcement.save();
    return res.json({
      success: true,
      data: {
        id: announcement._id != null ? announcement._id.toString() : announcement._id,
        title: announcement.title,
        preview: stripHtml(announcement.description),
        priority: announcement.priority,
        status: getStatus(announcement),
        expiryDate: announcement.expiryDate || null,
        pinned: announcement.pinned,
        createdAt: announcement.createdAt,
        updatedAt: announcement.updatedAt,
      },
    });
  } catch (err) {
    console.error('[Announcement] adminUpdate:', err);
    return res.status(500).json({ success: false, message: 'Failed to update announcement' });
  }
};

exports.adminDelete = async (req, res) => {
  try {
    const deleted = await Announcement.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    await AnnouncementRead.deleteMany({ announcement: deleted._id });
    return res.json({ success: true, message: 'Announcement deleted' });
  } catch (err) {
    console.error('[Announcement] adminDelete:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete announcement' });
  }
};

exports.adminAnalytics = async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id).lean();
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    const totalCounsellors = await Counsellor.countDocuments();
    const reads = await AnnouncementRead.find({ announcement: announcement._id })
      .populate('counsellor', 'name')
      .sort({ readAt: -1 })
      .lean();
    const viewCount = reads.length;
    const reactionCounts = { helpful: 0, appreciated: 0, great: 0, important: 0 };
    const reactions = { helpful: [], appreciated: [], great: [], important: [] };
    let acknowledgedCount = 0;
    const viewedBy = reads.map((r) => {
      if (r.reactionType && reactions[r.reactionType]) {
        reactionCounts[r.reactionType]++;
        reactions[r.reactionType].push({ name: r.counsellor?.name ?? 'Unknown' });
      }
      if (r.acknowledged) acknowledgedCount++;
      return {
        counsellorId: r.counsellor?._id?.toString(),
        name: r.counsellor?.name ?? 'Unknown',
        readAt: r.readAt,
        reactionType: r.reactionType || null,
        acknowledged: !!r.acknowledged,
      };
    });
    const viewedCounsellorIds = new Set(reads.map((r) => String(r.counsellor?._id ?? r.counsellor)).filter(Boolean));
    const allCounsellors = await Counsellor.find({}).select('name').lean();
    const notViewedBy = allCounsellors.filter((c) => !viewedCounsellorIds.has(String(c._id))).map((c) => ({ counsellorId: c._id.toString(), name: c.name ?? 'Unknown' }));
    const totalReactions = Object.values(reactionCounts).reduce((s, n) => s + n, 0);
    const engagementRate = totalCounsellors > 0 ? Math.round((viewCount / totalCounsellors) * 100) : 0;
    return res.json({
      success: true,
      data: {
        viewCount,
        totalReactions,
        reactionCounts,
        acknowledgedCount,
        engagementRate,
        totalCounsellors,
        viewedBy,
        notViewedBy,
        reactions,
      },
    });
  } catch (err) {
    console.error('[Announcement] adminAnalytics:', err);
    return res.status(500).json({ success: false, message: 'Failed to load analytics' });
  }
};

exports.adminPublish = async (req, res) => {
  try {
    const announcement = await Announcement.findByIdAndUpdate(
      req.params.id,
      { status: 'published' },
      { new: true }
    );
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    return res.json({
      success: true,
      data: {
        id: announcement._id != null ? announcement._id.toString() : announcement._id,
        status: getStatus(announcement),
        updatedAt: announcement.updatedAt,
      },
    });
  } catch (err) {
    console.error('[Announcement] adminPublish:', err);
    return res.status(500).json({ success: false, message: 'Failed to publish announcement' });
  }
};

exports.adminUnpublish = async (req, res) => {
  try {
    const announcement = await Announcement.findByIdAndUpdate(
      req.params.id,
      { status: 'draft' },
      { new: true }
    );
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    return res.json({
      success: true,
      data: {
        id: announcement._id != null ? announcement._id.toString() : announcement._id,
        status: 'draft',
        updatedAt: announcement.updatedAt,
      },
    });
  } catch (err) {
    console.error('[Announcement] adminUnpublish:', err);
    return res.status(500).json({ success: false, message: 'Failed to unpublish announcement' });
  }
};

// —— Counsellor ——

const REACTION_TYPES = ['helpful', 'appreciated', 'great', 'important'];

exports.counsellorFeed = async (req, res) => {
  try {
    const counsellorId = req.counsellor._id;
    const { filter: filterParam, q, page = 1, limit = 20 } = req.query || {};
    const now = new Date();
    const baseQuery = filterParam === 'archived'
      ? { status: 'published', expiryDate: { $ne: null, $lt: now } }
      : { status: 'published', $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }] };
    let query = baseQuery;
    if (q && typeof q === 'string' && q.trim()) {
      const search = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query = { $and: [baseQuery, { $or: [{ title: search }, { description: search }] }] };
    }
    const limitNum = Math.min(50, Math.max(1, Number(limit) || 20));
    const skip = Math.max(0, ((Number(page) || 1) - 1) * limitNum);
    let list = await Announcement.find(query).sort({ pinned: -1, createdAt: -1 }).skip(skip).limit(limitNum).lean();
    if (filterParam !== 'archived' && filterParam === 'unread') {
      const readIds = await AnnouncementRead.find({ counsellor: counsellorId, announcement: { $in: list.map((a) => a._id) } }).distinct('announcement').then((ids) => new Set(ids.map(String)));
      list = list.filter((a) => !readIds.has(String(a._id)));
    } else if (filterParam !== 'archived' && (filterParam === 'important' || filterParam === 'urgent')) {
      list = list.filter((a) => a.priority === filterParam);
    }
    const announcementIds = list.map((a) => a._id);
    const readDocs = await AnnouncementRead.find({ counsellor: counsellorId, announcement: { $in: announcementIds } }).lean();
    const readMap = {};
    readDocs.forEach((r) => {
      readMap[r.announcement.toString()] = { read: true, readAt: r.readAt, reactionType: r.reactionType || null, acknowledged: !!r.acknowledged };
    });
    const engagement = await AnnouncementRead.aggregate([
      { $match: { announcement: { $in: announcementIds } } },
      {
        $group: {
          _id: '$announcement',
          viewCount: { $sum: 1 },
          helpful: { $sum: { $cond: [{ $eq: ['$reactionType', 'helpful'] }, 1, 0] } },
          appreciated: { $sum: { $cond: [{ $eq: ['$reactionType', 'appreciated'] }, 1, 0] } },
          great: { $sum: { $cond: [{ $eq: ['$reactionType', 'great'] }, 1, 0] } },
          important: { $sum: { $cond: [{ $eq: ['$reactionType', 'important'] }, 1, 0] } },
        },
      },
    ]);
    const engagementMap = {};
    engagement.forEach((e) => {
      engagementMap[e._id.toString()] = {
        viewCount: e.viewCount,
        reactionCounts: { helpful: e.helpful, appreciated: e.appreciated, great: e.great, important: e.important },
      };
    });
    const items = list.map((a) => {
      const rid = a._id.toString();
      const my = readMap[rid] || { read: false, readAt: null, reactionType: null, acknowledged: false };
      const eng = engagementMap[rid] || { viewCount: 0, reactionCounts: { helpful: 0, appreciated: 0, great: 0, important: 0 } };
      const totalReactions = Object.values(eng.reactionCounts).reduce((s, n) => s + n, 0);
      return {
        id: rid,
        title: a.title,
        description: a.description || '',
        priority: a.priority,
        pinned: !!a.pinned,
        createdAt: a.createdAt,
        read: my.read,
        readAt: my.readAt,
        reactionType: my.reactionType,
        acknowledged: my.acknowledged,
        viewCount: eng.viewCount,
        reactionCounts: eng.reactionCounts,
        reactionCount: totalReactions,
        expired: !!(a.expiryDate && new Date(a.expiryDate) < new Date()),
      };
    });
    return res.json({ success: true, data: items });
  } catch (err) {
    console.error('[Announcement] counsellorFeed:', err);
    return res.status(500).json({ success: false, message: 'Failed to load feed' });
  }
};

exports.counsellorReact = async (req, res) => {
  try {
    const now = new Date();
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      status: 'published',
      $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
    });
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    const { reactionType } = req.body || {};
    const filter = { announcement: announcement._id, counsellor: req.counsellor._id };
    let doc;
    if (reactionType && REACTION_TYPES.includes(reactionType)) {
      doc = await AnnouncementRead.findOneAndUpdate(
        filter,
        { $set: { reactionType, readAt: new Date() } },
        { upsert: true, new: true }
      );
    } else {
      doc = await AnnouncementRead.findOneAndUpdate(
        filter,
        { $unset: { reactionType: 1 }, $set: { readAt: new Date() } },
        { new: true }
      );
    }
    const reactionCounts = await AnnouncementRead.aggregate([
      { $match: { announcement: announcement._id } },
      { $group: { _id: '$reactionType', count: { $sum: 1 } } },
    ]);
    const counts = { helpful: 0, appreciated: 0, great: 0, important: 0 };
    reactionCounts.forEach((r) => {
      if (r._id && counts[r._id] !== undefined) counts[r._id] = r.count;
    });
    return res.json({
      success: true,
      data: {
        reactionType: (doc && doc.reactionType) || null,
        reactionCounts: counts,
        reactionCount: Object.values(counts).reduce((s, n) => s + n, 0),
      },
    });
  } catch (err) {
    console.error('[Announcement] counsellorReact:', err);
    return res.status(500).json({ success: false, message: 'Failed to set reaction' });
  }
};

exports.counsellorAcknowledge = async (req, res) => {
  try {
    const now = new Date();
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      status: 'published',
      $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
    });
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    await AnnouncementRead.findOneAndUpdate(
      { announcement: announcement._id, counsellor: req.counsellor._id },
      { $set: { acknowledged: true, readAt: new Date() } },
      { upsert: true, new: true }
    );
    return res.json({ success: true, message: 'Acknowledged' });
  } catch (err) {
    console.error('[Announcement] counsellorAcknowledge:', err);
    return res.status(500).json({ success: false, message: 'Failed to acknowledge' });
  }
};

exports.counsellorEngagement = async (req, res) => {
  try {
    const now = new Date();
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      status: 'published',
      $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
    });
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    const reads = await AnnouncementRead.find({ announcement: announcement._id })
      .populate('counsellor', 'name')
      .sort({ readAt: -1 })
      .lean();
    const viewedBy = reads.map((r) => ({
      counsellorId: r.counsellor?._id?.toString() ?? r.counsellor,
      name: r.counsellor?.name ?? 'Unknown',
      readAt: r.readAt,
    }));
    const reactions = { helpful: [], appreciated: [], great: [], important: [] };
    reads.forEach((r) => {
      if (r.reactionType && reactions[r.reactionType]) {
        reactions[r.reactionType].push({
          counsellorId: r.counsellor?._id?.toString() ?? r.counsellor,
          name: r.counsellor?.name ?? 'Unknown',
        });
      }
    });
    return res.json({ success: true, data: { viewedBy, reactions } });
  } catch (err) {
    console.error('[Announcement] counsellorEngagement:', err);
    return res.status(500).json({ success: false, message: 'Failed to load engagement' });
  }
};

exports.counsellorList = async (req, res) => {
  try {
    const counsellorId = req.counsellor._id;
    const now = new Date();
    const announcements = await Announcement.find({
      status: 'published',
      $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
    })
      .sort({ createdAt: -1 })
      .lean();

    const readIds = await AnnouncementRead.find({
      counsellor: counsellorId,
      announcement: { $in: announcements.map((a) => a._id) },
    })
      .distinct('announcement')
      .then((ids) => new Set(ids.map(String)));

    const items = announcements.map((a) => ({
      id: a._id != null ? a._id.toString() : a._id,
      title: a.title,
      preview: stripHtml(a.description, 120),
      priority: a.priority,
      createdAt: a.createdAt,
      read: readIds.has(String(a._id)),
    }));
    return res.json({ success: true, data: items });
  } catch (err) {
    console.error('[Announcement] counsellorList:', err);
    return res.status(500).json({ success: false, message: 'Failed to list announcements' });
  }
};

exports.counsellorGetOne = async (req, res) => {
  try {
    const now = new Date();
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      status: 'published',
      $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
    }).lean();
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    const read = await AnnouncementRead.findOne({
      announcement: announcement._id,
      counsellor: req.counsellor._id,
    }).lean();
    return res.json({
      success: true,
      data: {
        id: announcement._id != null ? announcement._id.toString() : announcement._id,
        title: announcement.title,
        description: announcement.description,
        priority: announcement.priority,
        createdAt: announcement.createdAt,
        read: !!read,
        readAt: read ? read.readAt : null,
      },
    });
  } catch (err) {
    console.error('[Announcement] counsellorGetOne:', err);
    return res.status(500).json({ success: false, message: 'Failed to get announcement' });
  }
};

exports.counsellorMarkRead = async (req, res) => {
  try {
    const now = new Date();
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      status: 'published',
      $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
    });
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    await AnnouncementRead.findOneAndUpdate(
      { announcement: announcement._id, counsellor: req.counsellor._id },
      { readAt: new Date() },
      { upsert: true, new: true }
    );
    return res.json({ success: true, message: 'Marked as read' });
  } catch (err) {
    console.error('[Announcement] counsellorMarkRead:', err);
    return res.status(500).json({ success: false, message: 'Failed to mark as read' });
  }
};

exports.counsellorMarkAllRead = async (req, res) => {
  try {
    const counsellorId = req.counsellor._id;
    const now = new Date();
    const ids = await Announcement.find({
      status: 'published',
      $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
    }).distinct('_id');
    if (ids.length === 0) {
      return res.json({ success: true, count: 0 });
    }
    const bulk = ids.map((_id) => ({
      updateOne: {
        filter: { announcement: _id, counsellor: counsellorId },
        update: { $set: { readAt: new Date() } },
        upsert: true,
      },
    }));
    await AnnouncementRead.bulkWrite(bulk);
    return res.json({ success: true, count: ids.length });
  } catch (err) {
    console.error('[Announcement] counsellorMarkAllRead:', err);
    return res.status(500).json({ success: false, message: 'Failed to mark all as read' });
  }
};
