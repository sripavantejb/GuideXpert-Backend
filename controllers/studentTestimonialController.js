const StudentTestimonial = require('../models/StudentTestimonial');

function cleanColleges(raw) {
  if (!Array.isArray(raw)) {
    if (typeof raw === 'string') {
      return raw
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8);
    }
    return [];
  }
  return raw
    .map((c) => String(c || '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function toAdminItem(doc) {
  return {
    id: doc._id.toString(),
    studentName: doc.studentName || '',
    quote: doc.quote || '',
    rank: doc.rank,
    exam: doc.exam,
    colleges: Array.isArray(doc.colleges) ? doc.colleges : [],
    accuracy: typeof doc.accuracy === 'number' ? doc.accuracy : 95,
    photoUrl: doc.photoUrl || '',
    status: doc.status,
    pinned: !!doc.pinned,
    sortOrder: doc.sortOrder || 0,
    createdBy: doc.createdBy || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toPublicItem(doc) {
  return {
    id: doc._id.toString(),
    studentName: doc.studentName || '',
    quote: doc.quote || '',
    rank: doc.rank,
    exam: doc.exam,
    colleges: Array.isArray(doc.colleges) ? doc.colleges : [],
    accuracy: typeof doc.accuracy === 'number' ? doc.accuracy : 95,
    photoUrl: doc.photoUrl || '',
    pinned: !!doc.pinned,
  };
}

function parseBody(body = {}) {
  const rank = typeof body.rank === 'string' ? body.rank.trim() : '';
  const exam = typeof body.exam === 'string' ? body.exam.trim() : '';
  if (!rank) return { error: 'rank is required' };
  if (!exam) return { error: 'exam is required' };

  const colleges = cleanColleges(body.colleges);
  if (!colleges.length) return { error: 'At least one college is required' };

  let accuracy = Number(body.accuracy);
  if (!Number.isFinite(accuracy)) accuracy = 95;
  accuracy = Math.min(100, Math.max(0, Math.round(accuracy)));

  return {
    data: {
      studentName: typeof body.studentName === 'string' ? body.studentName.trim().slice(0, 80) : '',
      quote: typeof body.quote === 'string' ? body.quote.trim().slice(0, 800) : '',
      rank: rank.slice(0, 80),
      exam: exam.slice(0, 120),
      colleges,
      accuracy,
      photoUrl: typeof body.photoUrl === 'string' ? body.photoUrl.trim().slice(0, 800) : '',
      status: body.status === 'published' ? 'published' : 'draft',
      pinned: body.pinned === true,
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    },
  };
}

exports.adminList = async (req, res) => {
  try {
    const { status } = req.query || {};
    const filter = {};
    if (status === 'draft' || status === 'published') filter.status = status;
    const list = await StudentTestimonial.find(filter)
      .sort({ pinned: -1, sortOrder: 1, createdAt: -1 })
      .lean();
    return res.json({ success: true, data: list.map(toAdminItem) });
  } catch (err) {
    console.error('[StudentTestimonial] adminList:', err);
    return res.status(500).json({ success: false, message: 'Failed to list testimonials' });
  }
};

exports.adminGetOne = async (req, res) => {
  try {
    const doc = await StudentTestimonial.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Testimonial not found' });
    return res.json({ success: true, data: toAdminItem(doc) });
  } catch (err) {
    console.error('[StudentTestimonial] adminGetOne:', err);
    return res.status(500).json({ success: false, message: 'Failed to load testimonial' });
  }
};

exports.adminCreate = async (req, res) => {
  try {
    const parsed = parseBody(req.body);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });
    const createdBy =
      req.admin?.email || req.admin?.name || req.admin?.phone || req.user?.email || '';
    const created = await StudentTestimonial.create({
      ...parsed.data,
      createdBy: String(createdBy).slice(0, 120),
    });
    return res.status(201).json({ success: true, data: toAdminItem(created.toObject()) });
  } catch (err) {
    console.error('[StudentTestimonial] adminCreate:', err);
    return res.status(500).json({ success: false, message: 'Failed to create testimonial' });
  }
};

exports.adminUpdate = async (req, res) => {
  try {
    const existing = await StudentTestimonial.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Testimonial not found' });

    const parsed = parseBody({
      studentName: req.body?.studentName ?? existing.studentName,
      quote: req.body?.quote ?? existing.quote,
      rank: req.body?.rank ?? existing.rank,
      exam: req.body?.exam ?? existing.exam,
      colleges: req.body?.colleges ?? existing.colleges,
      accuracy: req.body?.accuracy ?? existing.accuracy,
      photoUrl: req.body?.photoUrl ?? existing.photoUrl,
      status: req.body?.status ?? existing.status,
      pinned: req.body?.pinned ?? existing.pinned,
      sortOrder: req.body?.sortOrder ?? existing.sortOrder,
    });
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    Object.assign(existing, parsed.data);
    await existing.save();
    return res.json({ success: true, data: toAdminItem(existing.toObject()) });
  } catch (err) {
    console.error('[StudentTestimonial] adminUpdate:', err);
    return res.status(500).json({ success: false, message: 'Failed to update testimonial' });
  }
};

exports.adminDelete = async (req, res) => {
  try {
    const deleted = await StudentTestimonial.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Testimonial not found' });
    return res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    console.error('[StudentTestimonial] adminDelete:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete testimonial' });
  }
};

exports.adminPublish = async (req, res) => {
  try {
    const doc = await StudentTestimonial.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Testimonial not found' });
    doc.status = 'published';
    await doc.save();
    return res.json({ success: true, data: toAdminItem(doc.toObject()) });
  } catch (err) {
    console.error('[StudentTestimonial] adminPublish:', err);
    return res.status(500).json({ success: false, message: 'Failed to publish' });
  }
};

exports.adminUnpublish = async (req, res) => {
  try {
    const doc = await StudentTestimonial.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Testimonial not found' });
    doc.status = 'draft';
    await doc.save();
    return res.json({ success: true, data: toAdminItem(doc.toObject()) });
  } catch (err) {
    console.error('[StudentTestimonial] adminUnpublish:', err);
    return res.status(500).json({ success: false, message: 'Failed to unpublish' });
  }
};

exports.publicList = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const list = await StudentTestimonial.find({ status: 'published' })
      .sort({ pinned: -1, sortOrder: 1, createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ success: true, data: { items: list.map(toPublicItem) } });
  } catch (err) {
    console.error('[StudentTestimonial] publicList:', err);
    return res.status(500).json({ success: false, message: 'Failed to load testimonials' });
  }
};
