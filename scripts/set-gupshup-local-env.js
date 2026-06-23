#!/usr/bin/env node
'use strict';

/**
 * Write GUPSHUP_API_KEY + GUPSHUP_SOURCE into .env.gupshup.local for local Human Copilot delivery.
 *
 * Usage (values from Vercel Dashboard → Reveal):
 *   GUPSHUP_API_KEY=your_key GUPSHUP_SOURCE=91XXXXXXXXXX node scripts/set-gupshup-local-env.js
 */
const fs = require('fs');
const path = require('path');

const apiKey = String(process.env.GUPSHUP_API_KEY || '').trim();
const source = String(process.env.GUPSHUP_SOURCE || '').trim();
const srcName = String(process.env.GUPSHUP_SRC_NAME || '').trim();

if (!apiKey || !source) {
  console.error('Set GUPSHUP_API_KEY and GUPSHUP_SOURCE in the environment before running this script.');
  console.error('Copy values from Vercel → guide-xpert-backend → Settings → Environment Variables → Reveal.');
  process.exit(1);
}

const lines = [
  '# Local Gupshup overrides (see scripts/set-gupshup-local-env.js)',
  'ENABLE_WHATSAPP=true',
  'WA_INTEGRATION_STUB=0',
  `GUPSHUP_API_KEY=${apiKey}`,
  `GUPSHUP_SOURCE=${source}`,
];
if (srcName) lines.push(`GUPSHUP_SRC_NAME=${srcName}`);
lines.push('');

const outPath = path.join(__dirname, '..', '.env.gupshup.local');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`Updated ${outPath} (stub off, credentials written — not printed).`);
