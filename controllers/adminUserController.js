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
  'poster-automation',
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
    const trimmedPassword = typeof password === 'string' ? password.trim() : '';
    if (!password || typeof password !== 'string' || trimmedPassword.length < 6) {
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
      password: trimmedPassword,
      name: typeof name === 'string' ? name.trim().slice(0, 100) : '',
      isSuperAdmin: !!isSuperAdmin,
      sectionAccess: sectionList,
    });
    console.log('[createAdmin] Admin created:', normalizedUsername);
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

/**
 * PATCH /admin/admins/:id/password — reset another admin's password (super admin only).
 * Body: { newPassword }
 */
exports.resetAdminPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body || {};
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'newPassword is required (min 6 characters)' });
    }
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'Admin not found.' });
    }
    const admin = await Admin.findById(id);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found.' });
    }
    admin.password = newPassword.trim();
    await admin.save();
    return res.status(200).json({ success: true, message: 'Password updated.' });
  } catch (error) {
    console.error('[resetAdminPassword] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * PATCH /admin/me/password — change own password (any admin).
 * Body: { currentPassword, newPassword }
 */
exports.changeMyPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({ success: false, message: 'Current password is required.' });
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
    }
    const admin = req.admin;
    const match = await admin.comparePassword(currentPassword);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }
    admin.password = newPassword.trim();
    await admin.save();
    return res.status(200).json({ success: true, message: 'Password changed.' });
  } catch (error) {
    console.error('[changeMyPassword] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
