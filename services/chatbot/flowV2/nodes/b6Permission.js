'use strict';

/**
 * Flow V3 — B6 · PERMISSION (★ NEW).
 *
 * Only gate before shortlist. Yes → interim legacy constraints spine
 * (b3_awaiting_entry). No → soft-close, honour once.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { advanceToB3 } = require('../flowV2NodeUtils');

const PERMISSION_BODY =
  'Want me to shortlist a few colleges that actually match this — instead of a random top-10 list?';

const PERMISSION_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_b6_yes', title: 'Yes, show me 👍' }),
  Object.freeze({ id: 'flowv2_b6_not_now', title: 'Not right now' }),
]);

const DECLINE_TEXT = [
  'No problem 😊 The checklist above works on any college, so you\'ve got something to use either way.',
  '',
  "I'm here whenever you want the shortlist — just message me.",
].join('\n');

function alreadyAskedForColleges(profile) {
  if (profile?.permissionRecommend === true) return true;
  const door = String(profile?.door || '').toLowerCase();
  if (door.includes('college') || door === 'jumps_ahead') return true;
  return false;
}

function looksLikeYes(text) {
  const t = String(text || '').trim().toLowerCase();
  if (t === 'flowv2_b6_yes' || t.includes('yes, show me') || t === 'yes' || t.includes('show me')) {
    return true;
  }
  return false;
}

function looksLikeNo(text) {
  const t = String(text || '').trim().toLowerCase();
  if (t === 'flowv2_b6_not_now' || t.includes('not right now') || t === 'no' || t.includes('not now')) {
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
    // Interim Phase 1: drain into legacy constraints → bridge → shortlist.
    return advanceToB3(merged, null);
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
  return advanceToB3(merged, null);
}

module.exports = {
  handleB6PermissionEntry,
  handleB6PermissionReply,
  PERMISSION_BODY,
  PERMISSION_BUTTONS,
  DECLINE_TEXT,
};
