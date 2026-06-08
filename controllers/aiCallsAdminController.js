const mongoose = require('mongoose');
const AiCallReminder = require('../models/AiCallReminder');
const AiTestCall = require('../models/AiTestCall');
const AiCallReminderActivity = require('../models/AiCallReminderActivity');
const {
  getAiCallsSchedulingMode,
  setAiCallsSchedulingMode,
  AI_CALLS_SCHEDULING_MODES,
} = require('../utils/appSettings');
const { getISTDayRangeFromString } = require('../utils/dateHelpers');
const {
  getPayloadPreview,
  scheduleReminderToOsvi,
  bulkScheduleReminders,
  scheduleAllPending,
  rejectReminder,
  updateReminderFields,
  retryReminder,
  rescheduleReminder,
  cancelReminder,
  deleteReminder,
  previewTestCallPayload,
  createTestCall,
} = require('../services/aiCallReminderService');

function todayIstIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function buildListFilter(query) {
  const filter = query.filter || 'all';
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const mongo = {};

  const now = new Date();
  if (filter === 'pending_approval') {
    mongo.status = 'pending_approval';
  } else if (filter === 'scheduled') {
    mongo.status = 'scheduled';
  } else if (filter === 'completed') {
    mongo.status = 'completed';
  } else if (filter === 'failed') {
    mongo.status = 'failed';
  } else if (filter === 'cancelled') {
    mongo.status = 'cancelled';
  } else if (filter === 'today') {
    const day = todayIstIso();
    mongo.slotDayIst = day;
  } else if (filter === 'upcoming') {
    mongo.callbackTime = { $gte: now };
    mongo.status = { $in: ['pending_approval', 'scheduled', 'processing'] };
  }

  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    mongo.$or = [
      { studentName: regex },
      { phone: regex },
      { class: regex },
      { city: regex },
    ];
  }

  return mongo;
}

exports.getSettings = async (req, res) => {
  try {
    const schedulingMode = await getAiCallsSchedulingMode();
    return res.json({ success: true, data: { schedulingMode } });
  } catch (err) {
    console.error('[aiCalls] getSettings error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load settings.' });
  }
};

exports.patchSettings = async (req, res) => {
  try {
    const { schedulingMode } = req.body || {};
    if (!AI_CALLS_SCHEDULING_MODES.includes(schedulingMode)) {
      return res.status(400).json({
        success: false,
        message: `schedulingMode must be one of: ${AI_CALLS_SCHEDULING_MODES.join(', ')}`,
      });
    }
    const value = await setAiCallsSchedulingMode(schedulingMode);
    return res.json({ success: true, data: { schedulingMode: value } });
  } catch (err) {
    console.error('[aiCalls] patchSettings error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update settings.' });
  }
};

exports.getQueue = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;
    const mongo = { status: 'pending_approval', ...buildListFilter(req.query) };
    delete mongo.status;
    mongo.status = 'pending_approval';

    const [rows, total] = await Promise.all([
      AiCallReminder.find(mongo).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AiCallReminder.countDocuments(mongo),
    ]);

    return res.json({ success: true, rows, total, page, limit });
  } catch (err) {
    console.error('[aiCalls] getQueue error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load queue.' });
  }
};

exports.listReminders = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;
    const mongo = buildListFilter(req.query);

    const [rows, total] = await Promise.all([
      AiCallReminder.find(mongo).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AiCallReminder.countDocuments(mongo),
    ]);

    return res.json({ success: true, rows, total, page, limit });
  } catch (err) {
    console.error('[aiCalls] listReminders error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load reminders.' });
  }
};

exports.getAnalytics = async (req, res) => {
  try {
    const day = todayIstIso();
    const dayRange = getISTDayRangeFromString(day);

    const [statusCounts, testCallsToday, dailySeries] = await Promise.all([
      AiCallReminder.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      dayRange
        ? AiTestCall.countDocuments({ createdAt: { $gte: dayRange.start, $lt: dayRange.end } })
        : AiTestCall.countDocuments({}),
      AiCallReminder.aggregate([
        { $match: { slotDayIst: { $ne: null } } },
        {
          $group: {
            _id: '$slotDayIst',
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            scheduled: { $sum: { $cond: [{ $eq: ['$status', 'scheduled'] }, 1, 0] } },
          },
        },
        { $sort: { _id: -1 } },
        { $limit: 30 },
      ]),
    ]);

    const counts = {};
    for (const row of statusCounts) counts[row._id] = row.count;

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const completed = counts.completed || 0;
    const failed = counts.failed || 0;
    const scheduledCount = counts.scheduled || 0;
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const failureRate = total > 0 ? Math.round((failed / total) * 100) : 0;

    return res.json({
      success: true,
      data: {
        summary: {
          pendingApproval: counts.pending_approval || 0,
          scheduled: scheduledCount,
          completed,
          failed,
          cancelled: counts.cancelled || 0,
          testCallsToday,
          total,
        },
        rates: { successRate, failureRate },
        dailySeries: dailySeries.map((d) => ({
          date: d._id,
          total: d.total,
          completed: d.completed,
          failed: d.failed,
          scheduled: d.scheduled,
        })),
      },
    });
  } catch (err) {
    console.error('[aiCalls] getAnalytics error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load analytics.' });
  }
};

