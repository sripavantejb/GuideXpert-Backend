/**
 * One-time seed: create first counsellor user.
 * Run: node scripts/seedCounsellor.js (from backend directory)
 * Uses COUNSELLOR_EMAIL, COUNSELLOR_PASSWORD, COUNSELLOR_NAME from .env, or prompts if missing.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const readline = require('readline');
const connectDB = require('../config/db');
const Counsellor = require('../models/Counsellor');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

async function seedCounsellor() {
  try {
    await connectDB();

    const email = process.env.COUNSELLOR_EMAIL || await ask('Counsellor email: ');
    const password = process.env.COUNSELLOR_PASSWORD || await ask('Counsellor password (min 6 chars): ');
    const name = process.env.COUNSELLOR_NAME || (await ask('Counsellor name: ')) || 'Counsellor';

    if (!email || !email.includes('@')) {
      console.error('Valid email is required.');
      process.exit(1);
    }
    if (!password || password.length < 6) {
      console.error('Password must be at least 6 characters.');
      process.exit(1);
    }

    const existing = await Counsellor.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      console.log('Counsellor with this email already exists.');
      process.exit(0);
      return;
    }

    await Counsellor.create({
      email: email.toLowerCase().trim(),
      password,
      name: name.trim() || 'Counsellor',
      role: 'counsellor',
    });
    console.log('Counsellor created successfully. You can now log in at /counsellor/login');
    process.exit(0);
  } catch (err) {
    if (err.code === 11000) {
      console.log('Counsellor with this email already exists.');
      process.exit(0);
      return;
    }
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

seedCounsellor();
