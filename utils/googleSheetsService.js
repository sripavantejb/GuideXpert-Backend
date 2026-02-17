const sheets = require('../config/googleSheets');
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Formresponses'; // Sheet tab name (case-sensitive, no spaces)

// Cache for actual sheet name (will be set to SHEET_NAME if detection fails)
let actualSheetName = null;

// Log configuration on module load (for debugging)
if (SHEET_ID) {
  console.log(`[Google Sheets] Configuration: SHEET_ID=${SHEET_ID}, SHEET_NAME=${SHEET_NAME}`);
  console.log('[Google Sheets] Using sheet name:', SHEET_NAME);
  console.log('[Google Sheets] Ensure the sheet is shared with: sheets-sync@guidexpert.iam.gserviceaccount.com (Editor access)');
} else {
  console.warn('[Google Sheets] GOOGLE_SHEET_ID not configured');
}

/**
 * Get the sheet name (using configured name directly)
 * @returns {Promise<string>} - The sheet name
 */
async function getActualSheetName() {
  // Use the configured sheet name directly
  return SHEET_NAME;
}

/**
 * Convert FormSubmission document to array of values matching Google Sheet columns
 * Column order: A=_id, B=fullName, C=phone, D=occupation, E=demoInterest, F=selectedSlot, G=createdAt, H=__v
 */
function formatRowData(doc) {
  return [
    doc._id ? String(doc._id) : '',           // Column A: _id
    doc.fullName || '',                       // Column B: fullName
    doc.phone || '',                          // Column C: phone
    doc.occupation || '',                     // Column D: occupation
    doc.demoInterest || '',                   // Column E: demoInterest
    doc.selectedSlot || '',                   // Column F: selectedSlot
    doc.createdAt ? new Date(doc.createdAt).toISOString() : '', // Column G: createdAt
    doc.__v !== undefined ? String(doc.__v) : '0' // Column H: __v
  ];
}

/**
 * Append a new row to Google Sheet
 * @param {Object} doc - FormSubmission document
 * @returns {Promise<number|null>} - Row number (1-indexed) or null on error
 */
async function appendRow(doc) {
  if (!SHEET_ID) {
    console.error('[Google Sheets] GOOGLE_SHEET_ID not set');
    return null;
  }
  if (!sheets) {
    console.error('[Google Sheets] Client not initialized');
    return null;
  }

  try {
    const sheetName = await getActualSheetName();
    const lastRow = await getLastRowNumber();
    const newRowNumber = lastRow + 1;

    const values = [formatRowData(doc)];
    const range = `${sheetName}!A:H`; // Append to columns A through H

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: values
      }
    });

    console.log(`[Google Sheets] Appended row ${newRowNumber} for document ${doc._id}`);
    return newRowNumber;
  } catch (error) {
    // Enhanced error logging for debugging
    const errorDetails = {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      spreadsheetId: SHEET_ID
    };
    console.error(`[Google Sheets] Error appending row for document ${doc._id}:`, JSON.stringify(errorDetails, null, 2));
    
    // Check for common permission errors
    if (error.code === 403 || error.response?.status === 403) {
      console.error('[Google Sheets] Permission denied. Ensure the Google Sheet is shared with sheets-sync@guidexpert.iam.gserviceaccount.com with Editor access.');
    }
    if (error.code === 404 || error.response?.status === 404) {
      console.error(`[Google Sheets] Spreadsheet not found. Verify GOOGLE_SHEET_ID: ${SHEET_ID}`);
    }
    
    return null;
  }
}

/**
 * Update an existing row in Google Sheet
 * @param {number} rowNumber - Row number (1-indexed, where 1 is header)
 * @param {Object} doc - FormSubmission document with updated data
 * @returns {Promise<boolean>} - true on success, false on error
 */
