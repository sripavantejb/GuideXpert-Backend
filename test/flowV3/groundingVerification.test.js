'use strict';

/**
 * F-2 regression — V-2 grounding verification (architecture §7.2).
 *
 * The anti-fabrication property: every cited grounding id must resolve to an
 * ACTUAL tool result from this turn, and every college / numeric / price /
 * placement claim must trace to a cited, resolved result. These tests fail
 * against the previous no-op implementation.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateEnvelope,
  extractCollegeMentions,
} = require('../../services/chatbot/flowV3LLM/validate/validateEnvelope');

function envelope(overrides = {}) {
  return {
    intent: 'answer_question',
    parts: [{ type: 'text', body: 'Happy to help with your college search.' }],
    grounding: [],
    profile_patch: {},
    booking_url_slot: null,
    ...overrides,
  };
}

const CATALOG_TRACE = [
  {
    name: 'get_curated_catalog',
    callId: 'cc_1',
    ok: true,
    result: {
      ok: true,
      rows: [
        { id: 'plaksha', name: 'Plaksha University', catalog: 'curated', feeBand: '~9 lakhs/yr' },
        { id: 'kalvium', name: 'Kalvium (Partner University Programs)', catalog: 'curated' },
      ],
    },
  },
];

describe('F-2: V-2 grounding verification blocks fabrication', () => {
  test('fabricated grounding id is BLOCKED', () => {
    const out = validateEnvelope(
      envelope({
        parts: [{ type: 'text', body: 'Plaksha University is a great fit for you.' }],
        grounding: ['curated:hogwarts'],
      }),
      { toolTrace: CATALOG_TRACE }
    );
    assert.equal(out.ok, false);
    assert.ok(
      out.violations.some((v) => v.code === 'V-2' && String(v.detail).includes('unresolved_grounding_id')),
      `expected unresolved_grounding_id, got ${JSON.stringify(out.violations)}`
    );
  });

  test('college absent from every tool result is BLOCKED', () => {
    const out = validateEnvelope(
      envelope({
        parts: [{ type: 'text', body: 'You should apply to Stanford University right away.' }],
        grounding: ['curated:plaksha'],
      }),
      { toolTrace: CATALOG_TRACE }
    );
    assert.equal(out.ok, false);
    assert.ok(
      out.violations.some((v) => v.code === 'V-2' && String(v.detail).includes('ungrounded_college')),
      `expected ungrounded_college, got ${JSON.stringify(out.violations)}`
    );
  });

  test('placement % appearing in no tool result is BLOCKED', () => {
    const out = validateEnvelope(
      envelope({
        parts: [{ type: 'text', body: 'Plaksha has 97% placements every year.' }],
        grounding: ['curated:plaksha'],
      }),
      { toolTrace: CATALOG_TRACE }
    );
    assert.equal(out.ok, false);
    assert.ok(
      out.violations.some((v) => v.code === 'V-2' && String(v.detail).includes('ungrounded_numeric')),
      `expected ungrounded_numeric, got ${JSON.stringify(out.violations)}`
    );
  });

  test('a REAL id cited but a claim that id does not support is BLOCKED', () => {
    // The envelope cites only the booking tool result, then names a college —
    // the college claim does not trace to the CITED result.
    const trace = [
      ...CATALOG_TRACE,
      { name: 'create_booking_link', callId: 'bk_1', ok: true, result: { serviceKey: 'one_on_one' } },
    ];
    const out = validateEnvelope(
      envelope({
        parts: [{ type: 'text', body: 'Kalvium is your best match.' }],
        grounding: ['booking:one_on_one'],
      }),
      { toolTrace: trace }
    );
    assert.equal(out.ok, false);
    assert.ok(
      out.violations.some((v) => v.code === 'V-2' && String(v.detail).includes('ungrounded_college:kalvium')),
      `expected ungrounded_college:kalvium, got ${JSON.stringify(out.violations)}`
    );
  });

  test('claims with zero grounding at all are BLOCKED', () => {
    const out = validateEnvelope(
      envelope({
        parts: [{ type: 'text', body: 'Kalvium has 95% placements.' }],
        grounding: [],
      }),
      { toolTrace: CATALOG_TRACE }
    );
    assert.equal(out.ok, false);
    assert.ok(out.violations.some((v) => v.code === 'V-2'));
  });
});

describe('F-2: correctly grounded envelopes still pass (no over-blocking)', () => {
  test('college + fee grounded in a cited result passes', () => {
    const out = validateEnvelope(
      envelope({
        parts: [
          { type: 'text', body: 'Plaksha University could suit you — fees are around 9 lakhs/yr.' },
        ],
        grounding: ['curated:plaksha'],
      }),
      { toolTrace: CATALOG_TRACE }
    );
    assert.equal(out.ok, true, `unexpected violations: ${JSON.stringify(out.violations)}`);
  });

  test("the student's own numbers (rank, budget) are not treated as fabrications", () => {
    const out = validateEnvelope(
      envelope({
        parts: [{ type: 'text', body: 'Got it — with rank 4500 we can look at good options.' }],
        grounding: [],
      }),
      { toolTrace: [], inboundText: 'my rank is 4500', profile: { rank: 4500 } }
    );
    assert.equal(out.ok, true, `unexpected violations: ${JSON.stringify(out.violations)}`);
  });

  test('a plain slot question with no claims needs no grounding', () => {
    const out = validateEnvelope(
      envelope({
        intent: 'ask_slot',
        parts: [{ type: 'text', body: 'What matters most to you when choosing where to study?' }],
        grounding: [],
      }),
      { toolTrace: [] }
    );
    assert.equal(out.ok, true, `unexpected violations: ${JSON.stringify(out.violations)}`);
  });
});

describe('F-2: college mention extraction', () => {
  test('detects catalog brands and generic proper-noun college names', () => {
    const mentions = extractCollegeMentions(
      'Plaksha and Harvard University are both options; Kalvium too.'
    );
    assert.ok(mentions.includes('plaksha'));
    assert.ok(mentions.includes('kalvium'));
    assert.ok(mentions.some((m) => m.includes('harvard')));
  });

  test('does not flag question phrasing like "Which university"', () => {
    const mentions = extractCollegeMentions('Which University do you prefer to join?');
    assert.equal(mentions.length, 0, `unexpected mentions: ${JSON.stringify(mentions)}`);
  });
});
