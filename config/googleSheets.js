const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// Initialize Google Sheets client using service account JSON key
const serviceAccountKeyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

if (!serviceAccountKeyPath) {
  console.error('[Google Sheets] GOOGLE_SERVICE_ACCOUNT_KEY_PATH not set');
  module.exports = null;
  return;
}

// Resolve absolute path
const keyPath = path.isAbsolute(serviceAccountKeyPath)
  ? serviceAccountKeyPath
  : path.resolve(__dirname, '..', serviceAccountKeyPath);

if (!fs.existsSync(keyPath)) {
  console.error(`[Google Sheets] Service account key file not found: ${keyPath}`);
  module.exports = null;
  return;
}

const auth = new google.auth.GoogleAuth({
  keyFile: keyPath,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

console.log('[Google Sheets] Client initialized with service account');
console.log('[Google Sheets] Service account: sheets-sync@guidexpert.iam.gserviceaccount.com');

module.exports = sheets;
