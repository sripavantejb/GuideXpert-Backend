/**
 * Seed 1-on-1 counseling leads from a Google Forms CSV export.
 *
 * Columns: STUDENT NAME, STUDENT MOBILE NUMBER, CURRENT CLASS, CITY / TOWN,
 * ENTRANCE EXAM RANK, PARENT NAME, PARENT MOBILE NUMBER,
 * WHO WILL ATTEND THE SESSION?, Language
 *
 * Usage:
 *   node scripts/seedOneOnOneCounselingFromCsv.js [path/to/file.csv]
 *   node scripts/seedOneOnOneCounselingFromCsv.js --dry-run [path/to/file.csv]
 *
 * Default CSV: scripts/data/one-on-one-telugu-responses.csv
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { parse } = require('csv-parse/sync');
const connectDB = require('../config/db');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const {
  CURRENT_CLASS_OPTIONS,
  PREFERRED_LANGUAGE_OPTIONS,
  SESSION_ATTENDEE_OPTIONS,
  INDIAN_MOBILE_REGEX,
} = require('../constants/oneOnOneCounseling');

const UTM_SOURCE = 'csv_seed';
const UTM_CAMPAIGN = 'one_on_one_telugu_hindi_responses';
const DEFAULT_CURRENT_CLASS = 'Inter 2nd Year Completed';

const ALLOWED_CLASS = new Set(CURRENT_CLASS_OPTIONS);
const ALLOWED_LANGUAGE = new Set(PREFERRED_LANGUAGE_OPTIONS);
const ALLOWED_ATTENDEE = new Set(SESSION_ATTENDEE_OPTIONS);

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const csvArg = argv.filter((a) => a !== '--dry-run')[0];
const DEFAULT_CSV = path.join(__dirname, 'data', 'one-on-one-telugu-responses.csv');
const csvPath = csvArg ? path.resolve(process.cwd(), csvArg) : DEFAULT_CSV;

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const phone = digits.slice(-10);
  return INDIAN_MOBILE_REGEX.test(phone) ? phone : null;
}

function normalizeText(raw, maxLen) {
  const text = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return maxLen ? text.slice(0, maxLen) : text;
}

function normalizeName(raw) {
  const name = normalizeText(raw, 100);
  return name.length >= 2 ? name : null;
}

function normalizeCity(raw) {
  const city = normalizeText(raw, 80);
  return city.length >= 2 ? city : null;
}

function normalizeCurrentClass(raw) {
  const value = String(raw || '').trim();
  return ALLOWED_CLASS.has(value) ? value : DEFAULT_CURRENT_CLASS;
}

function normalizeLanguage(raw) {
  const value = String(raw || '').trim();
  if (ALLOWED_LANGUAGE.has(value)) return value;
  const lower = value.toLowerCase();
  if (lower === 'telugu') return 'Telugu';
  if (lower === 'hindi') return 'Hindi';
  if (lower === 'english') return 'English';
  return 'Telugu';
}

function normalizeSessionAttendee(raw) {
  const value = String(raw || '').trim();
  return ALLOWED_ATTENDEE.has(value) ? value : null;
}

function getRowValue(row, ...keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  const normalized = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v])
  );
  for (const key of keys) {
    const val = normalized[key.trim().toLowerCase()];
    if (val != null && String(val).trim() !== '') return val;
  }
  return '';
}

function parseRows(csvContent) {
  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  const byPhone = new Map();
  const skipped = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const line = i + 2;

    const studentName = normalizeName(getRowValue(row, 'STUDENT NAME'));
    if (!studentName) {
      skipped.push({ line, reason: 'invalid student name', raw: getRowValue(row, 'STUDENT NAME') });
      continue;
    }

    const studentPhone = normalizePhone(getRowValue(row, 'STUDENT MOBILE NUMBER'));
    const parentPhone = normalizePhone(getRowValue(row, 'PARENT MOBILE NUMBER'));
    const mobileNumber = studentPhone || parentPhone;
    if (!mobileNumber) {
      skipped.push({ line, reason: 'invalid phone', raw: getRowValue(row, 'STUDENT MOBILE NUMBER') });
      continue;
    }

    const city = normalizeCity(getRowValue(row, 'CITY / TOWN'));
    if (!city) {
      skipped.push({ line, reason: 'invalid city', raw: getRowValue(row, 'CITY / TOWN') });
      continue;
    }

    const parentNameRaw = normalizeText(getRowValue(row, 'PARENT NAME'), 100);
    const parentName = parentNameRaw.length >= 2 ? parentNameRaw : undefined;

    let parentMobileNumber = parentPhone && parentPhone !== mobileNumber ? parentPhone : undefined;
    if (parentPhone && parentPhone !== mobileNumber && !INDIAN_MOBILE_REGEX.test(parentPhone)) {
      parentMobileNumber = undefined;
    }

    const sessionAttendee = normalizeSessionAttendee(
      getRowValue(row, 'WHO WILL ATTEND THE SESSION?')
    );
    const entranceExamRank = normalizeText(getRowValue(row, 'ENTRANCE EXAM RANK'), 120) || undefined;

    byPhone.set(mobileNumber, {
      studentName,
      mobileNumber,
      currentClass: normalizeCurrentClass(getRowValue(row, 'CURRENT CLASS')),
      city,
      entranceExamRank,
      parentName,
      parentMobileNumber,
      sessionAttendee: sessionAttendee || undefined,
      preferredLanguage: normalizeLanguage(getRowValue(row, 'Language', 'Language ')),
      line,
    });
  }

  return { leads: [...byPhone.values()], skipped };
}

function buildUpdatePayload(lead, now) {
  const payload = {
    studentName: lead.studentName,
    mobileNumber: lead.mobileNumber,
    currentClass: lead.currentClass,
    city: lead.city,
    formCompleted: true,
    currentStep: 3,
    utm_source: UTM_SOURCE,
    utm_campaign: UTM_CAMPAIGN,
    updatedAt: now,
  };

  if (lead.entranceExamRank) payload.entranceExamRank = lead.entranceExamRank;
  if (lead.parentName) payload.parentName = lead.parentName;
  if (lead.parentMobileNumber) payload.parentMobileNumber = lead.parentMobileNumber;
  if (lead.sessionAttendee) payload.sessionAttendee = lead.sessionAttendee;
  if (lead.preferredLanguage) payload.preferredLanguage = lead.preferredLanguage;

  return payload;
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
      console.log(
        `  ${lead.mobileNumber} ${lead.studentName} | ${lead.preferredLanguage} | ${lead.currentClass}`
      );
    }
    process.exit(0);
  }

  await connectDB();
  const now = new Date();
  let inserted = 0;
  let updated = 0;

  for (const lead of leads) {
    const $set = buildUpdatePayload(lead, now);
    const existing = await OneOnOneCounselingLead.findOne({ mobileNumber: lead.mobileNumber })
      .select('_id')
      .lean();

    await OneOnOneCounselingLead.findOneAndUpdate(
      { mobileNumber: lead.mobileNumber },
      {
        $setOnInsert: { createdAt: now, leadStatus: 'New Lead' },
        $set,
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    if (existing) updated += 1;
    else inserted += 1;

    if (process.env.DEBUG_SEED) {
      console.log(existing ? 'updated' : 'inserted', lead.mobileNumber, lead.studentName);
    }
  }

  const telugu = leads.filter((l) => l.preferredLanguage === 'Telugu').length;
  const hindi = leads.filter((l) => l.preferredLanguage === 'Hindi').length;
  const english = leads.length - telugu - hindi;
  console.log(
    `Done. inserted=${inserted}, updated=${updated}, Telugu=${telugu}, Hindi=${hindi}, English=${english}`
  );
  await OneOnOneCounselingLead.db.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
