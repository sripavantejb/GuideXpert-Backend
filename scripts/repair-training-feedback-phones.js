require('dotenv').config();
const mongoose = require('mongoose');
const TrainingFeedback = require('../models/TrainingFeedback');
const AssessmentSubmission3 = require('../models/AssessmentSubmission3');
const otpRepository = require('../utils/otpRepository');

async function run() {
  let scanned = 0;
  let updated = 0;
  let reassignedMobileFromWhatsapp = 0;
  const unresolved = [];

  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected.\n');

    const assessmentRows = await AssessmentSubmission3.find({}, { phone: 1 }).lean();
    const assessmentPhones = new Set(assessmentRows.map((row) => otpRepository.normalize(row.phone)).filter(Boolean));
    const cursor = TrainingFeedback.find({}, { mobileNumber: 1, whatsappNumber: 1 }).cursor();

    for await (const doc of cursor) {
      scanned += 1;

      let normalizedMobile = otpRepository.normalize(doc.mobileNumber);
      const normalizedWhatsapp = otpRepository.normalize(doc.whatsappNumber);
      const mobileInAssessment = assessmentPhones.has(normalizedMobile);
      const whatsappInAssessment = assessmentPhones.has(normalizedWhatsapp);

      if (!mobileInAssessment && whatsappInAssessment) {
        normalizedMobile = normalizedWhatsapp;
        reassignedMobileFromWhatsapp += 1;
      }

      if (doc.mobileNumber === normalizedMobile && doc.whatsappNumber === normalizedWhatsapp) {
        if (!mobileInAssessment && !whatsappInAssessment) {
          unresolved.push({
            id: String(doc._id),
            mobileNumber: normalizedMobile,
            whatsappNumber: normalizedWhatsapp,
          });
        }
        continue;
      }

      await TrainingFeedback.updateOne(
        { _id: doc._id },
        {
          $set: {
            mobileNumber: normalizedMobile,
            whatsappNumber: normalizedWhatsapp,
          },
        }
      );

      updated += 1;
      console.log(`Updated ${String(doc._id)}: ${doc.mobileNumber} -> ${normalizedMobile}, ${doc.whatsappNumber} -> ${normalizedWhatsapp}`);
    }

    console.log(`\nScanned: ${scanned}`);
    console.log(`Updated: ${updated}`);
    console.log(`Reassigned mobile from WhatsApp: ${reassignedMobileFromWhatsapp}`);
    if (unresolved.length > 0) {
      console.log('Unresolved rows with neither mobile nor WhatsApp in AssessmentSubmission3:');
      unresolved.forEach((row) => console.log(row));
    }
    console.log('Repair complete.');
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
  }
}

run();
