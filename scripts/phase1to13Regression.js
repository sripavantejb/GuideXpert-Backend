'use strict';

/**
 * Phase 1–13 local regression runner.
 * Run: node scripts/phase1to13Regression.js
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const STEPS = [
  { name: 'journey_1_13', cmd: 'node', args: ['--test', 'test/careerCounsellingJourney.test.js'] },
  { name: 'phase9_cert', cmd: 'node', args: ['scripts/phase9ProductionCertification.js'] },
  { name: 'phase10_cert', cmd: 'node', args: ['scripts/phase10ProductionCertification.js'] },
  { name: 'phase11_cert', cmd: 'node', args: ['scripts/phase11ProductionCertification.js'] },
  { name: 'niat_cert', cmd: 'node', args: ['scripts/niatInterestOneOnOneCertification.js'] },
  { name: 'phase12_cert', cmd: 'node', args: ['scripts/phase12ProductionCertification.js'] },
  { name: 'phase13_cert', cmd: 'node', args: ['scripts/phase13ProductionCertification.js'] },
];

function runStep(step) {
  const started = Date.now();
  const result = spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    name: step.name,
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exitCode: result.status,
    durationMs: Date.now() - started,
    stderrTail: String(result.stderr || '')
      .split('\n')
      .slice(-8)
      .join('\n'),
    stdoutTail: String(result.stdout || '')
      .split('\n')
      .slice(-12)
      .join('\n'),
  };
}

function main() {
  const results = [];
  for (const step of STEPS) {
    console.log(`\n=== ${step.name} ===`);
    const r = runStep(step);
    results.push(r);
    console.log(r.status, `${r.durationMs}ms`, `exit=${r.exitCode}`);
    if (r.status === 'FAIL') {
      if (r.stdoutTail) console.log(r.stdoutTail);
      if (r.stderrTail) console.error(r.stderrTail);
    }
  }

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const summary = {
    suite: 'phase_1_to_13_regression',
    total: results.length,
    pass,
    fail,
    overall: fail === 0 ? 'PASS' : 'FAIL',
    results,
  };
  console.log('\n' + JSON.stringify(summary, null, 2));
  process.exit(fail === 0 ? 0 : 2);
}

main();
