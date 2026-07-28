'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');

function qualificationCtx(patch = {}) {
  return {
    flowV2: {
      stage: 'greeting_awaiting_qualification',
      profile: { ...emptyFlowV2Profile(), name: 'Rahul', ...patch },
    },
  };
}

function continueCtx(result) {
  return {
    flowV2: {
      stage: result.contextPatch.stage,
      profile: result.contextPatch.profile,
      pendingQualificationGuess: result.contextPatch.pendingQualificationGuess,
      pendingAmbiguousResolution: result.contextPatch.pendingAmbiguousResolution,
      r3OverAnswerPending: result.contextPatch.r3OverAnswerPending,
    },
  };
}

function visibleText(result) {
  return [result.replyText, ...(result.replyParts || []), result.interactive?.body]
    .filter(Boolean)
    .join('\n');
}

describe('Master Flow Stage 5 — R2 typed qualification', () => {
  test('typed qualification behaves like the exact tapped row', async () => {
    const typed = await processFlowV2Turn(qualificationCtx(), '12th Completed (PCM)', {
      messageType: 'text',
    });
    const tapped = await processFlowV2Turn(qualificationCtx(), '12th Completed (PCM)', {
      messageType: 'list_reply',
    });

    assert.equal(typed.contextPatch.stage, tapped.contextPatch.stage);
    assert.equal(typed.contextPatch.profile.qualification, tapped.contextPatch.profile.qualification);
    assert.equal(typed.contextPatch.profile.stream, tapped.contextPatch.profile.stream);
    assert.equal(typed.contextPatch.profile.temperature, 'warm');
    assert.equal(tapped.contextPatch.profile.temperature, 'warm');
  });
});

describe('Master Flow Stage 5 — R3 over-answer', () => {
  test('exact paste reflects once, then B2 goal; interest skips when branch filled; priority then checklist', async () => {
    const captured = await processFlowV2Turn(
      qualificationCtx(),
      'im in 12th mpc, want cse, budget around 3 lakhs, hyderabad only'
    );

    assert.equal(captured.contextPatch.profile.temperature, 'hot');
    assert.equal(captured.contextPatch.stage, 'b2_goal_awaiting_reply');
    assert.equal(captured.interactive.type, 'button');
    assert.equal(captured.interactive.buttons.length, 3);
    assert.equal(
      (captured.replyParts || []).filter((part) =>
        /12th MPC, CSE, around ₹3L, Hyderabad/.test(part)
      ).length,
      1
    );

    const afterGoal = await processFlowV2Turn(continueCtx(captured), 'Which branch suits me');
    assert.equal(afterGoal.contextPatch.stage, 'b4_awaiting_reply');
    assert.equal(afterGoal.interactive.sections[0].rows.length, 7);
    assert.doesNotMatch(visibleText(afterGoal), /which field|comfortable for your family|near home|open to moving/i);
    assert.equal(afterGoal.contextPatch.profile.branchInterest, 'CSE');

    const afterPriority = await processFlowV2Turn(continueCtx(afterGoal), 'Placements');
    assert.ok(
      afterPriority.contextPatch.stage === 'b6_permission_awaiting_reply' ||
        afterPriority.contextPatch.stage === 'b5_awaiting_reply' ||
        afterPriority.contextPatch.stage === 'b5_checklist_awaiting_entry',
      `expected checklist/permission, got ${afterPriority.contextPatch.stage}`
    );
    assert.doesNotMatch(
      visibleText(afterPriority),
      /which field|comfortable for your family|near home|open to moving|12th MPC, CSE/i
    );
    assert.equal(afterPriority.contextPatch.profile.branchInterest, 'CSE');
    assert.equal(afterPriority.contextPatch.profile.budgetBand, '2_4l');
    assert.equal(afterPriority.contextPatch.profile.cityPref, 'Hyderabad');
    assert.ok(afterPriority.interactive);
  });
});

describe('Master Flow Stage 5 — R10 deterministic ambiguity', () => {
  test('guess Yes commits the canonical qualification and routes its side track', async () => {
    const guessed = await processFlowV2Turn(qualificationCtx(), 'diplma');
    assert.match(guessed.interactive.body, /Diploma, right\?/);
    assert.equal(guessed.contextPatch.pendingQualificationGuess, 'Diploma');

    const confirmed = await processFlowV2Turn(continueCtx(guessed), "Yes, that's right");
    assert.equal(confirmed.contextPatch.profile.qualification, 'Diploma');
    assert.equal(confirmed.contextPatch.stage, 'entry_diploma_awaiting_reply');
    assert.equal(confirmed.contextPatch.pendingQualificationGuess, null);
  });

  test('guess No shows the canonical list, and a second ambiguous response cannot re-open the guess loop', async () => {
    const guessed = await processFlowV2Turn(qualificationCtx(), 'diplma');
    const rejected = await processFlowV2Turn(continueCtx(guessed), 'No, let me pick');
    assert.equal(rejected.interactive.type, 'list');
    assert.equal(rejected.contextPatch.pendingQualificationGuess, null);
    assert.doesNotMatch(visibleText(rejected), /please select from the options/i);

    const guessedAgain = await processFlowV2Turn(qualificationCtx(), 'diplma');
    const secondAmbiguous = await processFlowV2Turn(continueCtx(guessedAgain), 'diplma');
    assert.equal(secondAmbiguous.interactive.type, 'list');
    assert.equal(secondAmbiguous.contextPatch.pendingQualificationGuess, null);
    assert.doesNotMatch(visibleText(secondAmbiguous), /right\?|please select from the options/i);
  });

  test('regional Inter ambiguity resolves deterministically without a rejection phrase', async () => {
    const inter = await processFlowV2Turn(qualificationCtx(), 'inter');
    const year = await processFlowV2Turn(continueCtx(inter), '2nd year');
    assert.match(year.interactive.body, /which stream/i);
    const stream = await processFlowV2Turn(continueCtx(year), 'MPC / PCM');
    assert.equal(stream.contextPatch.profile.qualification, '12th Completed (PCM)');
    assert.doesNotMatch(visibleText(stream), /please select from the options/i);
  });

  test('Inter first year resolves to 11th rather than incorrectly asking for a 12th stream', async () => {
    const inter = await processFlowV2Turn(qualificationCtx(), 'inter');
    const firstYear = await processFlowV2Turn(continueCtx(inter), '1st year');
    assert.equal(firstYear.contextPatch.profile.qualification, '11th Studying');
    assert.equal(firstYear.contextPatch.stage, 'entry_class11_awaiting_reply');
  });

  test('passed out and 12th pass cover the remaining documented ambiguity paths', async () => {
    const passedOut = await processFlowV2Turn(qualificationCtx(), 'I passed out');
    assert.equal(passedOut.interactive.body, 'Passed out of 12th, or of a diploma?');
    const diploma = await processFlowV2Turn(continueCtx(passedOut), 'Diploma');
    assert.equal(diploma.contextPatch.profile.qualification, 'Diploma');
    assert.equal(diploma.contextPatch.stage, 'entry_diploma_awaiting_reply');

    const twelfth = await processFlowV2Turn(qualificationCtx(), '12th pass');
    assert.match(twelfth.interactive.body, /which stream/i);
    const pcb = await processFlowV2Turn(continueCtx(twelfth), 'BiPC / PCB');
    assert.equal(pcb.contextPatch.profile.qualification, '12th Completed (PCB)');
    assert.equal(pcb.contextPatch.stage, 'entry_pcb_awaiting_reply');
  });
});
