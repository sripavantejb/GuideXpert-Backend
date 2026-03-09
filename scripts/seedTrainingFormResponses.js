/**
 * Seed Training Form responses from a Google Forms CSV export.
 *
 * Usage:
 *   node scripts/seedTrainingFormResponses.js [path/to/file.csv]
 *
 * If no path is given, reads from scripts/data/training-form-responses.csv
 * (place your CSV there or pass the path as the first argument).
 *
 * CSV columns: Timestamp, What is your full name?, What is your mobile number?,
 * What is your email address?, What is your current occupation?,
 * How would you rate the session?, Is there anything you would like to convey or suggest?
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { parse } = require('csv-parse/sync');
const connectDB = require('../config/db');
const TrainingFormResponse = require('../models/TrainingFormResponse');

const CSV_PATH_ARG = process.argv[2];
const DEFAULT_CSV_PATH = path.join(__dirname, 'data', 'training-form-responses.csv');
const BATCH_SIZE = 100;

const COL = {
  TIMESTAMP: 'Timestamp',
  FULL_NAME: 'What is your full name?',
  MOBILE: 'What is your mobile number?',
  EMAIL: 'What is your email address?',
  OCCUPATION: 'What is your current occupation?',
  RATING: 'How would you rate the session?',
  SUGGESTIONS: 'Is there anything you would like to convey or suggest?'
};

/** Parse DD/MM/YYYY HH:MM:SS to Date; return null if invalid. */
function parseTimestamp(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  const [datePart, timePart] = trimmed.split(/\s+/);
  if (!datePart) return null;
  const [d, m, y] = datePart.split('/').map(Number);
  if (!y || !m || !d) return null;
  let hour = 0, minute = 0, second = 0;
  if (timePart) {
    const [h, min, sec] = timePart.split(':').map(Number);
    if (h != null && !Number.isNaN(h)) hour = h;
    if (min != null && !Number.isNaN(min)) minute = min;
    if (sec != null && !Number.isNaN(sec)) second = sec;
  }
  const date = new Date(y, m - 1, d, hour, minute, second);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Normalize mobile: digits only, last 10 (matches training form save and webinar login lookup). Return null if fewer than 10 digits. */
function normalizeMobile(str) {
  if (str == null) return null;
  const digits = String(str).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function isValidEmail(str) {
  if (!str || typeof str !== 'string') return false;
  return /^\S+@\S+\.\S+$/.test(str.trim());
}

function parseRating(val) {
  if (val == null || val === '') return 5;
  const n = parseInt(String(val).trim(), 10);
  if (Number.isNaN(n) || n < 1 || n > 5) return 5;
  return n;
}

function rowToDoc(row) {
  const fullName = row[COL.FULL_NAME] != null ? String(row[COL.FULL_NAME]).trim() : '';
  const mobileNumber = normalizeMobile(row[COL.MOBILE]);
  const emailRaw = row[COL.EMAIL] != null ? String(row[COL.EMAIL]).trim().toLowerCase() : '';
  const occupation = row[COL.OCCUPATION] != null ? String(row[COL.OCCUPATION]).trim().slice(0, 200) : '';
  const suggestions = (row[COL.SUGGESTIONS] != null ? String(row[COL.SUGGESTIONS]).trim().slice(0, 2000) : '') || '';
  const sessionRating = parseRating(row[COL.RATING]);
  const createdAt = parseTimestamp(row[COL.TIMESTAMP]) || new Date();
  const updatedAt = createdAt;

  if (fullName.length < 2) return { skip: true, reason: 'fullName too short or empty' };
  if (!mobileNumber) return { skip: true, reason: 'mobileNumber invalid or fewer than 10 digits' };
  if (!isValidEmail(emailRaw)) return { skip: true, reason: 'email invalid or empty' };
  if (!occupation) return { skip: true, reason: 'occupation empty' };

  return {
    skip: false,
    doc: {
      fullName: fullName.slice(0, 100),
      mobileNumber,
      email: emailRaw,
      occupation,
      sessionRating,
      suggestions,
      createdAt,
      updatedAt
    }
  };
}

async function seed() {
  const csvPath = CSV_PATH_ARG ? path.resolve(process.cwd(), CSV_PATH_ARG) : DEFAULT_CSV_PATH;

  if (!fs.existsSync(csvPath)) {
    console.error('CSV file not found:', csvPath);
    console.error('Usage: node scripts/seedTrainingFormResponses.js [path/to/file.csv]');
    process.exit(1);
  }

  let csvContent;
  try {
    csvContent = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  } catch (err) {
    console.error('Failed to read CSV:', err.message);
    process.exit(1);
  }

  let rows;
  try {
    rows = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    });
  } catch (err) {
    console.error('Failed to parse CSV:', err.message);
    process.exit(1);
  }

  const validDocs = [];
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const result = rowToDoc(rows[i]);
    if (result.skip) {
      skipped++;
      if (process.env.DEBUG_SEED) {
        console.warn(`Row ${i + 2} skipped: ${result.reason}`, JSON.stringify(rows[i]).slice(0, 80));
      }
    } else {
      validDocs.push(result.doc);
    }
  }

  console.log(`CSV rows: ${rows.length}, valid: ${validDocs.length}, skipped: ${skipped}`);

  if (validDocs.length === 0) {
    console.log('No valid rows to insert.');
    process.exit(0);
  }

  try {
    await connectDB();
  } catch (err) {
    console.error('DB connection failed:', err.message);
    process.exit(1);
  }

  let inserted = 0;
  for (let i = 0; i < validDocs.length; i += BATCH_SIZE) {
    const batch = validDocs.slice(i, i + BATCH_SIZE);
    try {
      await TrainingFormResponse.insertMany(batch);
      inserted += batch.length;
      console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} rows (total ${inserted})`);
    } catch (err) {
      if (err.writeErrors && err.writeErrors.length > 0) {
        for (const e of err.writeErrors) {
          console.error('Insert error:', e.errmsg || e.message);
        }
      } else {
        console.error('InsertMany error:', err.message);
      }
      process.exit(1);
    }
  }

  console.log(`Done. Inserted ${inserted} Training Form response(s).`);
  process.exit(0);
}

seed();
