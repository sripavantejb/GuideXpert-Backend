'use strict';

/**
 * Flow V3 — B6 · PERMISSION (Company Stage 6).
 *
 * Only gate before shortlist. Yes → B7 TWO MODELS (skips B6.5 constraints
 * on the company happy path). No / Maybe Later → soft-close, honour once.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { advanceToB7TwoModels } = require('../flowV2NodeUtils');

const PERMISSION_BODY =
  'Would you like me to suggest colleges that match your interests and goals, instead of giving you a random list?';

// Company Stage 6 buttons (WA title ≤20).
const PERMISSION_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_b6_yes', title: 'Yes 👍' }),
  Object.freeze({ id: 'flowv2_b6_not_now', title: 'Maybe Later' }),
]);

const DECLINE_TEXT = [
  'No problem 😊 The checklist above works on any college, so you\'ve got something to use either way.',
  '',
  "I'm here whenever you want the shortlist — just message me.",
].join('\n');

function alreadyAskedForColleges(profile) {
  // Only skip when the student already answered this gate.
  // Do NOT skip because goal/door mentions "college" — Stage 2 "Best colleges
  // for my profile" was wrongly auto-skipping Stage 6 and dumping B7–B9.
  return profile?.permissionRecommend === true;
}

function looksLikeYes(text) {
  const t = String(text || '').trim().toLowerCase();
  if (
    t === 'flowv2_b6_yes' ||
    t.includes('yes, show me') ||
    t === 'yes' ||
    t === 'yes 👍' ||
    t.includes('show me') ||
    t.includes('yes 👍')
  ) {
    return true;
  }
  return false;
}

function looksLikeNo(text) {
  const t = String(text || '').trim().toLowerCase();
  if (
    t === 'flowv2_b6_not_now' ||
    t.includes('not right now') ||
    t === 'no' ||
    t.includes('not now') ||
    t.includes('maybe later')
  ) {
    return true;
  }
  return false;
}

function handleB6PermissionEntry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  // Skip gate if permission already given or student already asked for colleges.
  if (alreadyAskedForColleges(profile) || profile.permissionRecommend === true) {
    const merged = mergeFlowV2Profile(profile, {
      permissionRecommend: true,
      temperature: 'hot',
    });
    return advanceToB7TwoModels(merged, null);
  }

  if (profile.permissionRecommend === false) {
    return {
      replyText: DECLINE_TEXT,
      replyParts: null,
      interactive: null,
      contextPatch: { stage: 'b6_permission_declined', profile },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'button',
      body: PERMISSION_BODY,
      buttons: PERMISSION_BUTTONS,
    },
    contextPatch: { stage: 'b6_permission_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function handleB6PermissionReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  if (looksLikeNo(text)) {
    const merged = mergeFlowV2Profile(profile, {
      permissionRecommend: false,
      nudgeSent: false,
    });
    return {
      replyText: DECLINE_TEXT,
      replyParts: null,
      interactive: null,
      contextPatch: { stage: 'b6_permission_declined', profile: merged },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  if (!looksLikeYes(text)) {
    return {
      replyText: null,
      replyParts: null,
      interactive: {
        type: 'button',
        body: PERMISSION_BODY,
        buttons: PERMISSION_BUTTONS,
      },
      contextPatch: { stage: 'b6_permission_awaiting_reply', profile },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  const merged = mergeFlowV2Profile(profile, {
    permissionRecommend: true,
    temperature: 'hot',
  });
  // Company happy path: skip B6.5 budget/location → B7 two models.
  return advanceToB7TwoModels(merged, null);
}

module.exports = {
  handleB6PermissionEntry,
  handleB6PermissionReply,
  PERMISSION_BODY,
  PERMISSION_BUTTONS,
  DECLINE_TEXT,
};
