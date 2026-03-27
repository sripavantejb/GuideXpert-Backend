require('dotenv').config();
const mongoose = require('mongoose');
const TrainingFeedback = require('../models/TrainingFeedback');
const WebinarProgress = require('../models/WebinarProgress');

const ALL_MODULE_IDS = ['intro', 's2', 'a1', 's3', 'a2', 's4', 'a3', 's5', 'a4', 's6', 'a5'];
const MODULE_TITLES = {
  intro: 'Introduction to GuideXpert Counsellor training program',
  s2: 'Introduction to GuideXpert Counselling & Core Principles',
  a1: 'Assessment 1',
  s3: 'Mastering Counselling: Objection Handling & Communication Skills',
  a2: 'Assessment 2',
  s4: 'Lead Generation Methods & Strategies for Career Counsellors',
  a3: 'Assessment 3',
  s5: 'How to Position Yourself as a Trusted Career Counsellor',
  a4: 'Assessment 4',
  s6: 'GuideXpert Portal, Tools & Referral Process',
  a5: 'Assessment 5',
};

function toPhone10(value) {
  if (value == null) return '';
  return String(value).replace(/\D/g, '').slice(-10);
}

function isComplete(existing) {
  if (!existing || !Array.isArray(existing.completedModules)) return false;
  if (existing.overallPercent !== 100) return false;
  const done = new Set(existing.completedModules);
  return ALL_MODULE_IDS.every((id) => done.has(id));
}

function makeModulesPayload(at) {
  const modules = {};
  for (const id of ALL_MODULE_IDS) {
    modules[id] = {
      status: 'completed',
      progressPercent: 100,
      watchedSeconds: 0,
      maxWatchedSeconds: 0,
      completedAt: at,
      unlockedAt: at,
    };
  }
  return modules;
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    commit: args.has('--commit'),
  };
}

async function run() {
  const { commit } = parseArgs(process.argv);
  const mode = commit ? 'COMMIT' : 'DRY-RUN';

  const stats = {
    mode,
    sourceRows: 0,
    uniqueValidPhones: 0,
    invalidRows: 0,
    alreadyComplete: 0,
    wouldUpdate: 0,
    updated: 0,
    created: 0,
    modifiedExisting: 0,
    failed: 0,
  };

  const invalidSamples = [];
  const errorSamples = [];
  const updateSamples = [];

  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI is missing in environment.');
    }

    console.log(`[${mode}] Connecting to MongoDB...`);
    await mongoose.connect(uri);
    console.log(`[${mode}] Connected.`);

    const rows = await TrainingFeedback.find({}, { name: 1, mobileNumber: 1 }).lean();
    stats.sourceRows = rows.length;

    const phoneToName = new Map();
    for (const row of rows) {
      const phone = toPhone10(row.mobileNumber);
      if (!/^\d{10}$/.test(phone)) {
        stats.invalidRows += 1;
        if (invalidSamples.length < 10) {
          invalidSamples.push({
            id: String(row._id),
            mobileNumber: row.mobileNumber,
          });
        }
        continue;
      }
      if (!phoneToName.has(phone)) {
        phoneToName.set(phone, (row.name || '').trim());
      }
    }
    stats.uniqueValidPhones = phoneToName.size;

    console.log(`[${mode}] Source rows: ${stats.sourceRows}`);
    console.log(`[${mode}] Valid unique phones: ${stats.uniqueValidPhones}`);
    console.log(`[${mode}] Invalid rows: ${stats.invalidRows}`);

    for (const [phone, feedbackName] of phoneToName.entries()) {
      try {
        const existing = await WebinarProgress.findOne(
          { phone },
          { _id: 1, completedModules: 1, overallPercent: 1, fullName: 1 }
        ).lean();

        if (isComplete(existing)) {
          stats.alreadyComplete += 1;
          continue;
        }

        stats.wouldUpdate += 1;
        if (!commit) {
          if (updateSamples.length < 10) {
            updateSamples.push({ phone, action: existing ? 'update' : 'create' });
          }
          continue;
        }

        const now = new Date();
        const updateDoc = {
          fullName: (feedbackName || existing?.fullName || '').trim(),
          overallPercent: 100,
          completedModules: ALL_MODULE_IDS,
          modules: makeModulesPayload(now),
          lastActiveModule: 'a5',
          lastActivityAt: now,
          lastActivityEvent: {
            type: 'assessment_completed',
            moduleId: 'a5',
            moduleTitle: MODULE_TITLES.a5,
            progressPercent: 100,
            watchedSeconds: null,
            at: now,
          },
        };

        const result = await WebinarProgress.updateOne(
          { phone },
          { $set: updateDoc },
          { upsert: true }
        );

        if (result.upsertedCount > 0) {
          stats.created += 1;
        } else if (result.modifiedCount > 0) {
          stats.modifiedExisting += 1;
        }
        stats.updated += 1;

        if (updateSamples.length < 10) {
          updateSamples.push({ phone, action: existing ? 'update' : 'create' });
        }
      } catch (innerErr) {
        stats.failed += 1;
        if (errorSamples.length < 10) {
          errorSamples.push({ phone, error: innerErr.message || String(innerErr) });
        }
      }
    }

    console.log('\n===== Backfill Summary =====');
    console.log(`Mode: ${stats.mode}`);
    console.log(`Source rows scanned: ${stats.sourceRows}`);
    console.log(`Valid unique phones: ${stats.uniqueValidPhones}`);
    console.log(`Invalid rows skipped: ${stats.invalidRows}`);
    console.log(`Already complete: ${stats.alreadyComplete}`);
    console.log(`Would update: ${stats.wouldUpdate}`);
    console.log(`Updated (commit): ${stats.updated}`);
    console.log(`Created new docs: ${stats.created}`);
    console.log(`Modified existing docs: ${stats.modifiedExisting}`);
    console.log(`Failed: ${stats.failed}`);

    if (invalidSamples.length) {
      console.log('\nInvalid row samples (max 10):');
      for (const s of invalidSamples) console.log(s);
    }
    if (updateSamples.length) {
      console.log(`\n${commit ? 'Updated' : 'Would update'} samples (max 10):`);
      for (const s of updateSamples) console.log(s);
    }
    if (errorSamples.length) {
      console.log('\nError samples (max 10):');
      for (const s of errorSamples) console.log(s);
    }

    if (!commit) {
      console.log('\nDry-run finished. Re-run with --commit to apply changes.');
    }
  } catch (err) {
    console.error(`Backfill failed: ${err.message || err}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

run();
