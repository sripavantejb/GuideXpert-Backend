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
    assert.match(handleB1Entry(ctx(null, { qualification: '12th Completed (PCM)' })).interactive.body, /What matters to you the most/i);
    assert.equal(
      goalPriorityAckLine(['placement']),
      'Noted — placements first.'
    );
    assert.equal(goalPriorityAckLine(['ai_future_tech']), 'Noted — AI & future tech first.');
  });

  test('B2 non-core acknowledgements use locked copy', () => {
    assert.equal(branchAckLine('cse_ai'), 'Solid — Now you can pick..');
    assert.equal(branchAckLine('design'), 'Solid — Now you can pick..');
    assert.equal(branchAckLine('data_analytics'), 'Solid — Now you can pick..');
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
    assert.equal(knownState.contextPatch.stage, 'b8_shortlist_ask_awaiting_reply');
  });

  test('B8 emits top 5 colleges with FIT ask', () => {
    const { handleB8Entry } = require('../services/chatbot/flowV2/nodes/b8FlatShortlist');
    const result = handleB8Entry(
      ctx('b8_awaiting_entry', {
        goalPriority: ['placement'],
        branchInterest: 'cse_ai',
        budgetBand: '2_5l',
        cityPref: 'Hyderabad',
      })
    );
    assert.equal(result.contextPatch.profile.shortlist.length, 5);
    const visible = [...(result.replyParts || []), result.replyText, result.interactive?.body]
      .filter(Boolean)
      .join('\n');
    assert.match(visible, /Newton School|🥇|top 5 colleges/i);
    assert.match(visible, /Polar School of Technology/i);
    assert.match(visible, /best fit/i);
    assert.doesNotMatch(visible, /\*Best Match\*/i);
    assert.equal(result.contextPatch.stage, 'b9_awaiting_reply');
    assert.ok(result.interactive.buttons.some((b) => /help me|explore/i.test(b.title)));
  });

  test('B7 decline and post-booking helper modes answer supported topics and fresh booking intent', async (t) => {
    t.mock.method(
      require('../services/guidanceBookingService'),
      'getAvailableActiveSlots',
      async () => []
    );
    const fees = await handleB7Reply(ctx('b7_post_decline'), 'Fees');
    assert.equal(fees.replyText, TOPIC_REPLIES.fees);
    assert.equal(fees.contextPatch.stage, 'b7_post_decline');

    const booking = await handleB7Reply(ctx('b7_post_decline'), 'Actually book it');
    assert.equal(booking.contextPatch.stage, 'b7_awaiting_slot');
    assert.equal(booking.contextPatch.profile.bookingStatus, 'booking_started');

    const scholarships = await handleB7Reply(ctx('b7_post_booking', { bookingStatus: 'done' }), 'Scholarships');
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
    // V3: priority filled → checklist/permission (or interest if still pending).
    assert.ok(
      resumed.contextPatch.stage === 'b6_permission_awaiting_reply' ||
        resumed.contextPatch.stage === 'b5_awaiting_reply' ||
        resumed.contextPatch.stage === 'b5_checklist_awaiting_entry' ||
        resumed.contextPatch.stage === 'b2_awaiting_reply' ||
        resumed.contextPatch.stage === 'b4_awaiting_reply',
      `expected permission/checklist/interest/priority stage, got ${resumed.contextPatch.stage}`
    );
    assert.notEqual(resumed.contextPatch.stage, 'greeting_awaiting_name');
  });

  test('I-1 resumes the exact B2 lane and infers data/analytics', async () => {
    const started = await processFlowV2Turn(ctx('b2_awaiting_reply'), 'not sure');
    const resumed = await processFlowV2Turn(
      ctx(started.contextPatch.stage, {}, { interruptedStage: started.contextPatch.interruptedStage }),
      'Numbers & analysis'
    );
    assert.equal(resumed.contextPatch.profile.branchInterest, 'data_analytics');
    // V3: after interest resolve, advance to B4 priority (or stay collecting only if unresolved).
    assert.ok(
      resumed.contextPatch.stage === 'b4_awaiting_reply' ||
        resumed.contextPatch.stage === 'b4_awaiting_entry' ||
        resumed.contextPatch.stage === 'b6_permission_awaiting_reply' ||
        resumed.contextPatch.stage === 'b5_checklist_awaiting_entry' ||
        resumed.contextPatch.stage === 'b2_awaiting_reply',
      `expected B4 priority (or drained checklist/permission), got ${resumed.contextPatch.stage}`
    );
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
    t.mock.method(
      require('../services/guidanceBookingService'),
      'getAvailableActiveSlots',
      async () => []
    );
    const crisis = await processFlowV2Turn(ctx('b1_awaiting_reply'), "I don't know and my life is over");
    assert.equal(crisis.nextState, 'human_handoff');
    const booking = await processFlowV2Turn(ctx('b1_awaiting_reply'), "I don't know, book a session");
    assert.equal(booking.contextPatch.stage, 'node0_awaiting_slot');
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
