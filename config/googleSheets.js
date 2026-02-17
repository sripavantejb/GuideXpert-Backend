const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let sheets = null;

// Option A: Credentials from env — use for both local and hosting (Vercel/Railway/etc.); no file needed
const credentialsJson = process.env.GOOGLE_SHEETS_CREDENTIALS_JSON;
if (credentialsJson && typeof credentialsJson === 'string') {
  try {
    const credentials = JSON.parse(credentialsJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: SCOPES,
    });
    sheets = google.sheets({ version: 'v4', auth });
    console.log('[Google Sheets] Client initialized from GOOGLE_SHEETS_CREDENTIALS_JSON (env)');
  } catch (e) {
    console.error('[Google Sheets] Invalid GOOGLE_SHEETS_CREDENTIALS_JSON:', e.message);
  }
}

// Option B: Key file (for local dev — GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_APPLICATION_CREDENTIALS)
if (!sheets) {
  const serviceAccountKeyPath =
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (serviceAccountKeyPath) {
    const keyPath = path.isAbsolute(serviceAccountKeyPath)
      ? serviceAccountKeyPath
      : path.resolve(__dirname, '..', serviceAccountKeyPath);
    if (fs.existsSync(keyPath)) {
      const auth = new google.auth.GoogleAuth({
        keyFile: keyPath,
        scopes: SCOPES,
      });
      sheets = google.sheets({ version: 'v4', auth });
      console.log('[Google Sheets] Client initialized with key file');
    } else {
      console.error(`[Google Sheets] Key file not found: ${keyPath}`);
    }
  }
}

if (!sheets) {
  console.warn('[Google Sheets] No credentials: set GOOGLE_SHEETS_CREDENTIALS_JSON (env) or GOOGLE_APPLICATION_CREDENTIALS (file path)');
}

module.exports = sheets;
