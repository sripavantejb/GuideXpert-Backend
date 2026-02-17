/**
 * Seed script: inserts sample FormSubmission documents for development.
 * Run: node scripts/seed.js (from Backend directory)
 */
require('dotenv').config();
const connectDB = require('../config/db');
const FormSubmission = require('../models/FormSubmission');

const sampleSubmissions = [
  {
    fullName: 'Priya Sharma',
    phone: '9876543210',
    occupation: 'Software Engineer',
    demoInterest: 'YES_SOON',
    selectedSlot: 'SATURDAY_7PM',
    step1Data: {
      fullName: 'Priya Sharma',
      whatsappNumber: '9876543210',
      occupation: 'Software Engineer',
      step1CompletedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    },
    step2Data: { otpVerified: true, step2CompletedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
    step3Data: {
      selectedSlot: 'SATURDAY_7PM',
      slotDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      step3CompletedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
    },
    currentStep: 4,
    applicationStatus: 'completed',
    isRegistered: true,
    registeredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    email: 'priya.sharma@example.com',
    interestLevel: 5,
    postRegistrationData: {
      interestLevel: 5,
      email: 'priya.sharma@example.com',
      completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
    }
  },
  {
    fullName: 'Rahul Kumar',
    phone: '9876543211',
    occupation: 'Product Manager',
    demoInterest: 'MAYBE_LATER',
    step1Data: {
      fullName: 'Rahul Kumar',
      whatsappNumber: '9876543211',
      occupation: 'Product Manager',
      step1CompletedAt: new Date(Date.now() - 5 * 60 * 60 * 1000)
    },
    step2Data: { otpVerified: true, step2CompletedAt: new Date(Date.now() - 4 * 60 * 60 * 1000) },
    step3Data: {},
    currentStep: 3,
    applicationStatus: 'registered',
    isRegistered: true,
    registeredAt: new Date(Date.now() - 5 * 60 * 60 * 1000)
  },
  {
    fullName: 'Anita Reddy',
    phone: '9876543212',
    occupation: 'Data Analyst',
    step1Data: {
      fullName: 'Anita Reddy',
      whatsappNumber: '9876543212',
      occupation: 'Data Analyst',
      step1CompletedAt: new Date(Date.now() - 1 * 60 * 60 * 1000)
    },
    step2Data: {},
    step3Data: {},
    currentStep: 2,
    applicationStatus: 'in_progress',
    isRegistered: false
  },
  {
    fullName: 'Vikram Singh',
    phone: '9876543213',
    occupation: 'Student',
    step1Data: {
      fullName: 'Vikram Singh',
      whatsappNumber: '9876543213',
      occupation: 'Student',
      step1CompletedAt: new Date(Date.now() - 30 * 60 * 1000)
    },
    step2Data: { otpVerified: true, step2CompletedAt: new Date(Date.now() - 25 * 60 * 1000) },
    step3Data: {
      selectedSlot: 'SUNDAY_3PM',
      slotDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      step3CompletedAt: new Date(Date.now() - 20 * 60 * 1000)
    },
    currentStep: 4,
    applicationStatus: 'completed',
    isRegistered: true,
    registeredAt: new Date(Date.now() - 30 * 60 * 1000),
    email: 'vikram.s@example.com',
    interestLevel: 3,
    postRegistrationData: {
      interestLevel: 3,
      email: 'vikram.s@example.com',
      completedAt: new Date(Date.now() - 15 * 60 * 1000)
    }
  },
  {
    fullName: 'Meera Krishnan',
    phone: '9876543214',
    occupation: 'UX Designer',
    step1Data: {
      fullName: 'Meera Krishnan',
      whatsappNumber: '9876543214',
      occupation: 'UX Designer',
      step1CompletedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    },
    step2Data: { otpVerified: true, step2CompletedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
    step3Data: {},
    currentStep: 3,
    applicationStatus: 'registered',
    isRegistered: true,
    registeredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  }
];

async function seed() {
  try {
    await connectDB();
    const existing = await FormSubmission.countDocuments();
    if (existing > 0) {
      console.log(`Found ${existing} existing submission(s). Inserting sample data (skip if phone already exists)...`);
    }
    const result = await FormSubmission.insertMany(sampleSubmissions);
    console.log(`✓ Seeded ${result.length} sample FormSubmission(s).`);
    process.exit(0);
  } catch (err) {
    if (err.code === 11000) {
      console.log('Some sample phones already exist. Inserting only new ones...');
      let inserted = 0;
      for (const doc of sampleSubmissions) {
        try {
          await FormSubmission.create(doc);
          inserted++;
        } catch (e) {
          if (e.code !== 11000) throw e;
        }
      }
      console.log(`✓ Seeded ${inserted} new sample FormSubmission(s).`);
      process.exit(0);
    }
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
}

seed();
