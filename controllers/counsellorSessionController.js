const CounsellingSession = require('../models/CounsellingSession');
const Student = require('../models/Student');

/**
 * GET /api/counsellor/sessions
 * List sessions for the logged-in counsellor. Query: status, from, to
 */
exports.list = async (req, res) => {
  try {
    const counsellorId = req.counsellor._id;
    const { status, from, to } = req.query || {};
    const filter = { counsellorId };

    if (status && ['upcoming', 'completed', 'cancelled'].includes(status)) {
      filter.status = status;
    }
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) filter.scheduledAt = { ...filter.scheduledAt, $gte: fromDate };
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        filter.scheduledAt = { ...filter.scheduledAt, $lte: toDate };
      }
    }

    const sessions = await CounsellingSession.find(filter)
      .sort({ scheduledAt: -1 })
      .lean()
      .exec();

    return res.json(sessions);
  } catch (error) {
    console.error('[counsellorSessionController.list]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * POST /api/counsellor/sessions
 * Body: studentId (optional), studentName (optional), purpose, scheduledAt, platform, meetingLink
 */
exports.create = async (req, res) => {
  try {
    const counsellorId = req.counsellor._id;
    const body = req.body || {};
    const { studentId, studentName, purpose, scheduledAt, platform, meetingLink } = body;

    if (!purpose || typeof purpose !== 'string' || !purpose.trim()) {
      return res.status(400).json({ success: false, message: 'purpose is required' });
    }
    const scheduled = scheduledAt ? new Date(scheduledAt) : null;
    if (!scheduled || isNaN(scheduled.getTime())) {
      return res.status(400).json({ success: false, message: 'scheduledAt is required and must be a valid date' });
    }

    let displayName = (studentName && typeof studentName === 'string') ? studentName.trim() : '';
    if (studentId && !displayName) {
      const student = await Student.findOne({ _id: studentId, counsellorId }).lean().exec();
      if (student) displayName = student.fullName || '';
    }

    const session = await CounsellingSession.create({
      counsellorId,
      studentId: studentId || null,
      studentName: displayName || 'Student',
      purpose: purpose.trim(),
      scheduledAt: scheduled,
      platform: (platform && ['Google Meet', 'Zoom', 'Other'].includes(platform)) ? platform : 'Google Meet',
      meetingLink: (meetingLink && typeof meetingLink === 'string') ? meetingLink.trim() : '',
      status: 'upcoming',
    });

    return res.status(201).json(session);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg });
    }
    console.error('[counsellorSessionController.create]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * PATCH /api/counsellor/sessions/:id
 */
exports.update = async (req, res) => {
  try {
    const counsellorId = req.counsellor._id;
    const session = await CounsellingSession.findOne({ _id: req.params.id, counsellorId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const body = req.body || {};
    const allowed = ['studentId', 'studentName', 'purpose', 'scheduledAt', 'platform', 'meetingLink', 'status'];
    for (const key of allowed) {
      if (body[key] !== undefined) {
        if (key === 'scheduledAt') session.scheduledAt = new Date(body[key]);
        else if (key === 'status' && ['upcoming', 'completed', 'cancelled'].includes(body[key])) session.status = body[key];
        else if (key === 'platform' && ['Google Meet', 'Zoom', 'Other'].includes(body[key])) session.platform = body[key];
        else if (typeof body[key] === 'string') session[key] = body[key].trim();
        else if (key === 'studentId') session.studentId = body[key] || null;
      }
    }

    await session.save();
    return res.json(session);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg });
    }
    console.error('[counsellorSessionController.update]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * DELETE /api/counsellor/sessions/:id
 */
exports.remove = async (req, res) => {
  try {
    const counsellorId = req.counsellor._id;
    const session = await CounsellingSession.findOneAndDelete({ _id: req.params.id, counsellorId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    return res.status(204).send();
  } catch (error) {
    console.error('[counsellorSessionController.remove]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
