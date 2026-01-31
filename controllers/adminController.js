const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const FormSubmission = require('../models/FormSubmission');
const SlotConfig = require('../models/SlotConfig');

const JWT_SECRET = process.env.ADMIN_JWT_SECRET;
const JWT_EXPIRES_IN = process.env.ADMIN_JWT_EXPIRES_IN || '24h';

// Sample hardcoded dev credentials (only when NODE_ENV !== 'production' or ALLOW_DEV_ADMIN_LOGIN=true)
const DEV_SAMPLE_USERNAME = 'admin';
const DEV_SAMPLE_PASSWORD = 'admin123';

function isDevAdminAllowed() {
  if (process.env.ALLOW_DEV_ADMIN_LOGIN === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ success: false, message: 'username is required' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ success: false, message: 'password is required' });
    }
    if (!JWT_SECRET) {
      console.error('[Admin] ADMIN_JWT_SECRET not set');
      return res.status(500).json({ success: false, message: 'Server configuration error' });
    }

    let admin = await Admin.findOne({ username: username.trim().toLowerCase() });

    // Development only: if sample credentials are used and no user "admin" exists, create sample admin
    if (!admin && isDevAdminAllowed()) {
      const isSampleCreds =
        username.trim().toLowerCase() === DEV_SAMPLE_USERNAME &&
        password === DEV_SAMPLE_PASSWORD;
      if (isSampleCreds) {
        try {
          admin = await Admin.create({
            username: DEV_SAMPLE_USERNAME,
            password: DEV_SAMPLE_PASSWORD,
            name: 'Admin',
          });
          console.log('[Admin] Sample dev admin created (username: admin, password: admin123)');
        } catch (createErr) {
          console.error('[Admin] Sample admin create failed:', createErr);
          return res.status(500).json({
            success: false,
            message: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : createErr.message,
          });
        }
      }
    }

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
    let valid = false;
    try {
      valid = await admin.comparePassword(password);
    } catch (compareErr) {
      console.error('[Admin login] comparePassword failed:', compareErr);
    }
    // Development only: if user "admin" exists but password is wrong, reset to admin123 so sample creds work
    if (!valid && isDevAdminAllowed() &&
        username.trim().toLowerCase() === DEV_SAMPLE_USERNAME && password === DEV_SAMPLE_PASSWORD) {
      try {
        const hash = await bcrypt.hash(DEV_SAMPLE_PASSWORD, 10);
        await Admin.findByIdAndUpdate(admin._id, {
          $set: { password: hash, updatedAt: new Date() },
        });
        valid = true;
        console.log('[Admin] Dev: password reset to admin123 for user admin');
      } catch (resetErr) {
        console.error('[Admin] Dev password reset failed:', resetErr);
      }
    }
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { adminId: admin._id.toString() },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    return res.status(200).json({
      success: true,
      token,
      user: { id: admin._id, username: admin.username }
    });
  } catch (error) {
    console.error('[Admin login] Error:', error);
    if (process.env.NODE_ENV !== 'production' && error.stack) {
      console.error('[Admin login] Stack:', error.stack);
    }
    const message =
      process.env.NODE_ENV === 'production'
        ? 'Something went wrong.'
        : (error.message || String(error));
    return res.status(500).json({ success: false, message });
  }
};

function mapLeadToDTO(sub) {
  const step2 = sub.step2Data || {};
  const step3 = sub.step3Data || {};
  const post = sub.postRegistrationData || {};
  return {
    id: sub._id,
    fullName: sub.fullName,
    phone: sub.phone,
    occupation: sub.occupation,
    otpVerified: !!step2.otpVerified,
    step2CompletedAt: step2.step2CompletedAt || null,
    slotBooked: !!(sub.isRegistered || step3.selectedSlot),
    selectedSlot: step3.selectedSlot || null,
    slotDate: step3.slotDate || null,
    step3CompletedAt: step3.step3CompletedAt || null,
    isRegistered: !!sub.isRegistered,
    registeredAt: sub.registeredAt || null,
    currentStep: sub.currentStep,
    applicationStatus: sub.applicationStatus,
    email: sub.email || post.email || null,
    interestLevel: sub.interestLevel || post.interestLevel || null,
    postRegistrationCompletedAt: post.completedAt || null,
    step1CompletedAt: (sub.step1Data || {}).step1CompletedAt || null,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt
  };
}

