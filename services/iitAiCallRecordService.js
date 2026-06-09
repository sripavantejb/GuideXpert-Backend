const AiCallReminder = require('../models/AiCallReminder');
const IitAiCallRecord = require('../models/IitAiCallRecord');
const {
  normalizeOsviPostCallPayload,
  isIitianCareerCounsellingCall,
  mapOutcomeToReminderStatus,
  normalizePhone,
} = require('../utils/osviPostCallNormalizer');
const { syncReminderFromWebhook } = require('./aiCallReminderService');

async function linkReminderByPhone(phone10) {
  if (!/^\d{10}$/.test(phone10)) return null;
  const reminder = await AiCallReminder.findOne({ phone: phone10 })
    .sort({ scheduledAt: -1, createdAt: -1 })
    .select('_id')
    .lean();
  return reminder?._id || null;
}

async function ingestIitAiCallWebhook(body) {
  const normalized = normalizeOsviPostCallPayload(body);

  if (!normalized.callLogId) {
    return { ok: false, error: 'call_log_id_required' };
  }
  if (!normalized.phone || !/^\d{10}$/.test(normalized.phone)) {
    return { ok: false, error: 'invalid_phone' };
  }

  const reminderId = await linkReminderByPhone(normalized.phone);

  const doc = {
    callLogId: normalized.callLogId,
    phone: normalized.phone,
    personName: normalized.personName,
    agentName: normalized.agentName,
    callStatus: normalized.callStatus,
    callType: normalized.callType,
    duration: normalized.duration,
    recordingUrl: normalized.recordingUrl,
    callTime: normalized.callTime,
    summary: normalized.summary,
    transcript: normalized.transcript,
    confirmation: normalized.confirmation,
    callOutcome: normalized.callOutcome,
    studentConcern: normalized.studentConcern,
    examAttempted: normalized.examAttempted,
    timeConfirmed: normalized.timeConfirmed,
    rescheduleRequested: normalized.rescheduleRequested,
    preferredCallbackTime: normalized.preferredCallbackTime,
    structuredOutput: normalized.structuredOutput,
    triggerData: normalized.triggerData,
    aiCallReminderId: reminderId,
    rawPayload: normalized.rawPayload,
  };

  const record = await IitAiCallRecord.findOneAndUpdate(
    { callLogId: normalized.callLogId },
    { $set: doc },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  ).lean();

  const shouldSyncReminder = isIitianCareerCounsellingCall(normalized) || Boolean(reminderId);
  if (shouldSyncReminder) {
    const reminderStatus = mapOutcomeToReminderStatus(normalized.callOutcome, normalized.callStatus)
      || normalized.callStatus;
    syncReminderFromWebhook({
      phone: normalized.phone,
      status: reminderStatus,
      callId: normalized.callLogId,
    }).catch((err) => {
      console.warn('[IIT AI Call] reminder sync failed:', err?.message || err);
    });
  }

  return { ok: true, record, created: true };
}

function buildListFilter(query) {
  const mongo = {};
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const outcome = typeof query.callOutcome === 'string' ? query.callOutcome.trim() : '';
  const confirmation = typeof query.confirmation === 'string' ? query.confirmation.trim() : '';

  if (outcome) mongo.callOutcome = new RegExp(`^${outcome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  if (confirmation) mongo.confirmation = confirmation.toUpperCase();

  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    mongo.$or = [
      { personName: regex },
      { phone: regex },
      { callLogId: regex },
      { studentConcern: regex },
      { callOutcome: regex },
    ];
  }

  return mongo;
}

async function listIitAiCallRecords(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  const skip = (page - 1) * limit;
  const mongo = buildListFilter(query);

  const [rows, total] = await Promise.all([
    IitAiCallRecord.find(mongo)
      .sort({ callTime: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-rawPayload')
      .lean(),
    IitAiCallRecord.countDocuments(mongo),
  ]);

  return { rows, total, page, limit };
}

async function getIitAiCallRecordById(id) {
  return IitAiCallRecord.findById(id).lean();
}

async function getIitAiCallStats() {
  const [
    total,
    outcomeCounts,
    confirmationCounts,
    concernCounts,
    recentDaily,
  ] = await Promise.all([
    IitAiCallRecord.countDocuments({}),
    IitAiCallRecord.aggregate([
      { $match: { callOutcome: { $nin: [null, ''] } } },
      { $group: { _id: '$callOutcome', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    IitAiCallRecord.aggregate([
      { $match: { confirmation: { $nin: [null, ''] } } },
      { $group: { _id: '$confirmation', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    IitAiCallRecord.aggregate([
      { $match: { studentConcern: { $nin: [null, ''] } } },
      { $group: { _id: '$studentConcern', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    IitAiCallRecord.aggregate([
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: { $ifNull: ['$callTime', '$createdAt'] }, timezone: 'Asia/Kolkata' },
          },
          total: { $sum: 1 },
          confirmed: {
            $sum: {
              $cond: [{ $regexMatch: { input: { $ifNull: ['$callOutcome', ''] }, regex: /confirmed/i } }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 14 },
    ]),
  ]);

  const byOutcome = Object.fromEntries(outcomeCounts.map((r) => [r._id, r.count]));
  const byConfirmation = Object.fromEntries(confirmationCounts.map((r) => [r._id, r.count]));
  const byConcern = concernCounts.map((r) => ({ concern: r._id, count: r.count }));

  const confirmed = byOutcome.Confirmed || 0;
  const successRate = total > 0 ? Math.round((confirmed / total) * 100) : 0;

  return {
    summary: {
      total,
      confirmed,
      undecided: byOutcome.Undecided || 0,
      notInterested: byOutcome['Not Interested'] || 0,
      noAnswer: byOutcome['No Answer'] || 0,
      rescheduleRequested: byOutcome['Reschedule Requested'] || 0,
      successRate,
    },
    byOutcome,
    byConfirmation,
    byConcern,
    dailySeries: recentDaily.map((d) => ({
      date: d._id,
      total: d.total,
      confirmed: d.confirmed,
    })).reverse(),
  };
}

module.exports = {
  ingestIitAiCallWebhook,
  listIitAiCallRecords,
  getIitAiCallRecordById,
  getIitAiCallStats,
  normalizePhone,
};
