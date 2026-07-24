const StudentWorkspaceUpdate = require('../models/StudentWorkspaceUpdate');
const { CATEGORIES } = require('../models/StudentWorkspaceUpdate');

function isExpired(doc, now = new Date()) {
  return Boolean(doc.expiresAt && new Date(doc.expiresAt) < now);
}

function toAdminItem(doc) {
  const expired = isExpired(doc);
  return {
    id: doc._id.toString(),
    title: doc.title,
    summary: doc.summary,
    category: doc.category,
    tag: doc.tag || '',
    linkUrl: doc.linkUrl || '',
    linkLabel: doc.linkLabel || 'Learn more',
    imageUrl: doc.imageUrl || '',
    priority: doc.priority,
    status: doc.status === 'published' && expired ? 'expired' : doc.status,
    pinned: !!doc.pinned,
    showInNavbar: doc.showInNavbar !== false,
    showOnHome: doc.showOnHome !== false,
    publishedAt: doc.publishedAt || null,
    expiresAt: doc.expiresAt || null,
    createdBy: doc.createdBy || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toPublicItem(doc) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    summary: doc.summary,
    category: doc.category,
    tag: doc.tag || categoryLabel(doc.category),
    linkUrl: doc.linkUrl || '',
    linkLabel: doc.linkLabel || 'Learn more',
    imageUrl: doc.imageUrl || '',
    priority: doc.priority,
    pinned: !!doc.pinned,
    showInNavbar: doc.showInNavbar !== false,
    showOnHome: doc.showOnHome !== false,
    publishedAt: doc.publishedAt || doc.createdAt,
  };
}

function categoryLabel(category) {
  const map = {
    exam: 'Exam',
    admission: 'Admission',
    deadline: 'Deadline',
    tool: 'Tools',
    counselling: 'Counselling',
    general: 'Update',
  };
  return map[category] || 'Update';
}

function parseBody(body = {}) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (!title) return { error: 'title is required' };
  if (!summary) return { error: 'summary is required' };

  const category = CATEGORIES.includes(body.category) ? body.category : 'general';
  const priority = ['normal', 'important', 'urgent'].includes(body.priority)
    ? body.priority
    : 'normal';
  const status = body.status === 'published' ? 'published' : 'draft';

  return {
    data: {
      title,
      summary,
      category,
      tag: typeof body.tag === 'string' ? body.tag.trim().slice(0, 40) : '',
      linkUrl: typeof body.linkUrl === 'string' ? body.linkUrl.trim().slice(0, 500) : '',
      linkLabel:
        typeof body.linkLabel === 'string' && body.linkLabel.trim()
          ? body.linkLabel.trim().slice(0, 80)
          : 'Learn more',
      imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl.trim().slice(0, 800) : '',
      priority,
      status,
      pinned: body.pinned === true,
      showInNavbar: body.showInNavbar !== false,
      showOnHome: body.showOnHome !== false,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      publishedAt:
        status === 'published'
          ? body.publishedAt
            ? new Date(body.publishedAt)
            : new Date()
          : null,
    },
  };
}

exports.adminList = async (req, res) => {
  try {
    const { status } = req.query || {};
    const filter = {};
    if (status === 'draft' || status === 'published') filter.status = status;
    const list = await StudentWorkspaceUpdate.find(filter).sort({ updatedAt: -1 }).lean();
    return res.json({ success: true, data: list.map(toAdminItem) });
  } catch (err) {
    console.error('[StudentWorkspaceUpdate] adminList:', err);
    return res.status(500).json({ success: false, message: 'Failed to list updates' });
  }
};

exports.adminGetOne = async (req, res) => {
  try {
    const doc = await StudentWorkspaceUpdate.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Update not found' });
    return res.json({ success: true, data: toAdminItem(doc) });
  } catch (err) {
    console.error('[StudentWorkspaceUpdate] adminGetOne:', err);
    return res.status(500).json({ success: false, message: 'Failed to load update' });
  }
};

