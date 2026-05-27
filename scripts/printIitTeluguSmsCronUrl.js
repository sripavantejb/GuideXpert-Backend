/**
 * Print the production cron URL for IIT Telugu SMS (paste into cron-job.org).
 *
 * Usage: node scripts/printIitTeluguSmsCronUrl.js
 *        npm run cron:url:iit-telugu-sms
 */
require('dotenv').config();
const { getCronSecretForOutboundPing } = require('../utils/cronSecret');

const BASE =
  process.env.BACKEND_PUBLIC_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  'https://guide-xpert-backend.vercel.app';

const secret = getCronSecretForOutboundPing();

if (!secret) {
  console.error('Set GUIDEXPERT_CRON_SECRET or CRON_SECRET in .env');
  process.exit(1);
}

const base = BASE.replace(/\/$/, '');
const url = `${base}/api/cron/send-iit-telugu-sms?key=${encodeURIComponent(secret)}`;

console.log('\nIIT Telugu SMS — cron-job.org URL (GET, every 1 minute, timeout ≥ 60s):\n');
console.log(url);
console.log('\nCreate job: https://console.cron-job.org/jobs/create');
console.log('Docs:     docs/cron-iit-telugu-sms.md\n');