async function updateRow(rowNumber, doc) {
  if (!SHEET_ID) {
    console.error('[Google Sheets] GOOGLE_SHEET_ID not set');
    return false;
  }
  if (!sheets) {
    console.error('[Google Sheets] Client not initialized');
    return false;
  }

  if (!rowNumber || rowNumber < 2) {
    console.error(`[Google Sheets] Invalid row number: ${rowNumber} (must be >= 2 to skip header)`);
    return false;
  }

  try {
    const sheetName = await getActualSheetName();
    const values = [formatRowData(doc)];
    const range = `${sheetName}!A${rowNumber}:H${rowNumber}`; // Update specific row

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: values
      }
    });

    console.log(`[Google Sheets] Updated row ${rowNumber} for document ${doc._id}`);
    return true;
  } catch (error) {
    // Enhanced error logging for debugging
    const errorDetails = {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      spreadsheetId: SHEET_ID,
      rowNumber: rowNumber
    };
    console.error(`[Google Sheets] Error updating row ${rowNumber} for document ${doc._id}:`, JSON.stringify(errorDetails, null, 2));
    
    // Check for common permission errors
    if (error.code === 403 || error.response?.status === 403) {
      console.error('[Google Sheets] Permission denied. Ensure the Google Sheet is shared with sheets-sync@guidexpert.iam.gserviceaccount.com with Editor access.');
    }
    if (error.code === 404 || error.response?.status === 404) {
      console.error(`[Google Sheets] Spreadsheet not found. Verify GOOGLE_SHEET_ID: ${SHEET_ID}`);
    }
    
    return false;
  }
}

/**
 * Mark a row as DELETED in Google Sheet (set status column, don't delete row)
 * @param {number} rowNumber - Row number (1-indexed)
 * @returns {Promise<boolean>} - true on success, false on error
 */
async function markRowDeleted(rowNumber) {
  if (!SHEET_ID) {
    console.error('[Google Sheets] GOOGLE_SHEET_ID not set');
    return false;
  }
  if (!sheets) {
    console.error('[Google Sheets] Client not initialized');
    return false;
  }

  if (!rowNumber || rowNumber < 2) {
    console.error(`[Google Sheets] Invalid row number: ${rowNumber} (must be >= 2 to skip header)`);
    return false;
  }

  try {
    const sheetName = await getActualSheetName();
    // We'll add a status column (Column I) to mark as DELETED
    // If status column doesn't exist, we'll create it
    const range = `${sheetName}!I${rowNumber}`;
    const values = [['DELETED']];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: values
      }
    });

    console.log(`[Google Sheets] Marked row ${rowNumber} as DELETED`);
    return true;
  } catch (error) {
    // Enhanced error logging for debugging
    const errorDetails = {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      spreadsheetId: SHEET_ID,
      rowNumber: rowNumber
    };
    console.error(`[Google Sheets] Error marking row ${rowNumber} as DELETED:`, JSON.stringify(errorDetails, null, 2));
    
    // Check for common permission errors
    if (error.code === 403 || error.response?.status === 403) {
      console.error('[Google Sheets] Permission denied. Ensure the Google Sheet is shared with sheets-sync@guidexpert.iam.gserviceaccount.com with Editor access.');
    }
    if (error.code === 404 || error.response?.status === 404) {
      console.error(`[Google Sheets] Spreadsheet not found. Verify GOOGLE_SHEET_ID: ${SHEET_ID}`);
    }
    
    return false;
  }
}

/**
 * Get the last row number in the sheet (for calculating append row number)
 * This is a helper function if needed
 * @returns {Promise<number>} - Last row number or 1 (header row) if empty
 */
async function getLastRowNumber() {
  if (!SHEET_ID) {
    return 1;
  }
  if (!sheets) {
    return 1;
  }

  try {
    const sheetName = await getActualSheetName();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A:A`, // Check column A
    });

    const rows = response.data.values || [];
    return rows.length; // Returns 1 if only header exists
  } catch (error) {
    // Enhanced error logging for debugging
    const errorDetails = {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      spreadsheetId: SHEET_ID
    };
    console.error('[Google Sheets] Error getting last row number:', JSON.stringify(errorDetails, null, 2));
    
    // Check for common permission errors
    if (error.code === 403 || error.response?.status === 403) {
      console.error('[Google Sheets] Permission denied. Ensure the Google Sheet is shared with sheets-sync@guidexpert.iam.gserviceaccount.com with Editor access.');
    }
    if (error.code === 404 || error.response?.status === 404) {
      console.error(`[Google Sheets] Spreadsheet not found. Verify GOOGLE_SHEET_ID: ${SHEET_ID}`);
    }
    
    return 1;
  }
}

module.exports = {
  appendRow,
  updateRow,
  markRowDeleted,
  getLastRowNumber
};
