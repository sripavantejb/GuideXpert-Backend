/**
 * Create or reset an admin by username/password (for local/dev).
 * Run from backend: ADMIN_USERNAME=venkatesh ADMIN_PASSWORD=venkatesh node scripts/ensureAdmin.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const connectDB = require('../config/db');
const Admin = require('../models/Admin');

async function ensureAdmin() {
  const username = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const password = (process.env.ADMIN_PASSWORD || '').trim();
  if (!username || username.length < 2) {
    console.error('Set ADMIN_USERNAME (min 2 chars).');
    process.exit(1);
  }
  if (!password || password.length < 6) {
    console.error('Set ADMIN_PASSWORD (min 6 chars).');
    process.exit(1);
  }

  try {
    await connectDB();
    const admin = await Admin.findOne({ username });
    if (admin) {
      const hash = await bcrypt.hash(password, 10);
      await Admin.findByIdAndUpdate(admin._id, {
        $set: { password: hash, updatedAt: new Date() }
      });
      console.log('Admin "%s" password updated.', username);
    } else {
      await Admin.create({ username, password, name: username, isSuperAdmin: true });
      console.log('Admin "%s" created.', username);
    }
    process.exit(0);
  } catch (err) {
    console.error('ensureAdmin failed:', err.message);
    process.exit(1);
  }
}

ensureAdmin();
