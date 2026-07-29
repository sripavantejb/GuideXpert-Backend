'use strict';

/**
 * Flow V3 — B2 · GOAL (new beat; no v2 equivalent).
 *
 * Three buttons: branch_fit | career_scope | college_fit.
 * Skip silently if profile.goal already set. Advances to B3 INTEREST
 * (legacy module b2Branch.js — still named handleB2Entry).
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { withMergedProfile } = require('../flowV2NodeUtils');
const { handleB2Entry } = require('./b2Branch');

// WhatsApp reply-button titles hard-cap at 20 characters — company labels
// clipped; full intent lives in B2_BODY / GOAL_BY_TEXT parsers.
const GOAL_BUTTONS = Object.freeze([
  // Company: "Which engineering branch suits me" (34) → clip
  Object.freeze({ id: 'flowv2_b2_goal_branch', title: 'Which branch for me' }), // 19
  // Company: "Careers with good future scope" (30) → clip
  Object.freeze({ id: 'flowv2_b2_goal_career', title: 'Careers with scope' }), // 18
  // Company: "Best colleges for my profile" (28) → clip
  Object.freeze({ id: 'flowv2_b2_goal_college', title: 'Best colleges for me' }), // 20
]);

const GOAL_BY_ID = Object.freeze({
  flowv2_b2_goal_branch: 'branch_fit',
  flowv2_b2_goal_career: 'career_scope',
  flowv2_b2_goal_college: 'college_fit',
});

const GOAL_BY_TEXT = Object.freeze([
  Object.freeze({ re: /\bbranch\b/i, value: 'branch_fit' }),
  Object.freeze({ re: /\bcareer|\bscope\b/i, value: 'career_scope' }),
  Object.freeze({ re: /\bcollege/i, value: 'college_fit' }),
]);

// Company Stage 2 body (PCM path).
const B2_BODY = 'Great 👍\n\nWhat are you looking for ?';
const B2_REASK = 'No worries — pick whichever is closest:';

function isGoalFilled(goal) {
  return typeof goal === 'string' && goal.length > 0;
}

function extractGoal(text) {
  const raw = String(text || '').trim();
  if (GOAL_BY_ID[raw]) return GOAL_BY_ID[raw];
  for (const { re, value } of GOAL_BY_TEXT) {
    if (re.test(raw)) return value;
  }
  return null;
}

function handleB2GoalEntry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  if (isGoalFilled(profile.goal)) {
    return handleB2Entry(withMergedProfile(ctx, profile));
  }
  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'button',
      body: B2_BODY,
      buttons: GOAL_BUTTONS,
    },
    contextPatch: { stage: 'b2_goal_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function handleB2GoalReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const goal = extractGoal(text);
  if (!goal) {
    return {
      replyText: null,
      replyParts: null,
      interactive: {
        type: 'button',
        body: B2_REASK,
        buttons: GOAL_BUTTONS,
      },
      contextPatch: { stage: 'b2_goal_awaiting_reply', profile },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }
  const merged = mergeFlowV2Profile(profile, { goal });
  return handleB2Entry(withMergedProfile(ctx, merged));
}

module.exports = {
  handleB2GoalEntry,
  handleB2GoalReply,
  extractGoal,
  GOAL_BUTTONS,
  B2_BODY,
};
