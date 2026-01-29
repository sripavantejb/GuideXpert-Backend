/**
 * One-time seed: create first admin user.
 * Run: node scripts/seedAdmin.js (from backend directory)
 * Uses ADMIN_USERNAME and ADMIN_PASSWORD from .env, or prompts if missing.
 */
require('dotenv').config();
const readline = require('readline');
const connectDB = require('../config/db');
const Admin = require('../models/Admin');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

async function seedAdmin() {
  try {
    await connectDB();

    const existing = await Admin.countDocuments();
    if (existing > 0) {
      console.log('Admin user(s) already exist. Skipping seed.');
      process.exit(0);
      return;
    }

    let username = process.env.ADMIN_USERNAME || '';
    let password = process.env.ADMIN_PASSWORD || '';
    if (!username) username = await ask('Admin username: ');
    if (!password) password = await ask('Admin password (min 6 chars): ');
    if (!username || username.length < 2) {
      console.error('Username must be at least 2 characters.');
      process.exit(1);
    }
    if (!password || password.length < 6) {
      console.error('Password must be at least 6 characters.');
      process.exit(1);
    }

    await Admin.create({ username: username.toLowerCase(), password, name: 'Admin' });
    console.log('Admin user created successfully.');
    process.exit(0);
  } catch (err) {
    if (err.code === 11000) {
      console.log('Admin with this username already exists.');
      process.exit(0);
      return;
    }
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

seedAdmin();
