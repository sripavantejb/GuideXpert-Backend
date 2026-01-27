const { google } = require('googleapis');

// Initialize Google Sheets client using Application Default Credentials (ADC)
// ADC automatically checks:
// 1. GOOGLE_APPLICATION_CREDENTIALS environment variable
// 2. User credentials from gcloud auth application-default login
// 3. Service account attached to GCP resource (if running on GCP)
// 4. Metadata server (if running on GCP Compute Engine/GKE)
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Create sheets client - auth will load credentials lazily on first API call
const sheets = google.sheets({ version: 'v4', auth });

// Cache for authenticated client
let authenticatedSheetsClient = null;

// Export async getter that ensures credentials are loaded before use
async function getSheetsClient() {
  console.log('[Google Sheets] getSheetsClient() called');
  
  if (authenticatedSheetsClient) {
    console.log('[Google Sheets] Using cached authenticated client');
    return authenticatedSheetsClient;
  }
  
  try {
    console.log('[Google Sheets] Attempting to load ADC credentials...');
    console.log('[Google Sheets] Checking for GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'set' : 'not set');
    
    // Get the authenticated client (this triggers credential loading)
    console.log('[Google Sheets] Calling auth.getClient()...');
    const authClient = await auth.getClient();
    console.log('[Google Sheets] auth.getClient() succeeded');
    
    // Get project ID and credentials info for debugging
    const projectId = await auth.getProjectId().catch(() => 'unknown');
    const credentials = authClient.credentials;
    
    console.log('[Google Sheets] ADC credentials loaded successfully');
    console.log(`[Google Sheets] Project ID: ${projectId}`);
    console.log(`[Google Sheets] Credential type: ${credentials ? 'loaded' : 'none'}`);
    
    // Create a new sheets client with the authenticated client
    authenticatedSheetsClient = google.sheets({ version: 'v4', auth: authClient });
    return authenticatedSheetsClient;
  } catch (error) {
    console.error('[Google Sheets] Failed to load ADC credentials:', error.message);
    console.error('[Google Sheets] Error code:', error.code);
    console.error('[Google Sheets] Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    throw error;
  }
}

// Create a wrapper that includes both the sheets client and the getter
// The sheets object from googleapis may not allow direct property assignment
const sheetsWrapper = {
  ...sheets,
  getClient: getSheetsClient
};

// Verify the method is attached (for debugging)
console.log('[Google Sheets] Config loaded. getClient method type:', typeof sheetsWrapper.getClient);
console.log('[Google Sheets] Wrapper has getClient:', 'getClient' in sheetsWrapper);

// Export the wrapper - it will have all sheets methods plus getClient
module.exports = sheetsWrapper;