exports.adminCreate = async (req, res) => {
  try {
    const parsed = parseBody(req.body);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
    const createdBy =
      req.admin?.email || req.admin?.name || req.admin?.phone || req.user?.email || '';
    const created = await StudentWorkspaceUpdate.create({
      ...parsed.data,
      createdBy: String(createdBy).slice(0, 120),
    });
    return res.status(201).json({ success: true, data: toAdminItem(created.toObject()) });
  } catch (err) {
    console.error('[StudentWorkspaceUpdate] adminCreate:', err);
    return res.status(500).json({ success: false, message: 'Failed to create update' });
  }
};

exports.adminUpdate = async (req, res) => {
  try {
    const existing = await StudentWorkspaceUpdate.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Update not found' });

    const parsed = parseBody({
      title: req.body?.title ?? existing.title,
      summary: req.body?.summary ?? existing.summary,
      category: req.body?.category ?? existing.category,
      tag: req.body?.tag ?? existing.tag,
      linkUrl: req.body?.linkUrl ?? existing.linkUrl,
      linkLabel: req.body?.linkLabel ?? existing.linkLabel,
      imageUrl: req.body?.imageUrl ?? existing.imageUrl,
      priority: req.body?.priority ?? existing.priority,
      status: req.body?.status ?? existing.status,
      pinned: req.body?.pinned ?? existing.pinned,
      showInNavbar: req.body?.showInNavbar ?? existing.showInNavbar,
      showOnHome: req.body?.showOnHome ?? existing.showOnHome,
      expiresAt:
        req.body?.expiresAt === undefined
          ? existing.expiresAt
          : req.body.expiresAt || null,
      publishedAt: existing.publishedAt,
    });
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    const next = parsed.data;
    if (next.status === 'published' && existing.status !== 'published') {
      next.publishedAt = new Date();
    }
    if (next.status === 'draft') {
      next.publishedAt = existing.publishedAt;
    }

    Object.assign(existing, next);
    await existing.save();
    return res.json({ success: true, data: toAdminItem(existing.toObject()) });
  } catch (err) {
    console.error('[StudentWorkspaceUpdate] adminUpdate:', err);
    return res.status(500).json({ success: false, message: 'Failed to update' });
  }
};

exports.adminDelete = async (req, res) => {
  try {
    const deleted = await StudentWorkspaceUpdate.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Update not found' });
    return res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    console.error('[StudentWorkspaceUpdate] adminDelete:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete update' });
  }
};

exports.adminPublish = async (req, res) => {
  try {
    const doc = await StudentWorkspaceUpdate.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Update not found' });
    doc.status = 'published';
    doc.publishedAt = new Date();
    await doc.save();
    return res.json({ success: true, data: toAdminItem(doc.toObject()) });
  } catch (err) {
    console.error('[StudentWorkspaceUpdate] adminPublish:', err);
    return res.status(500).json({ success: false, message: 'Failed to publish update' });
  }
};

exports.adminUnpublish = async (req, res) => {
  try {
    const doc = await StudentWorkspaceUpdate.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Update not found' });
    doc.status = 'draft';
    await doc.save();
    return res.json({ success: true, data: toAdminItem(doc.toObject()) });
  } catch (err) {
    console.error('[StudentWorkspaceUpdate] adminUnpublish:', err);
    return res.status(500).json({ success: false, message: 'Failed to unpublish update' });
  }
};

/** Public feed for student workspace (navbar + home). */
exports.publicList = async (req, res) => {
  try {
    const now = new Date();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const placement = req.query.placement; // navbar | home | all

    const filter = {
      status: 'published',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    };
    if (placement === 'navbar') filter.showInNavbar = true;
    if (placement === 'home') filter.showOnHome = true;

    const list = await StudentWorkspaceUpdate.find(filter)
      .sort({ pinned: -1, publishedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      data: {
        items: list.map(toPublicItem),
        categories: CATEGORIES,
      },
    });
  } catch (err) {
    console.error('[StudentWorkspaceUpdate] publicList:', err);
    return res.status(500).json({ success: false, message: 'Failed to load updates' });
  }
};

exports.CATEGORIES = CATEGORIES;
