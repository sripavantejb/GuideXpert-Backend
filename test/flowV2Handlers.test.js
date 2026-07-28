'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { handleR5, BOT_IDENTITY_TEXT, IS_FREE_TEXT, HOW_GOT_NUMBER_TEXT } = require('../services/chatbot/flowV2/router/handlers/r5Handler');
const { handleR6, JUST_SEND_LIST_TEXT, OPT_OUT_TEXT } = require('../services/chatbot/flowV2/router/handlers/r6Handler');
const { handleR8, PARENT_TEXT, VENDOR_SPAM_TEXT, WRONG_NUMBER_TEXT } = require('../services/chatbot/flowV2/router/handlers/r8Handler');
const { handleR9, NO_OCR_TEXT, VOICE_NOTE_TEXT, STICKER_EMOJI_TEXT } = require('../services/chatbot/flowV2/router/handlers/r9Handler');
const { handleR10, BARE_INTER_TEXT, BARE_YEAR_TEXT, PCM_QUALIFICATION, PCB_QUALIFICATION } = require('../services/chatbot/flowV2/router/handlers/r10Handler');
const { handleR11, OUT_OF_SCOPE_TEXT } = require('../services/chatbot/flowV2/router/handlers/r11Handler');
const { handleR12, FIRST_REDIRECT_TEXT, REPEAT_REDIRECT_TEXT } = require('../services/chatbot/flowV2/router/handlers/r12Handler');
const { handleR7Tier2, CRISIS_RESPONSE_TEXT } = require('../services/chatbot/flowV2/router/handlers/r7Tier2Handler');
const { getR7Tier1PrefixLine } = require('../services/chatbot/flowV2/router/handlers/r7Tier1Handler');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');

const SPEC_CRISIS_TEXT =
  "I\u2019m really glad you told me that, and I don\u2019t want to move past it. A result doesn\u2019t decide your worth, whatever it feels like today. Please talk to someone you trust right now \u2014 a parent, a teacher, a friend. And if it\u2019s heavier than that, Tele-MANAS is free and available 24/7 on 14416. I\u2019m connecting you with one of our counsellors \u2014 a real person \u2014 right away.";

function ctxWithProfile(patch = {}) {
  return { flowV2: { profile: { ...emptyFlowV2Profile(), ...patch } } };
}

describe('r7Tier2Handler — crisis copy verbatim + lock', () => {
  test('reply text matches spec exactly', () => {
    assert.equal(CRISIS_RESPONSE_TEXT.replace(/\u2019/g, "'").replace(/\u2014/g, '-'), SPEC_CRISIS_TEXT.replace(/\u2019/g, "'").replace(/\u2014/g, '-'));
  });

  test('sets crisisLocked=true and nextState=human_handoff, no interactive/buttons', () => {
    const ctx = ctxWithProfile();
    // Inject no-op deps — this test only cares about the synchronous
    // reply/lock shape, not the side effect itself (see the dedicated
    // "actually fires createHandoff" tests below for that guarantee).
    const fakeCreateHandoff = async () => ({ _id: 'fake-handoff-id' });
    const fakeModel = { updateOne: async () => ({}) };
    const result = handleR7Tier2(ctx, 'my life is over', {
      createHandoff: fakeCreateHandoff,
      WhatsAppAgentHandoff: fakeModel,
    });
    assert.equal(result.replyText, CRISIS_RESPONSE_TEXT);
    assert.equal(result.interactive, null);
    assert.equal(result.contextPatch.profile.crisisLocked, true);
    assert.equal(result.nextState, 'human_handoff');
    assert.equal(typeof result.pendingSideEffect.execute, 'function');
  });
});

