#!/usr/bin/env node
'use strict';

/**
 * Attempt to sync GUPSHUP credentials from Vercel production into .env.gupshup.local.
 * Sensitive Vercel secrets may not be decryptable via API — use Dashboard Reveal + set-gupshup-local-env.js.
 *
 *   node scripts/sync-gupshup-local-from-vercel.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const backendRoot = path.join(__dirname, '..');
const repoPath = path.join(backendRoot, '.vercel', 'repo.json');
const authPath = path.join(
  process.env.HOME,
  'Library/Application Support/com.vercel.cli/auth.json'
);

function loadProjectId() {
  if (!fs.existsSync(repoPath)) {
    throw new Error('Run `npx vercel link --project guide-xpert-backend --yes` in GuideXpert-Backend first.');
  }
  const repo = JSON.parse(fs.readFileSync(repoPath, 'utf8'));
  const project = repo.projects?.[0];
  if (!project?.id) throw new Error('Missing project id in .vercel/repo.json');
  return project.id;
}

function apiGet(token, urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.vercel.com',
        path: urlPath,
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  if (!fs.existsSync(authPath)) {
    throw new Error('Vercel CLI not logged in. Run `npx vercel login` first.');
  }
  const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
  const projectId = loadProjectId();
  const res = await apiGet(
    auth.token,
    `/v9/projects/${projectId}/env?decrypt=true&target=production`
  );
  if (res.status !== 200) {
    throw new Error(`Vercel API returned HTTP ${res.status}`);
  }
  const envs = res.body.envs || [];
  const pick = (key) => {
    const row = envs.find((entry) => entry.key === key);
    return row ? String(row.value || '').trim() : '';
  };
  const apiKey = pick('GUPSHUP_API_KEY');
  const source = pick('GUPSHUP_SOURCE');
  const srcName = pick('GUPSHUP_SRC_NAME');

  if (!apiKey || !source) {
    console.error(
      'Vercel did not return decrypted GUPSHUP credentials (sensitive secrets are often API-redacted).'
    );
    console.error(
      'Copy from Vercel Dashboard → guide-xpert-backend → Settings → Environment Variables → Reveal, then run:'
    );
    console.error(
      '  GUPSHUP_API_KEY=... GUPSHUP_SOURCE=... node scripts/set-gupshup-local-env.js'
    );
    process.exit(1);
  }

  const env = { ...process.env, GUPSHUP_API_KEY: apiKey, GUPSHUP_SOURCE: source };
  if (srcName) env.GUPSHUP_SRC_NAME = srcName;
  execSync('node scripts/set-gupshup-local-env.js', { cwd: backendRoot, stdio: 'inherit', env });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
