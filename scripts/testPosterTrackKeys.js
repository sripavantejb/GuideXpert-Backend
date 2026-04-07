#!/usr/bin/env node
/**
 * Smoke-test POST /api/counsellor/poster-downloads/track for every allowed posterKey.
 * Usage: node scripts/testPosterTrackKeys.js [baseUrl]
 * Example: node scripts/testPosterTrackKeys.js https://guide-xpert-backend.vercel.app
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { POSTER_KEYS, FORMATS } = require('../utils/posterDownloadConstants');

const baseArg = process.argv[2] || 'https://guide-xpert-backend.vercel.app';
const base = baseArg.replace(/\/+$/, '');

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path.startsWith('http') ? path : `${base}${path}`);
    const lib = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request(
      u,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = JSON.parse(buf);
          } catch (_) {
            parsed = { raw: buf };
          }
          resolve({ status: res.statusCode, json: parsed });
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const path = '/api/counsellor/poster-downloads/track';
  let failed = false;
  for (const posterKey of POSTER_KEYS) {
    for (const format of FORMATS) {
      const { status, json } = await postJson(path, {
        posterKey,
        format,
        displayName: 'TrackSmokeTest',
        mobileNumber: '9999999999',
        routeContext: 'public',
      });
      const ok = status === 200 && json.success === true;
      if (!ok) failed = true;
      console.log(`${posterKey} ${format}: HTTP ${status} ${JSON.stringify(json)}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
