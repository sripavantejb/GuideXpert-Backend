#!/usr/bin/env node
'use strict';

/**
 * Mechanical guards for Flow V3 push readiness (R-4).
 *
 * Usage:
 *   node scripts/ci/flowV3Guards.js              # all checks
 *   node scripts/ci/flowV3Guards.js --check=frozen
 *   node scripts/ci/flowV3Guards.js --check=pepper
 *   node scripts/ci/flowV3Guards.js --check=manifest
 *   node scripts/ci/flowV3Guards.js --check=test-deletions
 *   node scripts/ci/flowV3Guards.js --check=autoindex
 *
 * Exit 0 = green. Exit 1 = fail the build.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const FROZEN = ['services/chatbot/flowV2', 'services/chatbot/careerCounselling'];
const MANIFEST = path.join(ROOT, 'test/flowV3/TEST_NAME_MANIFEST.txt');

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function fail(msg) {
  console.error(`[flowV3Guards] FAIL: ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`[flowV3Guards] OK: ${msg}`);
}

function checkFrozen() {
  const base = process.env.FLOW_V3_GUARD_BASE || 'HEAD';
  const stat = run(`git diff --stat ${base} -- ${FROZEN.join(' ')}`);
  if (stat) {
    fail(`frozen paths have a non-empty diff against ${base}:\n${stat}`);
  } else {
    ok(`frozen paths empty vs ${base}`);
  }
}

function checkPepper() {
  let hits = '';
  const needle = 'FLOW_V3_PHONE_PEPPER';
  const excluded = new Set(['node_modules', '.git']);
  const selfFile = path.join('scripts', 'ci', 'flowV3Guards.js');

  function walk(relDir) {
    const absDir = path.join(ROOT, relDir);
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const rel = relDir ? path.join(relDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const relNorm = rel.replace(/\\/g, '/');
      if (relNorm === selfFile) continue;
      let src = '';
      try {
        src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      } catch {
        continue;
      }
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].includes(needle)) {
          hits += `${relNorm}:${i + 1}:${lines[i]}\n`;
        }
      }
    }
  }

  walk('');
  hits = hits.trim();
  if (hits) {
    fail(
      `FLOW_V3_PHONE_PEPPER must not appear anywhere (canonical is FLOW_V3_PHONE_HASH_PEPPER):\n${hits}`
    );
  } else {
    ok('FLOW_V3_PHONE_PEPPER absent');
  }
}

function currentTestNames() {
  const dir = path.join(ROOT, 'test/flowV3');
  const names = [];

  function walk(relDir) {
    const abs = path.join(dir, relDir);
    for (const file of fs.readdirSync(abs).sort()) {
      const absFile = path.join(abs, file);
      const relFile = relDir ? path.join(relDir, file) : file;
      if (fs.statSync(absFile).isDirectory()) {
        walk(relFile);
        continue;
      }
      if (!file.endsWith('.test.js')) continue;
      const src = fs.readFileSync(absFile, 'utf8');
      const re = /\b(?:test|it|g2bTest)\(\s*(['"`])([\s\S]*?)\1/g;
      let m;
      while ((m = re.exec(src))) {
        names.push(`${relFile.replace(/\\/g, '/')} :: ${m[2].replace(/\s+/g, ' ').trim()}`);
      }
    }
  }

  walk('');
  return names;
}

function checkManifest() {
  if (!fs.existsSync(MANIFEST)) {
    fail(`missing ${path.relative(ROOT, MANIFEST)}`);
    return;
  }
  const expected = fs
    .readFileSync(MANIFEST, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const actual = currentTestNames();
  const missing = expected.filter((n) => !actual.includes(n));
  const added = actual.filter((n) => !expected.includes(n));
  if (missing.length) {
    fail(
      `test-name manifest regressions (deleted or renamed without updating the manifest):\n${missing
        .map((n) => `  - ${n}`)
        .join('\n')}`
    );
  }
  if (added.length) {
    // Additions are fine if the manifest is updated in the same PR. Warn only
    // when CI runs with FLOW_V3_MANIFEST_STRICT=1.
    if (process.env.FLOW_V3_MANIFEST_STRICT === '1') {
      fail(
        `test-name manifest has uncommitted additions (update TEST_NAME_MANIFEST.txt):\n${added
          .map((n) => `  + ${n}`)
          .join('\n')}`
      );
    } else {
      console.log(`[flowV3Guards] NOTE: ${added.length} new test name(s) not yet in manifest`);
    }
  }
  if (!missing.length) ok(`test-name manifest intact (${expected.length} names)`);
}

function checkTestDeletions() {
  // Against merge base when available; otherwise HEAD. Fail on any deletion
  // under test/ unless the commit body carries ALLOW_TEST_DELETION.
  let base = process.env.FLOW_V3_GUARD_BASE || '';
  if (!base) {
    try {
      base = run('git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main');
    } catch {
      base = 'HEAD';
    }
  }
  let deleted = '';
  try {
    deleted = run(`git diff --diff-filter=D --name-only ${base} -- test/ || true`);
  } catch {
    deleted = '';
  }
  if (!deleted) {
    ok('no test/ deletions vs base');
    return;
  }
  let body = '';
  try {
    body = run('git log -1 --pretty=%B');
  } catch {
    body = '';
  }
  if (!/ALLOW_TEST_DELETION/.test(body)) {
    fail(
      `test/ deletions without ALLOW_TEST_DELETION in the commit body:\n${deleted}\n` +
        'Add ALLOW_TEST_DELETION to the commit message if the deletion is intentional.'
    );
  } else {
    ok('test/ deletions allowed by ALLOW_TEST_DELETION marker');
  }
}

function checkAutoindex() {
  // Owned by chore/mongoose-autoindex-safety (PR 2). On feat/flow-v3-foundation
  // alone the test file is absent until PR 2 merges; require the safety module
  // for Flow V3 Mongo tests, and run the full connect-site suite when present.
  const safetyTest = path.join(ROOT, 'test/mongooseIndexSafety.test.js');
  const safetyMod = path.join(ROOT, 'config/mongooseSafety.js');
  if (!fs.existsSync(safetyMod)) {
    fail('config/mongooseSafety.js missing — required by Flow V3 Mongo tests');
    return;
  }
  if (!fs.existsSync(safetyTest)) {
    ok(
      'mongooseIndexSafety.test.js not on this branch yet (PR 2 / chore/mongoose-autoindex-safety); ' +
        'config/mongooseSafety.js present'
    );
    return;
  }
  try {
    run('node --test test/mongooseIndexSafety.test.js');
    ok('mongooseIndexSafety.test.js green');
  } catch (err) {
    fail(`mongooseIndexSafety.test.js failed:\n${err.stdout || err.message}`);
  }
}

const checks = {
  frozen: checkFrozen,
  pepper: checkPepper,
  manifest: checkManifest,
  'test-deletions': checkTestDeletions,
  autoindex: checkAutoindex,
};

const arg = process.argv.find((a) => a.startsWith('--check='));
const selected = arg ? arg.slice('--check='.length) : null;

if (selected) {
  if (!checks[selected]) {
    fail(`unknown check '${selected}'. Known: ${Object.keys(checks).join(', ')}`);
  } else {
    checks[selected]();
  }
} else {
  for (const fn of Object.values(checks)) fn();
}

if (process.exitCode) {
  console.error('[flowV3Guards] one or more guards failed');
  process.exit(process.exitCode);
}
console.log('[flowV3Guards] all selected guards passed');