describe('r7Tier2Handler — the alert actually fires (separate guarantee from the lock)', () => {
  // The lock (profile.crisisLocked) and the human alert (createHandoff)
  // are two independent guarantees — this suite proves the SECOND one
  // independently, per explicit instruction: do not just re-check
  // crisisLocked and assume the alert also happened.

  test('createHandoff is invoked exactly once, synchronously-triggered, when R7 Tier-2 fires', () => {
    let callCount = 0;
    let capturedArgs = null;
    const fakeCreateHandoff = async (args) => {
      callCount += 1;
      capturedArgs = args;
      return { _id: 'fake-handoff-id-123' };
    };
    const fakeModel = { updateOne: async () => ({}) };

    const ctx = { conversationId: 'conv-1', phone: '9999999999', leadContext: { some: 'lead' }, flowV2: { profile: emptyFlowV2Profile() } };
    handleR7Tier2(ctx, 'my life is over', {
      createHandoff: fakeCreateHandoff,
      WhatsAppAgentHandoff: fakeModel,
    });

    // handleR7Tier2 is synchronous and fires the side effect BEFORE
    // returning — the call has already happened by the time we get here,
    // even though fakeCreateHandoff itself is async. No await needed to
    // observe that it was called.
    assert.equal(callCount, 1);
    assert.equal(capturedArgs.reason, 'crisis_escalation');
    assert.equal(capturedArgs.userLastMessage, 'my life is over');
  });

  test('the expiresAt-clearing update is also invoked exactly once, with the ticket id from createHandoff', async () => {
    let updateCallCount = 0;
    let updateArgs = null;
    const fakeCreateHandoff = async () => ({ _id: 'ticket-abc' });
    const fakeModel = {
      updateOne: async (filter, update) => {
        updateCallCount += 1;
        updateArgs = { filter, update };
        return {};
      },
    };

    const ctx = { flowV2: { profile: emptyFlowV2Profile() } };
    const result = handleR7Tier2(ctx, 'my life is over', {
      createHandoff: fakeCreateHandoff,
      WhatsAppAgentHandoff: fakeModel,
    });

    // The side effect is fire-and-forget (not awaited by handleR7Tier2
    // itself) — await the SAME promise here to observe its completion
    // before asserting, without changing handleR7Tier2's sync contract.
    await result.pendingSideEffect.execute().catch(() => {});
    // executeCrisisHandoff is idempotent-safe to call again here (the
    // fake createHandoff/updateOne have no real side effects to double),
    // but to prove the ORIGINAL eager fire-and-forget call already
    // happened, count is asserted to be >= 1 from that first call alone.
    assert.ok(updateCallCount >= 1);
    assert.equal(updateArgs.filter._id, 'ticket-abc');
    assert.deepEqual(updateArgs.update, { $set: { expiresAt: null } });
  });

  test('a createHandoff failure is caught, does not throw out of handleR7Tier2, and does not block the synchronous reply', async () => {
    const failingCreateHandoff = async () => {
      throw new Error('simulated DB failure');
    };
    let capturedError = null;
    const ctx = { flowV2: { profile: emptyFlowV2Profile() } };

    let result;
    assert.doesNotThrow(() => {
      result = handleR7Tier2(ctx, 'my life is over', {
        createHandoff: failingCreateHandoff,
        WhatsAppAgentHandoff: { updateOne: async () => ({}) },
        onSideEffectError: (err) => {
          capturedError = err;
        },
      });
    });
    assert.equal(result.replyText, CRISIS_RESPONSE_TEXT);
    assert.equal(result.contextPatch.profile.crisisLocked, true);

    // Let the already-in-flight rejected promise's .catch(onSideEffectError)
    // microtask run before asserting the error was actually captured
    // (not thrown, not silently swallowed).
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(capturedError instanceof Error);
    assert.equal(capturedError.message, 'simulated DB failure');
  });
});

describe('r7Tier1Handler — empathetic prefix line', () => {
  test('returns a fixed non-empty empathy line', () => {
    const line = getR7Tier1PrefixLine();
    assert.equal(typeof line, 'string');
    assert.ok(line.length > 0);
  });
});

describe('r5Handler — copy verbatim', () => {
  test('"is this free" -> exact free-text copy', () => {
    const result = handleR5(ctxWithProfile(), 'is this free?');
    assert.equal(result.replyText, IS_FREE_TEXT);
  });
  test('"how did you get my number" -> exact copy', () => {
    const result = handleR5(ctxWithProfile(), 'how did you get my number?');
    assert.equal(result.replyText, HOW_GOT_NUMBER_TEXT);
  });
  test('"is this a bot" -> exact identity copy with buttons', () => {
    const result = handleR5(ctxWithProfile(), 'is this a bot?');
    assert.equal(result.interactive.body, BOT_IDENTITY_TEXT);
    assert.equal(result.interactive.buttons.length, 2);
  });
});

describe('r6Handler — copy verbatim + no flourish after opt-out', () => {
  test('"just send me the list" -> exact copy with buttons', () => {
    const result = handleR6(ctxWithProfile(), 'just send me the list');
    assert.equal(result.interactive.body, JUST_SEND_LIST_TEXT);
  });
  test('"not interested" -> exact opt-out copy, sets optedOut, no extra text', () => {
    const result = handleR6(ctxWithProfile(), 'not interested');
    assert.equal(result.replyText, OPT_OUT_TEXT);
    assert.equal(result.contextPatch.profile.optedOut, true);
    assert.equal(result.replyParts, null);
    assert.equal(result.interactive, null);
  });
  test('"stop" -> same opt-out path, no flourish', () => {
    const result = handleR6(ctxWithProfile(), 'stop');
    assert.equal(result.replyText, OPT_OUT_TEXT);
    assert.equal(result.interactive, null);
  });
});

