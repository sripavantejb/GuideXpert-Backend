const ProgressCheckInSubmission = require('../models/ProgressCheckInSubmission');
const { ADMIN_LIST_MAX_LIMIT } = require('../constants/listPagination');
const {
  ACTIVITY_VALUES,
  NEW_LEADS_VALUES,
  NEW_NAT_VALUES,
  SEAT_RESERVATION_VALUES,
  CHALLENGE_VALUES,
} = require('../models/ProgressCheckInSubmission');

const SLOT_TIMES = ['15:00', '17:00'];
const IST_TIMEZONE = 'Asia/Kolkata';

function getISTParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: get('weekday'),
  };
}

function istDateStringFromParts({ year, month, day }) {
  return `${year}-${month}-${day}`;
}

function parseISODateLocal(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isSundayDate(date) {
  return date.getDay() === 0;
}

function addCalendarDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toISODateLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Next N non-Sunday calendar days starting from IST today (skip Sunday if today is Sunday). */
function getNextSlotDayStrings(count = 2, now = new Date()) {
  const ist = getISTParts(now);
  let cursor = parseISODateLocal(istDateStringFromParts(ist));
  const days = [];
  while (days.length < count) {
    if (!isSundayDate(cursor)) {
      days.push(toISODateLocal(cursor));
    }
    cursor = addCalendarDays(cursor, 1);
  }
  return days;
}

function isSlotStillAvailable(slotDate, slotTime, now = new Date()) {
  if (!SLOT_TIMES.includes(slotTime)) return false;
  const allowedDays = getNextSlotDayStrings(2, now);
  if (!allowedDays.includes(slotDate)) return false;
  const ist = getISTParts(now);
  const todayStr = istDateStringFromParts(ist);
  if (slotDate !== todayStr) return true;
  const [h, m] = slotTime.split(':').map(Number);
  const nowMinutes = ist.hour * 60 + ist.minute;
  const slotMinutes = h * 60 + m;
  return slotMinutes > nowMinutes;
}

function validateSelectedSlot(slotDate, slotTime) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate || '')) {
    return 'Select a support session slot.';
  }
  if (!SLOT_TIMES.includes(slotTime)) {
    return 'Select a valid session time.';
  }
  const dateObj = parseISODateLocal(slotDate);
  if (isSundayDate(dateObj)) {
    return 'Sessions are not available on Sundays.';
  }
  if (!isSlotStillAvailable(slotDate, slotTime)) {
    return 'Selected slot is no longer available. Please choose another.';
  }
  return '';
}

function to10Digits(val) {
  if (val == null) return '';
  return String(val).replace(/\D/g, '').trim().slice(-10).slice(0, 10);
}

async function hasProgressCheckInForMobile(mobile10) {
  if (!mobile10 || mobile10.length !== 10) return false;
  const doc = await ProgressCheckInSubmission.findOne({ mobileNumber: mobile10 }).select('_id').lean();
  return !!doc;
}

/**
 * GET /api/progress-check-in/check/:phone
 */
