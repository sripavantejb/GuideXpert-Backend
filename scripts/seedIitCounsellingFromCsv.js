/**
 * Seed IIT counselling submissions from a headerless CSV export.
 *
 * Columns: name, phone, classStatus, stream, slot label, preferred language
 *
 * Usage:
 *   node scripts/seedIitCounsellingFromCsv.js [path/to/file.csv]
 *   node scripts/seedIitCounsellingFromCsv.js --dry-run [path/to/file.csv]
 *
 * Default CSV: scripts/data/iit-sheet23.csv
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { parse } = require('csv-parse/sync');
const connectDB = require('../config/db');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const { computeIitCounsellingSlotInstantUtc } = require('../utils/iitCounsellingSlotUtc');

const IIT_SUBMISSION_TYPE = 'iitCounselling';
const SLOT_BOOKING = 'Wednesday 6PM';
const SLOT_BOOKING_DATE = '2026-06-03';
const UTM_SOURCE = 'csv_seed';
const UTM_CAMPAIGN = 'sheet23';

const ALLOWED_CLASS = new Set([
  'Completed 12th/Intermediate 2nd Year',
  'Studying 12th/Intermediate 2nd Year',
  'Studying 11th/Intermediate 1st Year',
  'Degree Completed',
  'Degree Studying',
  'Engineering Completed',
  'Engineering Studying',
  'Diploma',
]);

const ALLOWED_STREAM = new Set(['MPC', 'BiPC', 'Commerce', 'Others']);

const DEFAULT_SECTION2 = {
  careerDecisionClarity: 'Somewhat clear',
  collegeDecisionStakeholder: 'Both',
  expectedBudget: '1-3L',
  topCollegePriority: 'All the above',
};

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const csvArg = argv.filter((a) => a !== '--dry-run')[0];
const DEFAULT_CSV = path.join(__dirname, 'data', 'iit-sheet23.csv');
const csvPath = csvArg ? path.resolve(process.cwd(), csvArg) : DEFAULT_CSV;

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const phone = digits.slice(-10);
  return /^\d{10}$/.test(phone) ? phone : null;
}

function normalizeLanguage(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (/telugu|kannada|tamil/.test(s)) return 'Telugu';
  return 'Hindi';
}

function normalizeName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) return null;
  return name.slice(0, 100);
}

function normalizeClassStatus(raw) {
  const v = String(raw || '').trim();
  return ALLOWED_CLASS.has(v) ? v : 'Completed 12th/Intermediate 2nd Year';
}

function normalizeStream(raw) {
  const v = String(raw || '').trim();
  return ALLOWED_STREAM.has(v) ? v : 'Others';
}

function parseRows(csvContent) {
  const rows = parse(csvContent, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  const byPhone = new Map();
  const skipped = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length < 2) {
      skipped.push({ line: i + 1, reason: 'empty row' });
      continue;
    }
    const name = normalizeName(row[0]);
    const phone = normalizePhone(row[1]);
    if (!name) {
      skipped.push({ line: i + 1, reason: 'invalid name', raw: row[0] });
      continue;
    }
    if (!phone) {
      skipped.push({ line: i + 1, reason: 'invalid phone', raw: row[1] });
      continue;
    }

    const classStatus = normalizeClassStatus(row[2]);
    const stream = normalizeStream(row[3]);
    const preferredLanguage = normalizeLanguage(row[5]);

    byPhone.set(phone, {
      fullName: name,
      phone,
      classStatus,
      stream,
      preferredLanguage,
      line: i + 1,
    });
  }

  return { leads: [...byPhone.values()], skipped };
}

function buildUpdatePayload(lead, now) {
  const slotUtc = computeIitCounsellingSlotInstantUtc(SLOT_BOOKING, SLOT_BOOKING_DATE);
  const section1Data = {
    fullName: lead.fullName,
    mobileNumber: lead.phone,
    studentOrParent: 'Student',
    classStatus: lead.classStatus,
    stream: lead.stream,
    city: '',
    slotBooking: SLOT_BOOKING,
    slotBookingDate: SLOT_BOOKING_DATE,
    top5Colleges: [],
    submittedAt: now,
  };
  const section2Data = {
    ...DEFAULT_SECTION2,
    preferredLanguage: lead.preferredLanguage,
    submittedAt: now,
  };

  return {
    submissionType: IIT_SUBMISSION_TYPE,
    fullName: lead.fullName,
    phone: lead.phone,
    occupation: 'Student',
    currentStep: 2,
    applicationStatus: 'in_progress',
    isCompleted: false,
    counsellingSlotInstantUtc: slotUtc,
    utm_source: UTM_SOURCE,
    utm_campaign: UTM_CAMPAIGN,
    'iitCounselling.currentStep': 2,
    'iitCounselling.isCompleted': false,
    'iitCounselling.section1Data': section1Data,
    'iitCounselling.section2Data': section2Data,
    'iitCounselling.lastUpdatedAt': now,
    updatedAt: now,
  };
}

async function seed() {
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const { leads, skipped } = parseRows(csvContent);

  console.log(`CSV: ${csvPath}`);
  console.log(`Unique leads: ${leads.length}, skipped rows: ${skipped.length}`);
  if (skipped.length) {
    for (const s of skipped) {
      console.warn(`  skip line ${s.line}: ${s.reason}`, s.raw ? `(${s.raw})` : '');
    }
  }

  if (dryRun) {
    console.log('\n--dry-run: no database writes');
    for (const lead of leads) {
      console.log(`  ${lead.phone} ${lead.fullName} | ${lead.preferredLanguage} | ${lead.classStatus}`);
    }
    process.exit(0);
  }

  await connectDB();
  const now = new Date();
  let inserted = 0;
  let updated = 0;

  for (const lead of leads) {
    const $set = buildUpdatePayload(lead, now);
    const existing = await IitCounsellingSubmission.findOne({ phone: lead.phone })
      .select('_id assignedBdaId')
      .lean();

    const result = await IitCounsellingSubmission.findOneAndUpdate(
      { phone: lead.phone },
      {
        $setOnInsert: { createdAt: now },
        $set,
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    if (existing) updated += 1;
    else inserted += 1;

    if (process.env.DEBUG_SEED) {
      console.log(existing ? 'updated' : 'inserted', lead.phone, lead.fullName, result._id);
    }
  }

  const telugu = leads.filter((l) => l.preferredLanguage === 'Telugu').length;
  const hindi = leads.length - telugu;
  console.log(`Done. inserted=${inserted}, updated=${updated}, Telugu=${telugu}, Hindi=${hindi}`);
  await IitCounsellingSubmission.db.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
