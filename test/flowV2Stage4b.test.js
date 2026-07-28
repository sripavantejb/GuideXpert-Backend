'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { handleB1Entry, goalPriorityAckLine } = require('../services/chatbot/flowV2/nodes/b1Goal');
const { branchAckLine } = require('../services/chatbot/flowV2/nodes/b2Branch');
const { handleB3Entry, handleB3Reply, B3_FRAMING_LINE } = require('../services/chatbot/flowV2/nodes/b3Constraints');
const { handleB5Entry } = require('../services/chatbot/flowV2/nodes/b5Shortlist');
const { handleB7Reply, TOPIC_REPLIES } = require('../services/chatbot/flowV2/nodes/b7Book');
const handoffService = require('../services/chatbot/handoffService');
const WhatsAppAgentHandoff = require('../models/WhatsAppAgentHandoff');

function ctx(stage, patch = {}, extra = {}) {
  return { flowV2: { stage, profile: { ...emptyFlowV2Profile(), ...patch }, ...extra } };
}

describe('Master Flow Stage 4b — B1/B2/B3/B5/B7 reconciliation', () => {
  test('B1 qualification and choice acknowledgements use locked copy', () => {
    assert.match(handleB1Entry(ctx(null, { qualification: '12th Completed (PCM)' })).interactive.body, /^Perfect — MPC keeps/);
    assert.equal(
      goalPriorityAckLine(['placement']),
      "Noted — placements first. That genuinely changes what I'd recommend, so thanks for being clear."
    );
    assert.equal(goalPriorityAckLine(['ai_future_tech']), "Good instinct — that's where the sharpest students are heading right now.");
  });

  test('B2 non-core acknowledgements use locked copy', () => {
    assert.equal(branchAckLine('cse_ai'), "Solid — and it's the most flexible base you can pick right now.");
    assert.equal(branchAckLine('design'), 'Good — design plus tech is a genuinely strong combination right now.');
    assert.equal(branchAckLine('data_analytics'), 'Good pick — that sits right next to AI.');
  });

  test('B3 starts with the promised framing line and preserves independent skip behavior', () => {
    const neither = handleB3Entry(ctx(null));
    assert.match(neither.interactive.body, new RegExp(`^${B3_FRAMING_LINE}`));
    assert.equal(handleB3Entry(ctx(null, { budgetBand: '2_5l' })).contextPatch.stage, 'b3_awaiting_location');
    assert.equal(handleB3Entry(ctx(null, { cityPref: 'Hyderabad' })).contextPatch.stage, 'b3_awaiting_budget');
  });

  test('B3 budget uncertainty stores unknown and continues instead of forcing a default', () => {
    const result = handleB3Reply(ctx('b3_awaiting_budget'), 'depends, not sure yet');
    assert.equal(result.contextPatch.profile.budgetBand, 'unknown');
    assert.equal(result.contextPatch.stage, 'b3_awaiting_location');
  });

  test('B3 near-home asks for city only when state is unavailable', () => {
    const askCity = handleB3Reply(ctx('b3_awaiting_location', { budgetBand: 'under_2l' }), 'Near home');
    assert.equal(askCity.contextPatch.stage, 'b3_awaiting_city');
    assert.equal(askCity.replyText, 'Which city are you in?');

    const knownState = handleB3Reply(
      ctx('b3_awaiting_location', { budgetBand: 'under_2l', state: 'Telangana' }),
      'Near home'
    );
    assert.equal(knownState.contextPatch.stage, 'b5_awaiting_entry');
  });

  test('B5 emits exactly five colleges with locked framing and buttons', () => {
    const result = handleB5Entry(
      ctx('b5_awaiting_entry', {
        goalPriority: ['placement'],
        branchInterest: 'cse_ai',
        budgetBand: '2_5l',
        cityPref: 'Hyderabad',
      })
    );
    assert.equal(result.contextPatch.profile.shortlist.length, 5);
    assert.match(result.interactive.body, /^Based on everything you shared, here are 5 that fit you/);
    assert.match(result.interactive.body, /These are matched to what you told me — not a generic ranking\.$/);
    assert.deepEqual(result.interactive.buttons.map((button) => button.title), [
      'Compare them',
      'Just the best fit',
      'Change something',
    ]);
  });

  test('B7 decline and post-booking helper modes answer supported topics and fresh booking intent', () => {
    const fees = handleB7Reply(ctx('b7_post_decline'), 'Fees');
    assert.equal(fees.replyText, TOPIC_REPLIES.fees);
    assert.equal(fees.contextPatch.stage, 'b7_post_decline');

    const booking = handleB7Reply(ctx('b7_post_decline'), 'Actually book it');
    assert.equal(booking.contextPatch.stage, 'b7_awaiting_done');
    assert.equal(booking.contextPatch.profile.bookingStatus, 'link_sent');

    const scholarships = handleB7Reply(ctx('b7_post_booking', { bookingStatus: 'done' }), 'Scholarships');
    assert.equal(scholarships.replyText, TOPIC_REPLIES.scholarships);
    assert.equal(scholarships.contextPatch.stage, 'b7_post_booking');
  });
});

