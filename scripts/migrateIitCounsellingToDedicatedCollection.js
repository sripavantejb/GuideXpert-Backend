#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const FormSubmission = require('../models/FormSubmission');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const IitCounsellingSubmissionArchive = require('../models/IitCounsellingSubmissionArchive');
const IitCounsellingVisit = require('../models/IitCounsellingVisit');

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function mapLegacyToIitSubmission(source) {
  const iit = source.iitCounselling || {};
  return {
    submissionType: 'iitCounselling',
    legacyFormSubmissionId: source._id,
    fullName: source.fullName || iit.section1Data?.fullName || '',
    phone: source.phone || iit.section1Data?.mobileNumber || '',
    occupation: source.occupation || iit.section1Data?.studentOrParent || 'Student',
    currentStep: iit.currentStep || source.currentStep || 1,
    isCompleted: !!(iit.isCompleted || source.isCompleted),
    applicationStatus: source.applicationStatus === 'completed' ? 'completed' : 'in_progress',
    iitCounselling: {
      currentStep: iit.currentStep || source.currentStep || 1,
      isCompleted: !!(iit.isCompleted || source.isCompleted),
      section1Data: iit.section1Data || null,
      section2Data: iit.section2Data || null,
      section3Data: iit.section3Data || null,
      lastUpdatedAt: iit.lastUpdatedAt || source.updatedAt || source.createdAt || new Date(),
    },
    utm_source: source.utm_source || null,
    utm_medium: source.utm_medium || null,
    utm_campaign: source.utm_campaign || null,
    utm_content: source.utm_content || null,
    createdAt: source.createdAt || new Date(),
    updatedAt: source.updatedAt || source.createdAt || new Date(),
  };
}

async function migrateOne(source) {
  const targetPayload = mapLegacyToIitSubmission(source);
  const target = await IitCounsellingSubmission.findOneAndUpdate(
    { legacyFormSubmissionId: source._id },
    { $set: targetPayload, $setOnInsert: { createdAt: targetPayload.createdAt } },
    { upsert: true, new: true, runValidators: true }
  ).lean();

  await IitCounsellingSubmissionArchive.updateOne(
    { sourceId: source._id },
    {
      $setOnInsert: {
        sourceCollection: 'formsubmissions',
        sourceId: source._id,
        migratedToIitSubmissionId: target._id,
        migratedAt: new Date(),
        snapshot: source,
      },
    },
    { upsert: true }
  );

  const relink = await IitCounsellingVisit.updateMany(
    { submissionId: source._id },
    { $set: { submissionId: target._id, phone: target.phone || source.phone || null } }
  );

  return {
    targetId: target._id,
    relinkedVisits: relink.modifiedCount || 0,
  };
}

async function run() {
  const deleteSource = hasFlag('--delete-source');
  const dryRun = hasFlag('--dry-run');
  const sourceFilter = { submissionType: 'iitCounselling' };

  await connectDB();
  console.log('[migrate-iit] Connected DB:', mongoose.connection.name);

  const sources = await FormSubmission.find(sourceFilter).lean();
  console.log('[migrate-iit] Found IIT rows in formsubmissions:', sources.length);

  if (dryRun) {
    const targetCount = await IitCounsellingSubmission.countDocuments({});
    const archiveCount = await IitCounsellingSubmissionArchive.countDocuments({});
    console.log('[migrate-iit] DRY RUN summary', {
      sourceCount: sources.length,
      currentTargetCount: targetCount,
      currentArchiveCount: archiveCount,
      deleteSourceRequested: deleteSource,
    });
    return;
  }

  let migrated = 0;
  let relinkedVisits = 0;
  for (const source of sources) {
    const result = await migrateOne(source);
    migrated += 1;
    relinkedVisits += result.relinkedVisits;
  }

  const sourceCountBeforeDelete = await FormSubmission.countDocuments(sourceFilter);
  const targetCount = await IitCounsellingSubmission.countDocuments({});
  const targetLegacyLinkedCount = await IitCounsellingSubmission.countDocuments({ legacyFormSubmissionId: { $exists: true } });
  const archiveCount = await IitCounsellingSubmissionArchive.countDocuments({});

  console.log('[migrate-iit] Migration summary', {
    migrated,
    relinkedVisits,
    sourceCountBeforeDelete,
    targetCount,
    targetLegacyLinkedCount,
    archiveCount,
  });

  if (deleteSource) {
    const archiveCountForSource = await IitCounsellingSubmissionArchive.countDocuments({
      sourceId: { $in: sources.map((s) => s._id) },
    });
    if (archiveCountForSource < sourceCountBeforeDelete) {
      throw new Error(`[migrate-iit] Refusing to delete source: archive mismatch (${archiveCountForSource}/${sourceCountBeforeDelete})`);
    }
    const deletion = await FormSubmission.deleteMany(sourceFilter);
    const sourceCountAfterDelete = await FormSubmission.countDocuments(sourceFilter);
    console.log('[migrate-iit] Deleted IIT rows from formsubmissions', {
      deletedCount: deletion.deletedCount || 0,
      sourceCountAfterDelete,
    });
  } else {
    console.log('[migrate-iit] Source rows were NOT deleted (pass --delete-source to delete after archive parity).');
  }
}

run()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[migrate-iit] Failed:', err);
    try {
      await mongoose.disconnect();
    } catch (_) {
      // ignore
    }
    process.exit(1);
  });
