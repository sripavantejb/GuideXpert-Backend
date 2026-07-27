'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleGreetingEntry,
  handleGreetingReply,
  QUALIFICATION_ROWS,
} = require('../services/chatbot/flowV2/nodes/greeting');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');

describe('flowV2 greeting — entry', () => {
  test('sends the correct message + 9-row list, and sets stage correctly', () => {
    const result = handleGreetingEntry({ leadContext: { iit: { fullName: 'Priya Sharma' } } });
    assert.match(result.replyText, /^Hey Priya 👋/);
    assert.match(result.replyText, /First — where are you right now\?/);
    assert.equal(result.interactive.type, 'list');
    assert.equal(result.interactive.sections[0].rows.length, 9);
    assert.deepEqual(result.interactive.sections[0].rows, QUALIFICATION_ROWS);
    assert.equal(result.contextPatch.stage, 'greeting_awaiting_reply');
  });

  test('omits the name gracefully when no leadContext name is available', () => {
    const result = handleGreetingEntry({});
    assert.match(result.replyText, /^Hey there 👋/);
    assert.doesNotMatch(result.replyText, /undefined/);
  });

  test('does not set door/temperature at entry (left at tri-state null default)', () => {
    // Greeting's contextPatch never mentions door/temperature at all —
    // they stay whatever the caller's existing profile already has
    // (typically the emptyFlowV2Profile() null default).
    const result = handleGreetingEntry({});
    assert.equal('door' in (result.contextPatch.profile || {}), false);
    assert.equal('temperature' in (result.contextPatch.profile || {}), false);
  });

  test('is a defensive no-op if called with a stage already set (belt-and-suspenders; real guarantee is at dispatcher level)', () => {
    const result = handleGreetingEntry({ flowV2: { stage: 'greeting_awaiting_reply' } });
    assert.equal(result.replyText, null);
    assert.equal(result.interactive, null);
  });
});

describe('flowV2 greeting — reply (tapped row + free text)', () => {
  test('a tapped list row title extracts qualification correctly', () => {
    const result = handleGreetingReply({ flowV2: { profile: emptyFlowV2Profile() } }, '12th — MPC');
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
    assert.equal(result.contextPatch.stage, 'greeting_captured_pending_b1');
    assert.match(result.replyText, /Got it — Class 12 \(MPC\)\. Thanks!/);
  });

  test('free-typed text extracts qualification correctly via the same path', () => {
    const result = handleGreetingReply({ flowV2: { profile: emptyFlowV2Profile() } }, 'im in 12th mpc');
    assert.equal(result.contextPatch.profile.qualification, 'Class 12 (MPC)');
    assert.equal(result.contextPatch.stage, 'greeting_captured_pending_b1');
  });

  test('tapped rows for Class 10, Dropper / gap year, and Already in college all resolve via the extended extractor', () => {
    const class10 = handleGreetingReply({ flowV2: { profile: emptyFlowV2Profile() } }, 'Class 10');
    assert.equal(class10.contextPatch.profile.qualification, 'Class 10');

    const dropper = handleGreetingReply({ flowV2: { profile: emptyFlowV2Profile() } }, 'Dropper / gap year');
    assert.equal(dropper.contextPatch.profile.qualification, 'Dropper / gap year');

    const college = handleGreetingReply({ flowV2: { profile: emptyFlowV2Profile() } }, 'Already in college');
    assert.equal(college.contextPatch.profile.qualification, 'Already in college');
  });

  test('does not clobber unrelated existing profile fields on a successful capture', () => {
    const existing = { ...emptyFlowV2Profile(), branchInterest: 'ECE' };
    const result = handleGreetingReply({ flowV2: { profile: existing } }, '12th mpc');
    assert.equal(result.contextPatch.profile.branchInterest, 'ECE');
  });

  test('unrecognized text triggers the short re-ask, not a repeated full greeting or a throw', () => {
    const result = handleGreetingReply({ flowV2: { profile: emptyFlowV2Profile() } }, "I don't really know");
    assert.equal(result.contextPatch.stage, 'greeting_awaiting_reply');
    assert.equal(result.interactive.type, 'list');
    assert.doesNotMatch(result.interactive.body, /I'm Guide, from GuideXpert/);
    assert.match(result.interactive.body, /didn't quite catch that/i);
  });

  test('"Something else" is treated as unresolved (no guess), triggering the short re-ask', () => {
    const result = handleGreetingReply({ flowV2: { profile: emptyFlowV2Profile() } }, 'Something else');
    assert.equal(result.contextPatch.stage, 'greeting_awaiting_reply');
    assert.equal(result.interactive.type, 'list');
  });

  test('a near-miss free-typed reply offers a one-tap guess confirm, and "yes" accepts it', () => {
    const guessResult = handleGreetingReply(
      { flowV2: { profile: emptyFlowV2Profile() } },
      'just finished 10, no exams yet'
    );
    assert.equal(guessResult.interactive.type, 'button');
    assert.equal(guessResult.contextPatch.pendingQualificationGuess, 'Class 10');
    assert.equal(guessResult.contextPatch.stage, 'greeting_awaiting_reply');

    const confirmCtx = {
      flowV2: { profile: emptyFlowV2Profile(), pendingQualificationGuess: 'Class 10' },
    };
    const acceptResult = handleGreetingReply(confirmCtx, "Yes, that's right");
    assert.equal(acceptResult.contextPatch.profile.qualification, 'Class 10');
    assert.equal(acceptResult.contextPatch.stage, 'greeting_captured_pending_b1');
    assert.equal(acceptResult.contextPatch.pendingQualificationGuess, null);
  });

  test('declining a guess confirm ("no") clears the pending guess and re-asks shortened', () => {
    const confirmCtx = {
      flowV2: { profile: emptyFlowV2Profile(), pendingQualificationGuess: 'Class 10' },
    };
    const result = handleGreetingReply(confirmCtx, 'No, let me pick');
    assert.equal(result.contextPatch.pendingQualificationGuess, null);
    assert.equal(result.contextPatch.stage, 'greeting_awaiting_reply');
    assert.equal(result.interactive.type, 'list');
  });
});
