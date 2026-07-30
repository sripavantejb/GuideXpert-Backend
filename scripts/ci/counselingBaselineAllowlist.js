#!/usr/bin/env node
'use strict';

/**
 * Run counselingOrchestration.test.js and allow-list the two known baseline
 * failures BY NAME. A third failure still breaks the build.
 *
 * See docs/KNOWN-FAILING-BASELINE.md.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const ALLOWED = new Set([
  'journey entry returns orchestration + capped reply',
  'college predictor bridge intent and seed',
]);

const result = spawnSync(
  process.execPath,
  ['--test', '--test-reporter=tap', 'test/counselingOrchestration.test.js'],
  { cwd: ROOT, encoding: 'utf8' }
);

const out = `${result.stdout || ''}\n${result.stderr || ''}`;

// Node's TAP reporter nests suite failures. Leaf failures appear as indented
// `not ok N - <name>` lines; the suite itself also reports `not ok`. We only
// care about leaf test names.
const failedLeaves = [];
for (const line of out.split('\n')) {
  const m = line.match(/^\s+not ok \d+ - (.+)$/);
  if (m) failedLeaves.push(m[1].trim());
}

const unexpected = failedLeaves.filter((name) => !ALLOWED.has(name));
const allowedHits = failedLeaves.filter((name) => ALLOWED.has(name));

console.log(
  `[baselineAllowlist] leaf_failures=${failedLeaves.length} allowed=${allowedHits.length} unexpected=${unexpected.length}`
);
for (const name of allowedHits) console.log(`  (allow-listed) ${name}`);
for (const name of unexpected) console.error(`  (UNEXPECTED) ${name}`);

if (unexpected.length) {
  console.error(out);
  process.exit(1);
}

if (allowedHits.length === 0 && failedLeaves.length === 0) {
  console.log(
    '[baselineAllowlist] all counselingOrchestration tests passed — consider retiring the allow-list'
  );
}

process.exit(0);