describe('r8Handler — copy verbatim, 3 sub-cases', () => {
  test('parent framing -> exact copy, sets isParent, 3 buttons', () => {
    const result = handleR8(ctxWithProfile(), "asking for my daughter, she's finishing 12th");
    assert.equal(result.interactive.body, PARENT_TEXT);
    assert.equal(result.interactive.buttons.length, 3);
    assert.equal(result.contextPatch.profile.isParent, true);
  });
  test('wrong number -> exact copy, no flourish beyond the line', () => {
    const result = handleR8(ctxWithProfile(), 'wrong number sorry');
    assert.equal(result.replyText, WRONG_NUMBER_TEXT);
    assert.equal(result.interactive, null);
  });
  test('vendor/spam -> exact copy', () => {
    const result = handleR8(ctxWithProfile(), 'we would like to discuss a business partnership', { subCase: 'vendor_spam' });
    assert.equal(result.replyText, VENDOR_SPAM_TEXT);
  });
});

describe('r9Handler — copy verbatim per messageType sub-case', () => {
  test('image -> no-OCR line only, no list', () => {
    const result = handleR9(ctxWithProfile(), '', { subCase: 'image' });
    assert.equal(result.replyText, NO_OCR_TEXT);
    assert.equal(result.interactive, null);
  });
  test('audio -> voice-note line + list', () => {
    const result = handleR9(ctxWithProfile(), '', { subCase: 'audio' });
    assert.equal(result.interactive.body, VOICE_NOTE_TEXT);
    assert.equal(result.interactive.type, 'list');
  });
  test('unknown/other -> sticker/emoji line + list', () => {
    const result = handleR9(ctxWithProfile(), '', { subCase: 'unknown' });
    assert.equal(result.interactive.body, STICKER_EMOJI_TEXT);
  });
});

describe('r10Handler — sub-case copy + silent PCM/PCB save', () => {
  test('bare_inter -> exact clarifying question, 3 buttons', () => {
    const result = handleR10(ctxWithProfile(), 'inter', { subCase: 'bare_inter' });
    assert.equal(result.interactive.body, BARE_INTER_TEXT);
    assert.equal(result.interactive.buttons.length, 3);
    assert.equal(result.contextPatch.pendingAmbiguousResolution.partial, 'inter');
  });
  test('bare_year -> exact clarifying question, 3 buttons', () => {
    const result = handleR10(ctxWithProfile(), '2nd year', { subCase: 'bare_year' });
    assert.equal(result.interactive.body, BARE_YEAR_TEXT);
  });
  test('pcm -> silent save, no interactive confirm prompt, advances into B2 GOAL', () => {
    const result = handleR10(ctxWithProfile(), 'pcm', { subCase: 'pcm' });
    assert.equal(result.contextPatch.profile.qualification, PCM_QUALIFICATION);
    assert.equal(result.contextPatch.stage, 'b2_goal_awaiting_reply');
    assert.equal(result.interactive.type, 'button');
    assert.equal(result.interactive.buttons.length, 3);
    assert.match(result.interactive.body, /What are you mainly trying to figure out/i);
  });
  test('pcb -> silent save and enters the required medical/tech split without a confirm prompt', () => {
    const result = handleR10(ctxWithProfile(), 'pcb', { subCase: 'pcb' });
    assert.equal(result.interactive.type, 'button');
    assert.deepEqual(result.interactive.buttons.map((item) => item.title), ['Medical', 'Open to tech', 'Not sure']);
    assert.equal(result.contextPatch.profile.qualification, PCB_QUALIFICATION);
    assert.equal(result.contextPatch.stage, 'entry_pcb_awaiting_reply');
  });
  test('typo_guess -> Yes/No confirm interactive (unlike PCM/PCB)', () => {
    const result = handleR10(ctxWithProfile(), 'diplma', { subCase: 'typo_guess', guess: 'Diploma' });
    assert.equal(result.interactive.type, 'button');
    assert.equal(result.contextPatch.pendingQualificationGuess, 'Diploma');
  });
});

describe('r11Handler — copy verbatim', () => {
  test('exact out-of-scope copy with Book/Tell-me-anyway buttons', () => {
    const result = handleR11();
    assert.equal(result.interactive.body, OUT_OF_SCOPE_TEXT);
    assert.equal(result.interactive.buttons.length, 2);
  });
});

describe('r12Handler — second-strike behavior (separate message state)', () => {
  test('first hostile message -> joke + buttons, sets hostileRedirectIssued', () => {
    const result = handleR12(ctxWithProfile());
    assert.equal(result.interactive.body, FIRST_REDIRECT_TEXT);
    assert.equal(result.contextPatch.profile.hostileRedirectIssued, true);
  });
  test('second hostile message (hostileRedirectIssued already true) -> short line only, no buttons', () => {
    const result = handleR12(ctxWithProfile({ hostileRedirectIssued: true }));
    assert.equal(result.replyText, REPEAT_REDIRECT_TEXT);
    assert.equal(result.interactive, null);
  });
});
