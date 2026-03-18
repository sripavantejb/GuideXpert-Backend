/**
 * One-time script: Add a user to AssessmentSubmission3 so they can submit the activation form
 * without having written an assessment.
 * - phone: 7799885142
 * - fullName: Chinnareddappa
 * - score: 0, maxScore: 0, answers: {}
 *
 * Run from backend directory: node scripts/add-activation-form-access-assessment3.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const AssessmentSubmission3 = require('../models/AssessmentSubmission3');

const PHONE = '7799885142';
const FULL_NAME = 'Chinnareddappa';

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected.\n');

    const existing = await AssessmentSubmission3.findOne({ phone: PHONE }).lean();
    if (existing) {
      console.log(`Record already exists for phone ${PHONE}:`, existing.fullName);
      return;
    }

    const now = new Date();
    const doc = {
      fullName: FULL_NAME,
      phone: PHONE,
      answers: {},
      score: 0,
      maxScore: 0,
      submittedAt: now,
      createdAt: now,
      updatedAt: now
    };
    const collectionName = AssessmentSubmission3.collection.name;
    const col = mongoose.connection.collection(collectionName);
    await col.insertOne(doc);

    console.log(`Inserted into collection "${collectionName}": phone ${PHONE}, fullName "${FULL_NAME}".`);
    console.log('User can now submit the activation form.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
  }
}

run();