describe('Master Flow Stage 4b — non-distress interrupts', () => {
  test('I-1 fires before ordinary B1 logic, saves stage, infers choice, and resumes without reset', async () => {
    const started = await processFlowV2Turn(ctx('b1_awaiting_reply'), "I don't know");
    assert.equal(started.contextPatch.stage, 'interrupt_i1_awaiting_reply');
    assert.equal(started.contextPatch.interruptedStage, 'b1_awaiting_reply');
    assert.deepEqual(started.interactive.sections[0].rows.map((row) => row.title), [
      'Building things',
      'Working with people',
      'Numbers & analysis',
    ]);

    const resumed = await processFlowV2Turn(
      ctx(started.contextPatch.stage, {}, { interruptedStage: started.contextPatch.interruptedStage }),
      'Building things'
    );
    assert.ok(resumed.contextPatch.profile.goalPriority.includes('startup'));
    assert.equal(resumed.contextPatch.stage, 'b2_awaiting_reply');
    assert.notEqual(resumed.contextPatch.stage, 'greeting_awaiting_name');
  });

  test('I-1 resumes the exact B2 lane and infers data/analytics', async () => {
    const started = await processFlowV2Turn(ctx('b2_awaiting_reply'), 'not sure');
    const resumed = await processFlowV2Turn(
      ctx(started.contextPatch.stage, {}, { interruptedStage: started.contextPatch.interruptedStage }),
      'Numbers & analysis'
    );
    assert.equal(resumed.contextPatch.profile.branchInterest, 'data_analytics');
    assert.equal(resumed.contextPatch.stage, 'b3_awaiting_budget');
    assert.equal(resumed.interactive.type, 'button');
  });

  test('I-2 can interrupt any B-spine stage, updates budget, and returns to the saved stage', async () => {
    const started = await processFlowV2Turn(ctx('b5_awaiting_reply'), "we can't afford much");
    assert.equal(started.contextPatch.stage, 'interrupt_i2_awaiting_reply');
    assert.equal(started.contextPatch.interruptedStage, 'b5_awaiting_reply');

    const resumed = await processFlowV2Turn(
      ctx(started.contextPatch.stage, {}, { interruptedStage: started.contextPatch.interruptedStage }),
      'Focus under ₹2L'
    );
    assert.equal(resumed.contextPatch.stage, 'b5_awaiting_reply');
    assert.equal(resumed.contextPatch.profile.budgetBand, 'under_2l');
    assert.equal(resumed.contextPatch.profile.scholarshipFlag, true);
  });

  test('I-9 beginner fear answers inline and remains on the interrupted stage', async () => {
    const result = await processFlowV2Turn(ctx('b3_awaiting_location'), "I've never coded");
    assert.equal(result.contextPatch.stage, 'b3_awaiting_location');
    assert.match(result.replyText, /assume zero coding and teach from scratch with mentors/);
  });

  test('I-10 and Node 0 still outrank non-distress interrupts', async (t) => {
    t.mock.method(handoffService, 'createHandoff', async () => ({ _id: 'stage4b-crisis-ticket' }));
    t.mock.method(WhatsAppAgentHandoff, 'updateOne', async () => ({}));
    const crisis = await processFlowV2Turn(ctx('b1_awaiting_reply'), "I don't know and my life is over");
    assert.equal(crisis.nextState, 'human_handoff');
    const booking = await processFlowV2Turn(ctx('b1_awaiting_reply'), "I don't know, book a session");
    assert.equal(booking.contextPatch.stage, 'node0_awaiting_backfill');
  });

  test('Node E remains Stage 4a-owned and is not intercepted', async () => {
    const result = await processFlowV2Turn(ctx('greeting_awaiting_qualification'), "I don't know");
    assert.equal(result.contextPatch.stage, 'greeting_awaiting_qualification');
    assert.notEqual(result.contextPatch.stage, 'interrupt_i1_awaiting_reply');
  });
});

describe('Master Flow Stage 4b — persona', () => {
  test('runtime identity replies use Rithika and preserve GuideXpert as the brand', async () => {
    const who = await processFlowV2Turn(ctx('b1_awaiting_reply'), 'who are you');
    assert.match(who.interactive.body, /I'm Rithika, GuideXpert's AI counsellor/);
    const testing = await processFlowV2Turn(ctx('b1_awaiting_reply'), 'are you chatgpt');
    assert.match(testing.interactive.body, /I'm Rithika, GuideXpert's counselling bot/);
  });

  test('Flow v2 runtime source has no old Guide persona remnants', () => {
    const root = path.join(__dirname, '..', 'services', 'chatbot', 'flowV2');
    const files = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.name.endsWith('.js')) files.push(fullPath);
      }
    };
    walk(root);
    const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    assert.doesNotMatch(source, /\bI(?:'m| am) Guide\b|\bGuide bot\b|\bGuide's\b/i);
  });
});
