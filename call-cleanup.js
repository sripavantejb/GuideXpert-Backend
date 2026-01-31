#!/usr/bin/env node
/**
 * Call the cleanup endpoint to remove corrupted data
 * Usage: node call-cleanup.js <mobile_number>
 */

const https = require('https');

const mobile = process.argv[2] || '8919926373';

if (!/^\d{10}$/.test(mobile)) {
  console.error('Usage: node call-cleanup.js <10-digit-mobile-number>');
  console.error('Example: node call-cleanup.js 9876543210');
  process.exit(1);
}

console.log(`\nCalling cleanup endpoint for mobile: ${mobile}`);
console.log('='.repeat(50));

const data = JSON.stringify({ mobile });

const options = {
  hostname: 'guide-xpert-backend.vercel.app',
  path: '/api/meet/cleanup',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
  },
};

const req = https.request(options, (res) => {
  let responseData = '';
  
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log(`\nStatus: ${res.statusCode}`);
    console.log('Response:');
    try {
      const parsed = JSON.parse(responseData);
      console.log(JSON.stringify(parsed, null, 2));
      
      if (res.statusCode === 200) {
        console.log('\n✓ Cleanup successful!');
        console.log('\nYou can now:');
        console.log('1. Go to your frontend');
        console.log('2. Enter your mobile number');
        console.log('3. Request a new OTP');
        console.log('4. Verify and register');
      } else if (res.statusCode === 404) {
        console.log('\n⚠ The cleanup endpoint is not deployed yet.');
        console.log('Please deploy the updated backend first.');
      }
    } catch (e) {
      console.log(responseData);
    }
    console.log('='.repeat(50) + '\n');
  });
});

req.on('error', (error) => {
  console.error(`\n✗ Error: ${error.message}\n`);
  process.exit(1);
});

req.write(data);
req.end();
