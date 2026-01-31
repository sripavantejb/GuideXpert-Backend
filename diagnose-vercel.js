#!/usr/bin/env node
/**
 * Comprehensive Vercel Backend Diagnostic Tool
 * Tests all endpoints and identifies configuration issues
 */

const https = require('https');

const BASE_URL = 'guide-xpert-backend.vercel.app';
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, symbol, message) {
  console.log(`${color}${symbol}${colors.reset} ${message}`);
}

function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GuideXpert-Diagnostic/1.0',
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers, parseError: true });
        }
      });
    });

    req.on('error', (error) => reject(error));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function testEndpoint(name, path, method = 'GET', body = null, expectedStatus = 200) {
  try {
    console.log(`\n${colors.cyan}Testing: ${name}${colors.reset}`);
    console.log(`  ${method} ${path}`);
    
    const start = Date.now();
    const result = await makeRequest(path, method, body);
    const duration = Date.now() - start;

    if (result.status === expectedStatus) {
      log(colors.green, '✓', `Success (${result.status}) - ${duration}ms`);
      if (result.data && !result.parseError) {
        console.log(`  Response: ${JSON.stringify(result.data).substring(0, 100)}...`);
      }
      return { success: true, result };
    } else {
      log(colors.yellow, '⚠', `Unexpected status ${result.status} (expected ${expectedStatus})`);
      if (result.data) {
        console.log(`  Response: ${JSON.stringify(result.data)}`);
      }
      return { success: false, result };
    }
  } catch (error) {
    log(colors.red, '✗', `Failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runDiagnostics() {
  console.log('\n' + '='.repeat(70));
  console.log(`${colors.blue}GuideXpert Backend Diagnostics${colors.reset}`);
  console.log(`Target: https://${BASE_URL}`);
  console.log('='.repeat(70));

  const results = {
    passed: 0,
    failed: 0,
    warnings: 0,
  };

  // Test 1: Health Check
  const health = await testEndpoint(
    'Health Check',
    '/api/health',
    'GET',
    null,
    200
  );
  if (health.success) results.passed++;
  else results.failed++;

  // Test 2: Invalid endpoint (should return 404)
  const notFound = await testEndpoint(
    '404 Handling',
    '/api/nonexistent',
    'GET',
    null,
    404
  );
  if (notFound.success) results.passed++;
  else results.warnings++;

  // Test 3: Send OTP (will fail if env vars missing)
  const sendOtp = await testEndpoint(
    'Send OTP',
    '/api/meet/send-otp',
    'POST',
    {
      name: 'Test User',
      email: 'test@example.com',
      mobile: '9999999999',
    },
    200
  );
  if (sendOtp.success) {
    results.passed++;
    log(colors.green, '✓', 'OTP system is working! SMS should be sent.');
  } else {
    results.failed++;
    
    // Analyze the error
    if (sendOtp.result?.status === 500) {
      log(colors.red, '✗', 'CRITICAL: 500 error - likely missing environment variables or MongoDB connection failure');
      console.log('\n' + colors.yellow + 'Possible causes:' + colors.reset);
      console.log('  1. MSG91_AUTH_KEY not set in Vercel');
      console.log('  2. MSG91_TEMPLATE_ID not set in Vercel');
      console.log('  3. OTP_SECRET not set in Vercel');
      console.log('  4. MONGODB_URI not set or incorrect');
      console.log('  5. MongoDB Atlas not allowing Vercel IPs (need 0.0.0.0/0)');
    } else if (sendOtp.result?.status === 400) {
      log(colors.yellow, '⚠', 'Validation error - check request format');
    }
  }

  // Test 4: Verify OTP with invalid data (should return 400)
  const verifyOtp = await testEndpoint(
    'Verify OTP (Invalid)',
    '/api/meet/verify-otp',
    'POST',
    {
      mobile: '9999999999',
      otp: '000000',
    },
    400
  );
  if (verifyOtp.result?.status === 500) {
    results.failed++;
    log(colors.red, '✗', 'CRITICAL: verify-otp endpoint returning 500');
    log(colors.red, '→', 'This is the error you\'re experiencing!');
  } else if (verifyOtp.result?.status === 400) {
    results.passed++;
    log(colors.green, '✓', 'Endpoint is reachable (returning expected 400 for invalid OTP)');
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log(`${colors.blue}Diagnostic Summary${colors.reset}`);
  console.log('='.repeat(70));
  console.log(`${colors.green}✓ Passed: ${results.passed}${colors.reset}`);
  console.log(`${colors.red}✗ Failed: ${results.failed}${colors.reset}`);
  console.log(`${colors.yellow}⚠ Warnings: ${results.warnings}${colors.reset}`);

  console.log('\n' + colors.cyan + 'Next Steps:' + colors.reset);
  
  if (results.failed > 0) {
    console.log('\n' + colors.yellow + '⚠ ACTION REQUIRED:' + colors.reset);
    console.log('\n1. Go to Vercel Dashboard:');
    console.log('   https://vercel.com/dashboard');
    console.log('\n2. Select "guide-xpert-backend" project');
    console.log('\n3. Go to Settings → Environment Variables');
    console.log('\n4. Verify these are set:');
    console.log('   - MSG91_AUTH_KEY');
    console.log('   - MSG91_TEMPLATE_ID');
    console.log('   - OTP_SECRET');
    console.log('   - MONGODB_URI');
    console.log('   - ADMIN_JWT_SECRET');
    console.log('   - FRONTEND_URL');
    console.log('   - GOOGLE_MEET_LINK');
    console.log('\n5. Go to MongoDB Atlas:');
    console.log('   https://cloud.mongodb.com');
    console.log('\n6. Navigate to: Network Access');
    console.log('\n7. Add IP: 0.0.0.0/0 (allow all - required for Vercel)');
    console.log('\n8. After changes, redeploy:');
    console.log('   - In Vercel Dashboard → Deployments → Redeploy');
    console.log('   - Wait 2-3 minutes for deployment');
    console.log('   - Run this diagnostic script again');
  } else {
    console.log(`\n${colors.green}✓ Backend appears to be configured correctly!${colors.reset}`);
    console.log('\nIf you\'re still seeing errors in the frontend:');
    console.log('1. Check browser console for CORS errors');
    console.log('2. Verify frontend REACT_APP_API_URL is correct');
    console.log('3. Clear browser cache and try again');
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

// Run diagnostics
runDiagnostics().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
