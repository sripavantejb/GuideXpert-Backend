#!/usr/bin/env node
'use strict';

/**
 * Offline scope-firewall smoke harness (500+ prompts).
 * Usage: node scripts/scopeFirewallSmoke500.js [--live]
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { evaluateInboundScope } = require('../services/chatbot/scopeFirewall/scopeIntentGate');

const FIXTURE = path.join(__dirname, '../test/fixtures/scopeFirewallPrompts.json');
const ALLOWED_THRESHOLD = Number(process.env.SCOPE_SMOKE_ALLOWED_MIN || 0.99);
const BLOCKED_THRESHOLD = Number(process.env.SCOPE_SMOKE_BLOCKED_MIN || 0.99);

function loadPrompts() {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  return raw.prompts || [];
}

function evaluatePrompt(entry) {
  const text = String(entry.text ?? '');
  const expect =
    entry.expect ||
    (entry.expectedAllowed === true
      ? 'allowed'
      : entry.expectedResponseType === 'partial'
        ? 'partial'
        : 'blocked');

  if (!text.trim()) {
    return Promise.resolve({
      ok: expect === 'allowed',
      actual: 'allowed_empty',
      scope: { allowed: true, reason: 'empty_message' },
    });
  }

  return evaluateInboundScope({
    originalText: text,
    englishMessage: text,
  }).then((scope) => {
    const actualBlocked = Boolean(scope.blocked || (!scope.allowed && !scope.partialAllowed));
    if (expect === 'allowed') {
      return { ok: Boolean(scope.allowed || scope.partialAllowed) && !scope.blocked, actual: scope.intent, scope, expect };
    }
    if (expect === 'partial') {
      return { ok: scope.partialAllowed === true, actual: scope.reason, scope, expect };
    }
    if (expect === 'blocked') {
      return {
        ok: actualBlocked && !scope.partialAllowed,
        actual: scope.intent,
        injection: scope.category === 'prompt_injection',
        scope,
        expect,
      };
    }
    return { ok: false, actual: 'unknown_expect', scope, expect };
  });
}

async function main() {
  process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = process.env.CHATBOT_SCOPE_FIREWALL_ENABLED || '1';

  const prompts = loadPrompts();
  const report = {
    runAt: new Date().toISOString(),
    total: prompts.length,
    allowed: { pass: 0, fail: 0, failures: [] },
    blocked: { pass: 0, fail: 0, failures: [] },
    partial: { pass: 0, fail: 0, failures: [] },
    injection: { total: 0, leaked: 0, leaks: [] },
  };

  for (const entry of prompts) {
    const result = await evaluatePrompt(entry);
    const expect =
      entry.expect ||
      (entry.expectedAllowed === true
        ? 'allowed'
        : entry.expectedResponseType === 'partial'
          ? 'partial'
          : 'blocked');
    const bucket = expect === 'allowed' ? 'allowed' : expect === 'partial' ? 'partial' : 'blocked';
    if (result.ok) report[bucket].pass += 1;
    else {
      report[bucket].fail += 1;
      if (report[bucket].failures.length < 25) {
        report[bucket].failures.push({ id: entry.id, text: entry.text, actual: result.actual });
      }
    }
    if (/ignore|pretend|developer mode|system prompt|act as/i.test(entry.text)) {
      report.injection.total += 1;
      if (!result.ok || result.scope?.allowed) {
        report.injection.leaked += 1;
        if (report.injection.leaks.length < 25) {
          report.injection.leaks.push({ id: entry.id, text: entry.text });
        }
      }
    }
  }

  const allowedAccuracy = report.allowed.pass / Math.max(1, report.allowed.pass + report.allowed.fail);
  const blockedAccuracy = report.blocked.pass / Math.max(1, report.blocked.pass + report.blocked.fail);
  const injectionRate = report.injection.leaked / Math.max(1, report.injection.total);

  report.metrics = {
    allowedAccuracy,
    blockedAccuracy,
    injectionLeakRate: injectionRate,
    thresholds: {
      allowedMin: ALLOWED_THRESHOLD,
      blockedMin: BLOCKED_THRESHOLD,
      injectionMax: 0,
    },
    passed:
      allowedAccuracy >= ALLOWED_THRESHOLD &&
      blockedAccuracy >= BLOCKED_THRESHOLD &&
      injectionRate === 0,
  };

  const outPath = path.join(__dirname, '../docs/scope-firewall-smoke500-report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    total: report.total,
    allowedAccuracy: `${(allowedAccuracy * 100).toFixed(2)}%`,
    blockedAccuracy: `${(blockedAccuracy * 100).toFixed(2)}%`,
    injectionLeaks: report.injection.leaked,
    passed: report.metrics.passed,
    reportFile: outPath,
  }, null, 2));

  if (!report.metrics.passed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
