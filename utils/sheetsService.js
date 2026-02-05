/**
 * Google Sheets append service.
 * Uses service account JSON (env GOOGLE_SHEETS_CREDENTIALS_JSON or file path GOOGLE_APPLICATION_CREDENTIALS).
 * Sheet must be shared with the service account email with Editor access.
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function getCredentials() {
  const jsonString = process.env.GOOGLE_SHEETS_CREDENTIALS_JSON;
  if (jsonString && typeof jsonString === 'string') {
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      console.error('[Sheets] Invalid GOOGLE_SHEETS_CREDENTIALS_JSON:', e.message);
      return null;
    }
  }
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath) {
    const resolved = path.isAbsolute(keyPath) ? keyPath : path.resolve(process.cwd(), keyPath);
    if (!fs.existsSync(resolved)) {
      console.error('[Sheets] Credentials file not found:', resolved, '(set GOOGLE_APPLICATION_CREDENTIALS or create the file)');
      return null;
    }
    return resolved;
  }
  console.error('[Sheets] No credentials: set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SHEETS_CREDENTIALS_JSON in .env');
  return null;
}

function getAuthClient() {
  const creds = getCredentials();
  if (!creds) return null;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: typeof creds === 'object' ? creds : undefined,
      keyFile: typeof creds === 'string' ? creds : undefined,
      scopes: SCOPES
    });
    return auth;
  } catch (e) {
    console.error('[Sheets] Auth client error:', e.message);
    return null;
  }
}

/**
 * Build a single row array from a FormSubmission document for appending to the sheet.
 */
function submissionToRow(submission) {
  const doc = submission && typeof submission.toObject === 'function' ? submission.toObject() : submission;
  if (!doc) return null;
  const step1 = doc.step1Data || {};
  const step3 = doc.step3Data || {};
  const post = doc.postRegistrationData || {};
  return [
    doc.fullName ?? '',
    doc.phone ?? '',
    doc.occupation ?? '',
    doc.currentStep ?? '',
    doc.applicationStatus ?? '',
    doc.isRegistered ? 'Yes' : 'No',
    doc.email ?? post.email ?? '',
    doc.interestLevel ?? post.interestLevel ?? '',
    doc.selectedSlot ?? step3.selectedSlot ?? '',
    doc.registeredAt ? new Date(doc.registeredAt).toISOString() : '',
    doc.createdAt ? new Date(doc.createdAt).toISOString() : '',
    doc.updatedAt ? new Date(doc.updatedAt).toISOString() : '',
    doc.utm_source ?? '',
    doc.utm_medium ?? '',
    doc.utm_campaign ?? '',
    doc.utm_content ?? ''
  ];
}

/**
 * Append one row to the sheet. Best-effort: logs errors, never throws.
 * @param {string} sheetId - Google Sheet ID (from URL)
 * @param {object} submission - FormSubmission document or plain object
 * @param {string} [range] - A1 range, e.g. "Sheet1" or "Submissions"
 * @returns {{ success: boolean, error?: string }}
 */
async function appendFormSubmission(sheetId, submission, range = 'Sheet1') {
  if (!sheetId || !submission) {
    return { success: false, error: 'Missing sheetId or submission' };
  }
  const auth = getAuthClient();
  if (!auth) {
    console.error('[Sheets] Append skipped: no credentials (set GOOGLE_SHEETS_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS)');
    return { success: false, error: 'Sheets credentials not configured' };
  }
  const row = submissionToRow(submission);
  if (!row) {
    return { success: false, error: 'Could not build row from submission' };
  }
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });
    return { success: true };
  } catch (e) {
    const msg = e.message || String(e);
    console.error('[Sheets] Append failed:', msg);
    if (e.response?.data?.error) {
      console.error('[Sheets] API error:', JSON.stringify(e.response.data.error));
    }
    return { success: false, error: msg };
  }
}

module.exports = {
  appendFormSubmission,
  submissionToRow
};
