const Announcement = require('../models/Announcement');
const AnnouncementRead = require('../models/AnnouncementRead');

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
    const items = list.map((a) => ({
      id: a._id != null ? a._id.toString() : a._id,
      title: a.title,
      preview: stripHtml(a.description),
      priority: a.priority,
      status: getStatus(a),
      expiryDate: a.expiryDate || null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));
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
    const { title, description, priority, expiryDate, status } = req.body || {};
    if (title !== undefined) announcement.title = typeof title === 'string' ? title.trim() : announcement.title;
    if (description !== undefined) announcement.description = typeof description === 'string' ? description : announcement.description;
    if (priority !== undefined && ['normal', 'important', 'urgent'].includes(priority)) announcement.priority = priority;
    if (expiryDate !== undefined) announcement.expiryDate = expiryDate ? new Date(expiryDate) : null;
    if (status !== undefined && ['draft', 'published'].includes(status)) announcement.status = status;
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
