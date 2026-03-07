const Admin = require('../models/Admin');

/** Section keys allowed for sectionAccess. Must match frontend nav. */
const ALLOWED_SECTION_KEYS = [
  'dashboard',
  'leads',
  'analytics',
  'meeting-attendance',
  'export',
  'slots',
  'training-form-responses',
  'training-feedback',
  'influencer-tracking',
  'assessment-results',
  'settings',
];

function toAdminDTO(admin) {
  return {
    id: admin._id,
    username: admin.username,
    name: admin.name || '',
    isSuperAdmin: !!admin.isSuperAdmin,
    sectionAccess: Array.isArray(admin.sectionAccess) ? admin.sectionAccess : [],
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}

/**
 * GET /admin/admins — list all admins (super admin only). No passwords.
 */
exports.listAdmins = async (req, res) => {
  try {
    const admins = await Admin.find({}).sort({ createdAt: 1 }).lean().select('-password');
    return res.status(200).json({
      success: true,
      data: admins.map((a) => toAdminDTO(a)),
    });
  } catch (error) {
    console.error('[listAdmins] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * POST /admin/admins — create admin (super admin only).
 * Body: { username, password, name?, isSuperAdmin?, sectionAccess? }
 */
exports.createAdmin = async (req, res) => {
  try {
    const { username, password, name, isSuperAdmin, sectionAccess } = req.body || {};
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({ success: false, message: 'username is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, message: 'password is required (min 6 characters)' });
    }
    const normalizedUsername = username.trim().toLowerCase();
    const existing = await Admin.findOne({ username: normalizedUsername });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    let sectionList = [];
    if (Array.isArray(sectionAccess)) {
      sectionList = sectionAccess.filter((k) => typeof k === 'string' && ALLOWED_SECTION_KEYS.includes(k));
    }
    const admin = await Admin.create({
      username: normalizedUsername,
      password: password.trim(),
      name: typeof name === 'string' ? name.trim().slice(0, 100) : '',
      isSuperAdmin: !!isSuperAdmin,
      sectionAccess: sectionList,
    });
    return res.status(201).json({
      success: true,
      data: toAdminDTO(admin),
    });
  } catch (error) {
    console.error('[createAdmin] Error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * DELETE /admin/admins/:id — remove admin (super admin only). Cannot delete self.
 */
exports.deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const currentAdminId = req.admin._id.toString();
    const targetId = id;
    if (currentAdminId === targetId) {
      return res.status(403).json({ success: false, message: 'You cannot remove your own account.' });
    }
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(404).json({ success: false, message: 'Admin not found.' });
    }
    const deleted = await Admin.findByIdAndDelete(targetId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Admin not found.' });
    }
    return res.status(200).json({ success: true, message: 'Admin removed.' });
  } catch (error) {
    console.error('[deleteAdmin] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
