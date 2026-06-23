#!/usr/bin/env node
'use strict';

/**
 * Print Gupshup runtime env as seen after server.js dotenv load order.
 * Usage: node scripts/verify-gupshup-runtime-env.js
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const root = path.join(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });
const gupshupLocal = path.join(root, '.env.gupshup.local');
if (fs.existsSync(gupshupLocal)) {
  dotenv.config({ path: gupshupLocal, override: true });
}

function maskKey(v) {
  if (!v) return '(unset)';
  const s = String(v);
  return `len=${s.length} ${s.slice(0, 4)}...${s.slice(-4)}`;
}

const { getHumanCopilotConfigStatus } = require('../utils/humanCopilotConfigStatus');

console.log({
  ENABLE_WHATSAPP: process.env.ENABLE_WHATSAPP ?? '(unset)',
  WA_INTEGRATION_STUB: process.env.WA_INTEGRATION_STUB ?? '(unset)',
  GUPSHUP_API_KEY: maskKey(process.env.GUPSHUP_API_KEY),
  GUPSHUP_SOURCE: process.env.GUPSHUP_SOURCE ?? '(unset)',
  NODE_ENV: process.env.NODE_ENV ?? '(unset)',
  copilotConfig: getHumanCopilotConfigStatus(),
});
