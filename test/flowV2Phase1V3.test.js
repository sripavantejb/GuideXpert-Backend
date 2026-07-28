'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');
const { extractFlowV2Slots } = require('../services/chatbot/flowV2/flowV2SlotExtractor');
const { handleB5ChecklistEntry, buildChecklistBody } = require('../services/chatbot/flowV2/nodes/b5Checklist');
const { handleB2GoalEntry, handleB2GoalReply } = require('../services/chatbot/flowV2/nodes/b2Goal');
const {
  handleB6PermissionEntry,
  handleB6PermissionReply,
  PERMISSION_BODY,
} = require('../services/chatbot/flowV2/nodes/b6Permission');

describe('Flow V3 Phase 1 — B2 GOAL', () => {
  test('entry asks three goal buttons when goal empty', () => {
    const result = handleB2GoalEntry({ flowV2: { profile: emptyFlowV2Profile() } });
    assert.equal(result.contextPatch.stage, 'b2_goal_awaiting_reply');
    assert.equal(result.interactive?.type, 'button');
    assert.equal(result.interactive.buttons.length, 3);
  });

  test('reply stores goal and advances toward interest (b2_awaiting_reply or further)', () => {
    const result = handleB2GoalReply(
      { flowV2: { profile: emptyFlowV2Profile() } },
      'flowv2_b2_goal_branch'
    );
    assert.equal(result.contextPatch.profile.goal, 'branch_fit');
    assert.ok(
      result.contextPatch.stage === 'b2_awaiting_reply' ||
        result.contextPatch.stage === 'b4_awaiting_entry' ||
        result.contextPatch.stage === 'b4_awaiting_reply' ||
        result.interactive
    );
  });
});

describe('Flow V3 Phase 1 — B5 CHECKLIST', () => {
  test('sends one checklist bubble with no college names and sets checklistSent', () => {
    const profile = {
      ...emptyFlowV2Profile(),
      interestCluster: 'software',
      goalPriority: ['placements'],
      branchInterest: 'cse_ai',
    };
    const result = handleB5ChecklistEntry({ flowV2: { profile } });
    assert.equal(result.contextPatch.profile.checklistSent, true);
    const parts = [...(result.replyParts || []), result.replyText].filter(Boolean).join('\n');
    assert.match(parts, /Got it|curriculum updated|alumni network/i);
    assert.doesNotMatch(parts, /\bNIAT\b|\bNewton\b|\bScaler\b/i);
    assert.equal(result.interactive?.type, 'button');
    assert.match(result.interactive.body || PERMISSION_BODY, /suggest colleges that match/i);
  });

  test('checklistSent=true skips re-send and goes to permission', () => {
    const profile = { ...emptyFlowV2Profile(), checklistSent: true };
    const result = handleB5ChecklistEntry({ flowV2: { profile } });
    const parts = [...(result.replyParts || []), result.replyText].filter(Boolean).join('\n');
    assert.doesNotMatch(parts, /Is the curriculum updated/);
    assert.ok(
      result.contextPatch.stage === 'b6_permission_awaiting_reply' ||
        result.contextPatch.stage === 'b7_two_models_awaiting_entry' ||
        result.contextPatch.stage === 'b8_awaiting_entry' ||
        result.contextPatch.stage === 'b8_shortlist_ask_awaiting_entry' ||
        result.contextPatch.stage === 'b8_shortlist_ask_awaiting_reply'
    );
  });

  test('buildChecklistBody never names partner colleges', () => {
    const body = buildChecklistBody({
      ...emptyFlowV2Profile(),
      interestCluster: 'data_ai',
      goalPriority: ['fees'],
    });
    assert.doesNotMatch(body, /\bNIAT\b|\bNewton\b|\bScaler\b|\bPlaksha\b/i);
  });
});

describe('Flow V3 Phase 1 — B6 PERMISSION', () => {
  test('yes advances to B7 two models (skips B6.5)', () => {
    const result = handleB6PermissionReply(
      { flowV2: { profile: emptyFlowV2Profile() } },
      'flowv2_b6_yes'
    );
    assert.equal(result.contextPatch.profile.permissionRecommend, true);
    assert.equal(result.contextPatch.stage, 'b7_two_models_awaiting_entry');
  });

  test('not right now soft-closes without looping', () => {
    const result = handleB6PermissionReply(
      { flowV2: { profile: emptyFlowV2Profile() } },
      'flowv2_b6_not_now'
    );
    assert.equal(result.contextPatch.profile.permissionRecommend, false);
    assert.equal(result.contextPatch.stage, 'b6_permission_declined');
    assert.match(result.replyText, /No problem/i);
  });

  test('entry shows permission buttons', () => {
    const result = handleB6PermissionEntry({ flowV2: { profile: emptyFlowV2Profile() } });
    assert.equal(result.interactive?.type, 'button');
    assert.equal(result.contextPatch.stage, 'b6_permission_awaiting_reply');
    assert.deepEqual(
      result.interactive.buttons.map((b) => b.title),
      ['Yes 👍', 'Maybe Later']
    );
  });
});

describe('Flow V3 Phase 1 — data layer paste skip + checklist once via dispatcher', () => {
  test('paste extracts qualification, branch, budget, city without blanks', () => {
    const patch = extractFlowV2Slots(
      'im in 12th mpc, want cse, budget around 3 lakhs, hyderabad only'
    );
    assert.ok(patch.qualification);
    assert.ok(patch.branchInterest);
    assert.ok(patch.budgetBand);
    assert.ok(patch.cityPref);
  });

  test('returning with checklistSent does not re-send checklist body', async () => {
    const ctx = {
      flowV2: {
        stage: 'b5_checklist_awaiting_entry',
        profile: {
          ...emptyFlowV2Profile(),
          checklistSent: true,
          permissionRecommend: null,
        },
      },
    };
    const result = await processFlowV2Turn(ctx, 'hi again');
    const text = [...(result.replyParts || []), result.replyText].filter(Boolean).join('\n');
    assert.doesNotMatch(text, /When was the curriculum last updated/);
  });
});