exports.getReminder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id.' });
    }

    const [reminder, logs] = await Promise.all([
      AiCallReminder.findById(id).lean(),
      AiCallReminderActivity.find({ reminderId: id }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);

    if (!reminder) {
      return res.status(404).json({ success: false, message: 'Reminder not found.' });
    }

    return res.json({ success: true, data: { reminder, logs } });
  } catch (err) {
    console.error('[aiCalls] getReminder error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load reminder.' });
  }
};

exports.getPreviewPayload = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id.' });
    }
    const result = await getPayloadPreview(id);
    if (!result.ok) {
      return res.status(404).json({ success: false, message: 'Reminder not found.' });
    }
    return res.json({ success: true, data: { payload: result.payload } });
  } catch (err) {
    console.error('[aiCalls] getPreviewPayload error:', err);
    return res.status(500).json({ success: false, message: 'Failed to build payload preview.' });
  }
};

exports.patchReminder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id.' });
    }
    const result = await updateReminderFields(id, req.body || {}, req.admin);
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400;
      return res.status(status).json({ success: false, message: result.error });
    }
    return res.json({ success: true, data: { reminder: result.reminder } });
  } catch (err) {
    console.error('[aiCalls] patchReminder error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update reminder.' });
  }
};

exports.scheduleReminder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id.' });
    }
    const result = await scheduleReminderToOsvi(id, req.admin);
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400;
      return res.status(status).json({
        success: false,
        message: result.error,
        data: result.reminder ? { reminder: result.reminder } : undefined,
      });
    }
    return res.json({ success: true, data: { reminder: result.reminder } });
  } catch (err) {
    console.error('[aiCalls] scheduleReminder error:', err);
    return res.status(500).json({ success: false, message: 'Failed to schedule reminder.' });
  }
};

exports.rejectReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id.' });
    }
    const result = await rejectReminder(id, req.admin, reason);
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400;
      return res.status(status).json({ success: false, message: result.error });
    }
    return res.json({ success: true, data: { reminder: result.reminder } });
  } catch (err) {
    console.error('[aiCalls] rejectReminder error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reject reminder.' });
  }
};

exports.bulkSchedule = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids array is required.' });
    }
    const result = await bulkScheduleReminders(ids, req.admin);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[aiCalls] bulkSchedule error:', err);
    return res.status(500).json({ success: false, message: 'Bulk schedule failed.' });
  }
};

exports.bulkScheduleAllPending = async (req, res) => {
  try {
    const result = await scheduleAllPending(req.admin);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[aiCalls] bulkScheduleAllPending error:', err);
    return res.status(500).json({ success: false, message: 'Bulk schedule all failed.' });
  }
};

exports.retryReminder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id.' });
    }
    const result = await retryReminder(id, req.admin);
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400;
      return res.status(status).json({ success: false, message: result.error, data: result.reminder ? { reminder: result.reminder } : undefined });
    }
    return res.json({ success: true, data: { reminder: result.reminder } });
  } catch (err) {
    console.error('[aiCalls] retryReminder error:', err);
    return res.status(500).json({ success: false, message: 'Retry failed.' });
  }
};

exports.rescheduleReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const { callbackTime } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id.' });
    }
    if (!callbackTime) {
      return res.status(400).json({ success: false, message: 'callbackTime is required.' });
    }
    const result = await rescheduleReminder(id, callbackTime, req.admin);
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400;
      return res.status(status).json({ success: false, message: result.error, data: result.reminder ? { reminder: result.reminder } : undefined });
    }
    return res.json({ success: true, data: { reminder: result.reminder } });
  } catch (err) {
    console.error('[aiCalls] rescheduleReminder error:', err);
    return res.status(500).json({ success: false, message: 'Reschedule failed.' });
  }
};

exports.cancelReminder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id.' });
    }
    const result = await cancelReminder(id, req.admin);
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400;
      return res.status(status).json({ success: false, message: result.error });
    }
    return res.json({ success: true, data: { reminder: result.reminder } });
  } catch (err) {
    console.error('[aiCalls] cancelReminder error:', err);
    return res.status(500).json({ success: false, message: 'Cancel failed.' });
  }
};

exports.deleteReminder = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id.' });
    }
    const result = await deleteReminder(id, req.admin);
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 400;
      return res.status(status).json({ success: false, message: result.error });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('[aiCalls] deleteReminder error:', err);
    return res.status(500).json({ success: false, message: 'Delete failed.' });
  }
};

exports.previewTestCall = async (req, res) => {
  try {
    const result = previewTestCallPayload(req.body || {});
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.json({ success: true, data: { payload: result.payload } });
  } catch (err) {
    console.error('[aiCalls] previewTestCall error:', err);
    return res.status(500).json({ success: false, message: 'Preview failed.' });
  }
};

exports.createTestCall = async (req, res) => {
  try {
    const result = await createTestCall(req.body || {}, req.admin);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        message: result.message || result.error,
        data: result.testCall ? { testCall: result.testCall } : undefined,
      });
    }
    return res.json({
      success: true,
      message: result.message || 'Test call scheduled with OSVI.',
      data: { testCall: result.testCall },
    });
  } catch (err) {
    console.error('[aiCalls] createTestCall error:', err);
    return res.status(500).json({ success: false, message: 'Test call failed.' });
  }
};
