'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FIXTURE = path.join(__dirname, 'fixtures/scopeFirewallPrompts.json');
const REQUIRED = [
  'id',
  'category',
  'text',
  'expectedIntent',
  'expectedAllowed',
  'expectedResponseType',
  'expectedReason',
];

describe('scope firewall certification corpus', () => {
  test('fixture has 1000+ prompts with required metadata', () => {
    const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const prompts = raw.prompts || [];
    assert.ok(prompts.length >= 1000, `expected >=1000 prompts, got ${prompts.length}`);

    const categories = new Set();
    for (const entry of prompts) {
      for (const field of REQUIRED) {
        assert.ok(field in entry, `missing ${field} on ${entry.id || 'unknown'}`);
      }
      categories.add(entry.category);
    }

    const mins = {
      programming: 100,
      general_knowledge: 75,
      entertainment: 50,
      shopping: 50,
      medical_legal_finance: 75,
      prompt_injection: 150,
      mixed: 150,
      obfuscated: 100,
      translation_summarization: 75,
      in_scope_counselling: 150,
      boundary: 75,
      stress: 1,
    };

    const counts = {};
    for (const p of prompts) {
      counts[p.category] = (counts[p.category] || 0) + 1;
    }

    for (const [cat, min] of Object.entries(mins)) {
      assert.ok((counts[cat] || 0) >= min, `${cat} needs >=${min}, got ${counts[cat] || 0}`);
    }
  });
});