exports.getAdminStats = async (req, res) => {
  try {
    const [
      total,
      inProgress,
      registered,
      completed,
      otpVerified,
      slotBooked,
      slotAggregation,
      signupsByDay
    ] = await Promise.all([
      FormSubmission.countDocuments({}),
      FormSubmission.countDocuments({ applicationStatus: 'in_progress' }),
      FormSubmission.countDocuments({ applicationStatus: 'registered' }),
      FormSubmission.countDocuments({ applicationStatus: 'completed' }),
      FormSubmission.countDocuments({ 'step2Data.otpVerified': true }),
      FormSubmission.countDocuments({
        $or: [{ isRegistered: true }, { 'step3Data.selectedSlot': { $exists: true, $ne: null } }]
      }),
      FormSubmission.aggregate([
        { $match: { 'step3Data.selectedSlot': { $exists: true, $ne: null } } },
        { $group: { _id: '$step3Data.selectedSlot', count: { $sum: 1 } } }
      ]),
      FormSubmission.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ])
    ]);

    const bySlot = (slotAggregation || []).reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {});
    const signupsOverTime = (signupsByDay || []).map((d) => ({ date: d._id, count: d.count }));

    return res.status(200).json({
      success: true,
      data: {
        total,
        inProgress,
        registered,
        completed,
        otpVerified,
        slotBooked,
        bySlot,
        signupsOverTime
      }
    });
  } catch (error) {
    console.error('[getAdminStats] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

function escapeCsvCell(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

exports.exportLeads = async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    const filter = {};
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }

    const submissions = await FormSubmission.find(filter).sort({ createdAt: -1 }).lean();
    const rows = submissions.map((sub) => {
      const dto = mapLeadToDTO(sub);
      return [
        dto.id,
        dto.fullName,
        dto.phone,
        dto.occupation,
        dto.otpVerified ? 'Yes' : 'No',
        dto.slotBooked ? 'Yes' : 'No',
        dto.selectedSlot || '',
        dto.slotDate ? dto.slotDate.toISOString() : '',
        dto.applicationStatus || '',
        dto.currentStep ?? '',
        dto.email || '',
        dto.interestLevel || '',
        dto.createdAt ? dto.createdAt.toISOString() : '',
        dto.updatedAt ? dto.updatedAt.toISOString() : ''
      ];
    });

    const header = [
      'ID', 'Full Name', 'Phone', 'Occupation', 'OTP Verified', 'Slot Booked',
      'Selected Slot', 'Slot Date', 'Status', 'Step', 'Email', 'Interest', 'Created', 'Updated'
    ];
    const csvLines = [header.map(escapeCsvCell).join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))];
    const csv = csvLines.join('\r\n');

    const filename = `guidexpert-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) {
    console.error('[exportLeads] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getAdminLeads = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const applicationStatus = req.query.applicationStatus; // in_progress | registered | completed
    const otpVerified = req.query.otpVerified; // true | false (string)
    const slotBooked = req.query.slotBooked; // true | false (string)
    const q = (req.query.q || '').trim();

    const andConditions = [];

    if (applicationStatus && ['in_progress', 'registered', 'completed'].includes(applicationStatus)) {
      andConditions.push({ applicationStatus });
    }
    if (otpVerified === 'true') {
      andConditions.push({ 'step2Data.otpVerified': true });
    } else if (otpVerified === 'false') {
      andConditions.push({
        $or: [{ 'step2Data.otpVerified': { $ne: true } }, { step2Data: { $exists: false } }]
      });
    }
    if (slotBooked === 'true') {
      andConditions.push({
        $or: [{ isRegistered: true }, { 'step3Data.selectedSlot': { $exists: true, $ne: null } }]
      });
    } else if (slotBooked === 'false') {
      andConditions.push({
        $and: [
          { isRegistered: { $ne: true } },
          { $or: [{ 'step3Data.selectedSlot': null }, { 'step3Data.selectedSlot': { $exists: false } }] }
        ]
      });
    }
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      andConditions.push({
        $or: [
          { fullName: { $regex: safe, $options: 'i' } },
          { phone: { $regex: safe } },
          { email: { $regex: safe, $options: 'i' } }
        ]
      });
    }

    const filter = andConditions.length > 0 ? { $and: andConditions } : {};

    const skip = (page - 1) * limit;
    const [submissions, total] = await Promise.all([
      FormSubmission.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      FormSubmission.countDocuments(filter)
    ]);

    const data = submissions.map((sub) => mapLeadToDTO(sub));
    const totalPages = Math.ceil(total / limit) || 1;

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error('[getAdminLeads] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

const ALL_SLOT_IDS = [
  'MONDAY_7PM', 'TUESDAY_7PM', 'WEDNESDAY_7PM', 'THURSDAY_7PM',
  'FRIDAY_7PM', 'SATURDAY_7PM', 'SUNDAY_7PM', 'SUNDAY_11AM'
];

exports.getSlotConfigs = async (req, res) => {
  try {
    const [configs, bookingCounts] = await Promise.all([
      SlotConfig.find({ slotId: { $in: ALL_SLOT_IDS } }).lean(),
      FormSubmission.aggregate([
        { $match: { 'step3Data.selectedSlot': { $exists: true, $ne: null } } },
        { $group: { _id: '$step3Data.selectedSlot', count: { $sum: 1 } } }
      ])
    ]);

    const configMap = Object.fromEntries(configs.map((c) => [c.slotId, c.enabled]));
    const countMap = Object.fromEntries((bookingCounts || []).map((c) => [c._id, c.count]));

    const slots = ALL_SLOT_IDS.map((slotId) => {
      const enabled = configMap[slotId];
      return {
        slotId,
        enabled: enabled !== undefined ? enabled : true,
        bookedCount: countMap[slotId] ?? 0
      };
    });

    for (const slotId of ALL_SLOT_IDS) {
      if (configMap[slotId] === undefined) {
        await SlotConfig.findOneAndUpdate(
          { slotId },
          { $set: { enabled: true, updatedAt: new Date() } },
          { upsert: true }
        );
      }
    }

    return res.status(200).json({ success: true, data: { slots } });
  } catch (error) {
    console.error('[getSlotConfigs] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.updateSlotConfig = async (req, res) => {
  try {
    const { slotId } = req.params;
    const { enabled } = req.body || {};

    if (!slotId || !ALL_SLOT_IDS.includes(slotId)) {
      return res.status(400).json({ success: false, message: 'Invalid slot ID' });
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'enabled must be a boolean' });
    }

    const config = await SlotConfig.findOneAndUpdate(
      { slotId },
      { $set: { enabled, updatedAt: new Date() } },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      data: { slotId: config.slotId, enabled: config.enabled }
    });
  } catch (error) {
    console.error('[updateSlotConfig] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