exports.getProgressCheckInStatus = async (req, res) => {
  try {
    const mobileNumber = to10Digits(req.params.phone);
    if (mobileNumber.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number required.' });
    }
    const submitted = await hasProgressCheckInForMobile(mobileNumber);
    return res.status(200).json({ success: true, submitted });
  } catch (err) {
    console.error('[getProgressCheckInStatus]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * POST /api/progress-check-in
 */
exports.submitProgressCheckIn = async (req, res) => {
  try {
    const b = req.body || {};
    const fullName = (b.fullName && String(b.fullName).trim()) || '';
    const mobileNumber = to10Digits(b.mobileNumber);
    const activities = Array.isArray(b.activities)
      ? [...new Set(b.activities.filter((a) => ACTIVITY_VALUES.includes(a)))]
      : [];
    const newLeads = b.newLeads != null ? String(b.newLeads).trim() : '';
    const newNatApplications = b.newNatApplications != null ? String(b.newNatApplications).trim() : '';
    const seatReservations = b.seatReservations != null ? String(b.seatReservations).trim() : '';
    const biggestChallenge = b.biggestChallenge != null ? String(b.biggestChallenge).trim() : '';
    const biggestChallengeOther =
      (b.biggestChallengeOther && String(b.biggestChallengeOther).trim().slice(0, 500)) || '';
    const slotDate = b.slotDate != null ? String(b.slotDate).trim() : '';
    const slotTime = b.slotTime != null ? String(b.slotTime).trim() : '';

    if (fullName.length < 2 || fullName.length > 100) {
      return res.status(400).json({ success: false, message: 'Full name must be 2–100 characters.' });
    }
    if (mobileNumber.length !== 10) {
      return res.status(400).json({ success: false, message: 'Mobile number must be 10 digits.' });
    }
    if (!activities.length) {
      return res.status(400).json({ success: false, message: 'Select at least one activity.' });
    }
    if (!NEW_LEADS_VALUES.includes(newLeads)) {
      return res.status(400).json({ success: false, message: 'Select how many new leads you generated.' });
    }
    if (!NEW_NAT_VALUES.includes(newNatApplications)) {
      return res.status(400).json({ success: false, message: 'Select how many NAT applications you started.' });
    }
    if (!SEAT_RESERVATION_VALUES.includes(seatReservations)) {
      return res.status(400).json({ success: false, message: 'Select how many seat reservations you completed.' });
    }
    if (!CHALLENGE_VALUES.includes(biggestChallenge)) {
      return res.status(400).json({ success: false, message: 'Select your biggest challenge.' });
    }
    if (biggestChallenge === 'other' && !biggestChallengeOther) {
      return res.status(400).json({ success: false, message: 'Please describe your biggest challenge.' });
    }
    const slotErr = validateSelectedSlot(slotDate, slotTime);
    if (slotErr) {
      return res.status(400).json({ success: false, message: slotErr });
    }

    if (await hasProgressCheckInForMobile(mobileNumber)) {
      return res.status(409).json({
        success: false,
        code: 'ALREADY_SUBMITTED',
        message: 'You have already submitted this progress check-in.',
      });
    }

    const doc = await ProgressCheckInSubmission.create({
      fullName,
      mobileNumber,
      activities,
      newLeads,
      newNatApplications,
      seatReservations,
      biggestChallenge,
      biggestChallengeOther: biggestChallenge === 'other' ? biggestChallengeOther : undefined,
      slotDate,
      slotTime,
    });

    return res.status(201).json({
      success: true,
      message: 'Submitted successfully',
      data: {
        id: doc._id,
        fullName: doc.fullName,
        mobileNumber: doc.mobileNumber,
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors).map((e) => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg || 'Validation failed.' });
    }
    console.error('[submitProgressCheckIn]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
};

function parseISODateFilter(str) {
  if (str == null || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(trimmed + 'T00:00:00.000Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildDateRange(from, to) {
  const range = {};
  const start = parseISODateFilter(from);
  if (start) {
    start.setUTCHours(0, 0, 0, 0);
    range.$gte = start;
  }
  const end = parseISODateFilter(to);
  if (end) {
    end.setUTCHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return Object.keys(range).length ? range : null;
}

function buildAdminSearchQuery(q) {
  if (!q) return null;
  const term = String(q).trim();
  if (!term) return null;
  const digits = term.replace(/\D/g, '');
  const clauses = [{ fullName: { $regex: term, $options: 'i' } }];
  if (digits.length >= 6) {
    clauses.push({ mobileNumber: { $regex: digits, $options: 'i' } });
  } else {
    clauses.push({ mobileNumber: { $regex: term, $options: 'i' } });
  }
  return { $or: clauses };
}

function countMapFromGroups(groups) {
  const out = {};
  (groups || []).forEach((g) => {
    if (g._id != null && g._id !== '') out[String(g._id)] = g.count;
  });
  return out;
}

function toAdminRow(r) {
  return {
    id: r._id,
    fullName: r.fullName,
    mobileNumber: r.mobileNumber,
    activities: r.activities || [],
    newLeads: r.newLeads,
    newNatApplications: r.newNatApplications,
    seatReservations: r.seatReservations,
    biggestChallenge: r.biggestChallenge,
    biggestChallengeOther: r.biggestChallengeOther || '',
    slotDate: r.slotDate || '',
    slotTime: r.slotTime || '',
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * GET /api/admin/nurturing — list progress check-ins with stats (admin).
 */
exports.getProgressCheckInSubmissions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(ADMIN_LIST_MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;
    const dateRange = buildDateRange(req.query.from, req.query.to);
    const searchQuery = buildAdminSearchQuery(req.query.q);

    const match = {};
    if (dateRange) match.createdAt = dateRange;
    if (searchQuery) Object.assign(match, searchQuery);

    const [docs, total, facet] = await Promise.all([
      ProgressCheckInSubmission.find(match).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ProgressCheckInSubmission.countDocuments(match),
      ProgressCheckInSubmission.aggregate([
        { $match: match },
        {
          $facet: {
            byNewLeads: [{ $group: { _id: '$newLeads', count: { $sum: 1 } } }],
            byNewNatApplications: [{ $group: { _id: '$newNatApplications', count: { $sum: 1 } } }],
            bySeatReservations: [{ $group: { _id: '$seatReservations', count: { $sum: 1 } } }],
            byBiggestChallenge: [{ $group: { _id: '$biggestChallenge', count: { $sum: 1 } } }],
            bySlotTime: [{ $group: { _id: '$slotTime', count: { $sum: 1 } } }],
            bySlotDate: [{ $group: { _id: '$slotDate', count: { $sum: 1 } } }],
            byActivity: [{ $unwind: '$activities' }, { $group: { _id: '$activities', count: { $sum: 1 } } }],
            byDay: [
              {
                $group: {
                  _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' },
                  },
                  count: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
            ],
            notStartedYet: [
              { $match: { activities: 'not_started_yet' } },
              { $count: 'count' },
            ],
            withLeads: [
              { $match: { newLeads: { $nin: ['0', null, ''] } } },
              { $count: 'count' },
            ],
            withNat: [
              { $match: { newNatApplications: { $nin: ['0', null, ''] } } },
              { $count: 'count' },
            ],
            withSr: [
              { $match: { seatReservations: { $nin: ['0', null, ''] } } },
              { $count: 'count' },
            ],
            withSlot: [
              { $match: { slotDate: { $exists: true, $ne: '' }, slotTime: { $exists: true, $ne: '' } } },
              { $count: 'count' },
            ],
          },
        },
      ]),
    ]);

    const f = facet[0] || {};
    const stats = {
      total,
      notStartedYet: f.notStartedYet?.[0]?.count || 0,
      withLeads: f.withLeads?.[0]?.count || 0,
      withNat: f.withNat?.[0]?.count || 0,
      withSr: f.withSr?.[0]?.count || 0,
      withSlot: f.withSlot?.[0]?.count || 0,
      byNewLeads: countMapFromGroups(f.byNewLeads),
      byNewNatApplications: countMapFromGroups(f.byNewNatApplications),
      bySeatReservations: countMapFromGroups(f.bySeatReservations),
      byBiggestChallenge: countMapFromGroups(f.byBiggestChallenge),
      bySlotTime: countMapFromGroups(f.bySlotTime),
      bySlotDate: countMapFromGroups(f.bySlotDate),
      byActivity: countMapFromGroups(f.byActivity),
      byDay: (f.byDay || []).map((row) => ({ date: row._id, count: row.count })),
    };

    return res.status(200).json({
      success: true,
      data: docs.map(toAdminRow),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      stats,
    });
  } catch (err) {
    console.error('[getProgressCheckInSubmissions]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
