#!/usr/bin/env node
/**
 * Clean up corrupted OTP/Meet entry data for a specific mobile number
 * Usage: node cleanup-mobile.js <mobile_number>
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const OtpVerification = require('./models/OtpVerification');
const MeetEntry = require('./models/MeetEntry');

const mobile = process.argv[2];

if (!mobile || !/^\d{10}$/.test(mobile)) {
  console.error('Usage: node cleanup-mobile.js <10-digit-mobile-number>');
  console.error('Example: node cleanup-mobile.js 9876543210');
  process.exit(1);
}

async function cleanup() {
  try {
    console.log(`\nConnecting to MongoDB...`);
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Connected to MongoDB\n');

    console.log(`Cleaning up data for mobile: ${mobile}`);
    console.log('='.repeat(50));

    // Check and remove OTP verification records
    const otpRecords = await OtpVerification.find({ phoneNumber: mobile });
    if (otpRecords.length > 0) {
      console.log(`\nFound ${otpRecords.length} OTP record(s):`);
      otpRecords.forEach((record, i) => {
        console.log(`  ${i + 1}. Name: ${record.name}, Email: ${record.email}, Attempts: ${record.attempts}`);
        console.log(`     Expires: ${record.expiresAt}`);
      });
      
      const deleted = await OtpVerification.deleteMany({ phoneNumber: mobile });
      console.log(`✓ Deleted ${deleted.deletedCount} OTP record(s)`);
    } else {
      console.log('\n✓ No OTP records found');
    }

    // Check and remove meet entry records
    const meetRecords = await MeetEntry.find({ mobile });
    if (meetRecords.length > 0) {
      console.log(`\nFound ${meetRecords.length} Meet entry record(s):`);
      meetRecords.forEach((record, i) => {
        console.log(`  ${i + 1}. Name: ${record.name}, Email: ${record.email}, Status: ${record.status}`);
        console.log(`     Registered: ${record.registeredAt}`);
      });
      
      const deleted = await MeetEntry.deleteMany({ mobile });
      console.log(`✓ Deleted ${deleted.deletedCount} Meet entry record(s)`);
    } else {
      console.log('\n✓ No Meet entry records found');
    }

    console.log('\n' + '='.repeat(50));
    console.log('✓ Cleanup complete! You can now register with this number.');
    console.log('='.repeat(50) + '\n');

  } catch (error) {
    console.error('\n✗ Error during cleanup:', error.message);
    if (error.message.includes('MONGODB_URI')) {
      console.error('\nMake sure MONGODB_URI is set in your .env file');
    }
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

cleanup();
