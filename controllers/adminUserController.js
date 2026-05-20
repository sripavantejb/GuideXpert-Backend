const Admin = require('../models/Admin');
const { ADMIN_SECTION_KEYS: ALLOWED_SECTION_KEYS } = require('../constants/adminSectionKeys');

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

function normalizeSectionAccessList(sectionAccess) {
  if (!Array.isArray(sectionAccess)) return [];
  return sectionAccess.filter((k) => typeof k === 'string' && ALLOWED_SECTION_KEYS.includes(k));
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
    const sectionList = normalizeSectionAccessList(sectionAccess);
    const makeSuperAdmin = !!isSuperAdmin;
    if (!makeSuperAdmin && sectionList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Select at least one section for a non–super admin.',
      });
    }
    const admin = await Admin.create({
      username: normalizedUsername,
      password: trimmedPassword,
      name: typeof name === 'string' ? name.trim().slice(0, 100) : '',
      isSuperAdmin: makeSuperAdmin,
      sectionAccess: makeSuperAdmin ? [] : sectionList,
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
 * PATCH /admin/admins/:id — update admin role and section access (super admin only).
 * Body: { name?, isSuperAdmin?, sectionAccess? }
 */
exports.updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, isSuperAdmin, sectionAccess } = req.body || {};
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: 'Admin not found.' });
    }
    const admin = await Admin.findById(id);
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found.' });
    }

    const currentAdminId = req.admin._id.toString();
    const isSelf = currentAdminId === id;

    if (typeof name === 'string') {
      admin.name = name.trim().slice(0, 100);
    }

    if (typeof isSuperAdmin === 'boolean') {
      if (isSelf && admin.isSuperAdmin && !isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'You cannot remove your own super admin role.',
        });
      }
      admin.isSuperAdmin = isSuperAdmin;
    }

    if (admin.isSuperAdmin) {
      admin.sectionAccess = [];
    } else if (sectionAccess !== undefined) {
      admin.sectionAccess = normalizeSectionAccessList(sectionAccess);
    }

    if (!admin.isSuperAdmin) {
      const access = Array.isArray(admin.sectionAccess) ? admin.sectionAccess : [];
      if (access.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Select at least one section for a non–super admin.',
        });
      }
    }

    await admin.save();
    return res.status(200).json({
      success: true,
      data: toAdminDTO(admin),
    });
  } catch (error) {
    console.error('[updateAdmin] Error:', error);
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
