'use strict';

const ConversationRecoveryCase = require('../../models/ConversationRecoveryCase');
const ConversationRecoveryAttempt = require('../../models/ConversationRecoveryAttempt');
const ConversationRecoverySnapshot = require('../../models/ConversationRecoverySnapshot');

function parseDate(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function buildMatchFromFilters(filters = {}) {
  const match = {};
  const from = parseDate(filters.from, null);
  const to = parseDate(filters.to, null);
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from;
    if (to) match.createdAt.$lte = to;
  }
  if (filters.exam) match.examName = filters.exam;
  if (filters.phase != null && filters.phase !== '') {
    match.lastPhase = Number(filters.phase);
  }
  return match;
}

async function getOverviewMetrics(filters = {}) {
  const caseMatch = {};
  const from = parseDate(filters.from, null);
  const to = parseDate(filters.to, null);
  if (from || to) {
    caseMatch.createdAt = {};
    if (from) caseMatch.createdAt.$gte = from;
    if (to) caseMatch.createdAt.$lte = to;
  }
  if (filters.phase != null && filters.phase !== '') {
    caseMatch.lastPhase = Number(filters.phase);
  }
  if (filters.recoveryStatus) caseMatch.status = filters.recoveryStatus;

  const attemptMatch = {};
  if (from || to) {
    attemptMatch.createdAt = {};
    if (from) attemptMatch.createdAt.$gte = from;
    if (to) attemptMatch.createdAt.$lte = to;
  }
  if (filters.deliveryStatus) attemptMatch.deliveryStatus = filters.deliveryStatus;

  const [
    eligible,
    scheduled,
    sent,
    delivered,
    read,
    replies,
    recovered,
    journeyCompleted,
    booked,
  ] = await Promise.all([
    ConversationRecoveryCase.countDocuments({
      ...caseMatch,
      status: { $in: ['eligible', 'scheduled', 'active', 'awaiting_reply'] },
    }),
    ConversationRecoveryCase.countDocuments({ ...caseMatch, status: 'scheduled' }),
    ConversationRecoveryAttempt.countDocuments({
      ...attemptMatch,
      deliveryStatus: { $in: ['sent', 'delivered', 'read'] },
    }),
    ConversationRecoveryAttempt.countDocuments({
      ...attemptMatch,
      deliveryStatus: { $in: ['delivered', 'read'] },
    }),
    ConversationRecoveryAttempt.countDocuments({ ...attemptMatch, deliveryStatus: 'read' }),
    ConversationRecoveryAttempt.countDocuments({
      ...attemptMatch,
      repliedAt: { $ne: null },
    }),
    ConversationRecoveryCase.countDocuments({ ...caseMatch, status: 'recovered' }),
    ConversationRecoveryCase.countDocuments({
      ...caseMatch,
      journeyCompletedAfterRecovery: true,
    }),
    ConversationRecoveryCase.countDocuments({
      ...caseMatch,
      bookingCompletedAfterRecovery: true,
    }),
  ]);

  const deliveryRate = sent > 0 ? delivered / sent : 0;
  const recoveryRate = sent > 0 ? recovered / sent : 0;
  const bookingConversion = recovered > 0 ? booked / recovered : 0;

  return {
    eligible,
    scheduled,
    sent,
    delivered,
    read,
    replies,
    recovered,
    journeyCompleted,
    booked,
    deliveryRate,
    recoveryRate,
    bookingConversion,
  };
}

async function getFunnelMetrics(filters = {}) {
  const overview = await getOverviewMetrics(filters);
  return {
    eligible: overview.eligible,
    scheduled: overview.scheduled,
    sent: overview.sent,
    delivered: overview.delivered,
    read: overview.read,
    replied: overview.replies,
    conversationResumed: overview.recovered,
    journeyCompleted: overview.journeyCompleted,
    booked: overview.booked,
  };
}

