// Quick test script to check if the endpoint is accessible
// Run this with: node test-endpoint.js

const https = require('https');

const testEndpoint = (path, method = 'GET', body = null) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'guide-xpert-backend.vercel.app',
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`\n${method} ${path}`);
        console.log(`Status: ${res.statusCode}`);
        console.log(`Response:`, data);
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
};

async function runTests() {
  console.log('Testing Guide Xpert Backend Endpoints...\n');
  console.log('='.repeat(50));

  // Test 1: Health check
  await testEndpoint('/api/health');

  // Test 2: Direct register (no OTP) - preferred for meet
  await testEndpoint('/api/meet/register', 'POST', {
    name: 'Test User',
    email: 'test@example.com',
    mobile: '8888888888'
  });

  // Test 3: Send OTP (legacy)
  await testEndpoint('/api/meet/send-otp', 'POST', {
    name: 'Test User',
    email: 'test@example.com',
    mobile: '9999999999'
  });

  console.log('\n' + '='.repeat(50));
  console.log('\nIf /api/meet/register returns 404: redeploy backend (vercel --prod)');
  console.log('If you see 500 errors, check:');
  console.log('1. Vercel Environment Variables (especially MONGODB_URI)');
  console.log('2. MongoDB Atlas Network Access (allow 0.0.0.0/0)');
  console.log('3. Vercel deployment logs for detailed error');
}

runTests().catch(console.error);
