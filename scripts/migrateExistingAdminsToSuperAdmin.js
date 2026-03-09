/**
 * One-time migration: set isSuperAdmin = true for all existing admin users
 * so they retain full access and can create other admins.
 * Run from backend: node scripts/migrateExistingAdminsToSuperAdmin.js
 */
require('dotenv').config();
const connectDB = require('../config/db');
const Admin = require('../models/Admin');

async function migrate() {
  try {
    await connectDB();
    const result = await Admin.updateMany(
      { isSuperAdmin: { $ne: true } },
      { $set: { isSuperAdmin: true, updatedAt: new Date() } }
    );
    console.log('Migration complete. Admins updated:', result.modifiedCount);
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