async function getDailyStats(filters = {}) {
  const from = parseDate(filters.from, new Date(Date.now() - 14 * 86400000));
  const to = parseDate(filters.to, new Date());
  const rows = await ConversationRecoveryAttempt.aggregate([
    { $match: { createdAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        sent: {
          $sum: {
            $cond: [{ $in: ['$deliveryStatus', ['sent', 'delivered', 'read']] }, 1, 0],
          },
        },
        delivered: {
          $sum: {
            $cond: [{ $in: ['$deliveryStatus', ['delivered', 'read']] }, 1, 0],
          },
        },
        read: {
          $sum: { $cond: [{ $eq: ['$deliveryStatus', 'read'] }, 1, 0] },
        },
        replies: {
          $sum: { $cond: [{ $ne: ['$repliedAt', null] }, 1, 0] },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const recoveredByDay = await ConversationRecoveryCase.aggregate([
    {
      $match: {
        recoveredAt: { $gte: from, $lte: to },
        status: 'recovered',
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$recoveredAt' } },
        recovered: { $sum: 1 },
        bookings: {
          $sum: { $cond: ['$bookingCompletedAfterRecovery', 1, 0] },
        },
      },
    },
  ]);
  const recoveredMap = Object.fromEntries(
    recoveredByDay.map((r) => [r._id, r])
  );

  const eligibleByDay = await ConversationRecoverySnapshot.aggregate([
    {
      $match: {
        lastActivityAt: { $gte: from, $lte: to },
        recoveryEligibleHint: true,
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$lastActivityAt' } },
        eligible: { $sum: 1 },
      },
    },
  ]);
  const eligibleMap = Object.fromEntries(eligibleByDay.map((r) => [r._id, r.eligible]));

  return rows.map((r) => ({
    date: r._id,
    eligible: eligibleMap[r._id] || 0,
    sent: r.sent,
    delivered: r.delivered,
    read: r.read,
    replies: r.replies,
    recovered: recoveredMap[r._id]?.recovered || 0,
    bookings: recoveredMap[r._id]?.bookings || 0,
  }));
}

async function getPhaseRecoveryStats(filters = {}) {
  const match = {};
  const from = parseDate(filters.from, null);
  const to = parseDate(filters.to, null);
  if (from || to) {
    match.recoveredAt = {};
    if (from) match.recoveredAt.$gte = from;
    if (to) match.recoveredAt.$lte = to;
  }
  match.status = 'recovered';
  const rows = await ConversationRecoveryCase.aggregate([
    { $match: match },
    { $group: { _id: '$lastPhase', recoveries: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => ({ phase: r._id, recoveries: r.recoveries }));
}

async function getDeliveryStatusCounts(filters = {}) {
  const match = {};
  const from = parseDate(filters.from, null);
  const to = parseDate(filters.to, null);
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from;
    if (to) match.createdAt.$lte = to;
  }
  const rows = await ConversationRecoveryAttempt.aggregate([
    { $match: match },
    { $group: { _id: '$deliveryStatus', count: { $sum: 1 } } },
  ]);
  const base = {
    queued: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    expired: 0,
    blocked: 0,
    retry_pending: 0,
  };
  for (const r of rows) {
    if (r._id && Object.prototype.hasOwnProperty.call(base, r._id)) {
      base[r._id] = r.count;
    }
  }
  return base;
}

async function getFailureReasons(filters = {}) {
  const match = { deliveryStatus: 'failed' };
  const from = parseDate(filters.from, null);
  const to = parseDate(filters.to, null);
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from;
    if (to) match.createdAt.$lte = to;
  }
  if (filters.failureReason) {
    match.failureReason = filters.failureReason;
  }
  const rows = await ConversationRecoveryAttempt.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $ifNull: ['$failureReason', 'unknown'] },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);
  const taxonomy = [
    'invalid_number',
    'blocked',
    'opt_out',
    'template_missing',
    'template_rejected',
    'template_failure',
    'api_failure',
    'rate_limit',
    'unknown',
  ];
  const map = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  return taxonomy.map((reason) => ({
    reason,
    count: map[reason] || 0,
    label: reason.replace(/_/g, ' '),
  }));
}

async function getTrendStats(filters = {}) {
  const daily = await getDailyStats(filters);
  return {
    recoveryTrend: daily.map((d) => ({ date: d.date, value: d.recovered })),
    deliveryTrend: daily.map((d) => ({ date: d.date, value: d.delivered })),
    readTrend: daily.map((d) => ({ date: d.date, value: d.read })),
    replyTrend: daily.map((d) => ({ date: d.date, value: d.replies })),
    bookingConversionTrend: daily.map((d) => ({
      date: d.date,
      value: d.recovered > 0 ? d.bookings / d.recovered : 0,
      bookings: d.bookings,
      recovered: d.recovered,
    })),
    failureTrend: await ConversationRecoveryAttempt.aggregate([
      {
        $match: {
          deliveryStatus: 'failed',
          createdAt: {
            $gte: parseDate(filters.from, new Date(Date.now() - 14 * 86400000)),
            $lte: parseDate(filters.to, new Date()),
          },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          value: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).then((rows) => rows.map((r) => ({ date: r._id, value: r.value }))),
  };
}

async function listStudents(filters = {}, { page = 1, limit = 50 } = {}) {
  const match = {};
  if (filters.recoveryStatus) match.status = filters.recoveryStatus;
  if (filters.phase != null && filters.phase !== '') match.lastPhase = Number(filters.phase);
  const from = parseDate(filters.from, null);
  const to = parseDate(filters.to, null);
  if (from || to) {
    match.updatedAt = {};
    if (from) match.updatedAt.$gte = from;
    if (to) match.updatedAt.$lte = to;
  }

  const skip = (Math.max(1, page) - 1) * limit;
  const [items, total] = await Promise.all([
    ConversationRecoveryCase.find(match)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ConversationRecoveryCase.countDocuments(match),
  ]);

  const phones = items.map((i) => i.phone);
  const snapshots = await ConversationRecoverySnapshot.find({
    phone: { $in: phones },
  }).lean();
  const snapMap = Object.fromEntries(
    snapshots.map((s) => [`${s.phone}:${String(s.conversationId)}`, s])
  );

  const caseIds = items.map((i) => i._id);
  const lastAttempts = await ConversationRecoveryAttempt.aggregate([
    { $match: { caseId: { $in: caseIds } } },
    { $sort: { attemptNumber: -1 } },
    {
      $group: {
        _id: '$caseId',
        deliveryStatus: { $first: '$deliveryStatus' },
        readAt: { $first: '$readAt' },
        repliedAt: { $first: '$repliedAt' },
        attemptNumber: { $first: '$attemptNumber' },
      },
    },
  ]);
  const attemptMap = Object.fromEntries(lastAttempts.map((a) => [String(a._id), a]));

  const students = items.map((c) => {
    const snap = snapMap[`${c.phone}:${String(c.conversationId)}`] || {};
    const att = attemptMap[String(c._id)] || {};
    return {
      id: String(c._id),
      student: snap.studentName || null,
      phone: c.phone,
      lastPhase: c.lastPhase,
      lastActivity: snap.lastActivityAt || null,
      recoveryAttempt: att.attemptNumber || c.attemptCount,
      deliveryStatus: att.deliveryStatus || null,
      readStatus: att.readAt ? 'read' : att.deliveryStatus === 'delivered' ? 'delivered' : 'unread',
      replyStatus: att.repliedAt || c.status === 'recovered' ? 'replied' : 'none',
      journeyStatus: snap.journeyCompleted ? 'completed' : 'in_progress',
      bookingStatus: snap.bookingCompleted ? 'booked' : 'not_booked',
      recoveryStatus: c.status,
      conversationId: String(c.conversationId),
      examName: snap.examName || null,
    };
  });

  if (filters.bookingStatus === 'booked') {
    return {
      total: students.filter((s) => s.bookingStatus === 'booked').length,
      page,
      limit,
      students: students.filter((s) => s.bookingStatus === 'booked'),
    };
  }
  if (filters.bookingStatus === 'not_booked') {
    return {
      total: students.filter((s) => s.bookingStatus === 'not_booked').length,
      page,
      limit,
      students: students.filter((s) => s.bookingStatus === 'not_booked'),
    };
  }

  return { total, page, limit, students };
}

async function getStudentDetail(caseId) {
  const caseDoc = await ConversationRecoveryCase.findById(caseId).lean();
  if (!caseDoc) return null;
  const snapshot = await ConversationRecoverySnapshot.findById(caseDoc.snapshotId).lean();
  const attempts = await ConversationRecoveryAttempt.find({ caseId: caseDoc._id })
    .sort({ attemptNumber: 1 })
    .lean();
  return { case: caseDoc, snapshot, attempts };
}

module.exports = {
  getOverviewMetrics,
  getFunnelMetrics,
  getDailyStats,
  getPhaseRecoveryStats,
  getDeliveryStatusCounts,
  getFailureReasons,
  getTrendStats,
  listStudents,
  getStudentDetail,
  buildMatchFromFilters,
};
