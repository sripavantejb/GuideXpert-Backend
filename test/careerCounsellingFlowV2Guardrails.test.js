'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  GUARANTEE_FORBIDDEN,
  URL_FORBIDDEN,
  collectGuardrailViolations,
  assertGuardrails,
} = require('../constants/careerCounsellingFlowV2Guardrails');

describe('careerCounsellingFlowV2Guardrails', () => {
  test('assertGuardrails throws on "guaranteed admission"', () => {
    assert.throws(() => assertGuardrails('This gives you guaranteed admission.'), /Flow v2 guardrail violation/);
  });

  test('assertGuardrails passes clean text through unchanged', () => {
    const text = 'This can help you explore colleges that fit your goals.';
    assert.equal(assertGuardrails(text), text);
  });

  test('collectGuardrailViolations flags "guaranteed admission" without throwing', () => {
    const violations = collectGuardrailViolations('This gives you guaranteed admission.');
    assert.ok(violations.length > 0);
    assert.ok(violations.some((v) => v.pattern.includes('guaranteed')));
  });

  test('collectGuardrailViolations returns empty array for clean text', () => {
    const violations = collectGuardrailViolations('This can help you explore colleges that fit your goals.');
    assert.deepEqual(violations, []);
  });

  test('URL_FORBIDDEN flags booking URLs', () => {
    const violations = collectGuardrailViolations('Book here: https://www.guidexpert.co.in/one-on-one-session', URL_FORBIDDEN);
    assert.ok(violations.length > 0);
  });

  test('GUARANTEE_FORBIDDEN and URL_FORBIDDEN are non-empty frozen arrays', () => {
    assert.ok(Array.isArray(GUARANTEE_FORBIDDEN) && GUARANTEE_FORBIDDEN.length > 0);
    assert.ok(Array.isArray(URL_FORBIDDEN) && URL_FORBIDDEN.length > 0);
    assert.throws(() => GUARANTEE_FORBIDDEN.push(/x/));
  });
});
