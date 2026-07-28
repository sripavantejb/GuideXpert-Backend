'use strict';

/**
 * Flow V3 — B5 · CHECKLIST (Company Stage 5).
 *
 * One bubble, zero taps, no college names. Sets checklistSent=true.
 * Never re-sends when checklistSent is already true (R13 return).
 * Same-turn advance to B6 PERMISSION.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { withMergedProfile } = require('../flowV2NodeUtils');
const { handleB6PermissionEntry } = require('./b6Permission');

/** Company Stage 5 — fixed checklist (no personalized preamble). */
function buildChecklistBody(_profile) {
  return [
    'Got it 👍',
    "Based on what you shared, here's something many students miss before joining a college.",
    'Before saying YES to any college, make sure you check these:',
    '✅ Is the curriculum updated?',
    '✅ Do students get real internships?',
    '✅ Do they teach coding from the 1st year?',
    '✅ Are industry skills part of learning?',
    '✅ How good are the placements?',
    '✅ Is the faculty experienced?',
    '✅ Does the college have a strong alumni network?',
    'These small things can make a big difference in your career.',
  ].join('\n');
}

function resolveInterestPhrase() {
  return '';
}

function resolvePriorityLine() {
  return '';
}

function handleB5ChecklistEntry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  // Never re-send checklist once delivered (R13 / return).
  if (profile.checklistSent === true) {
    return handleB6PermissionEntry(withMergedProfile(ctx, profile));
  }

  const merged = mergeFlowV2Profile(profile, { checklistSent: true });
  const body = buildChecklistBody(merged);

  // Same turn: checklist bubble + permission gate.
  const permission = handleB6PermissionEntry(withMergedProfile(ctx, merged));
  return {
    replyText: null,
    replyParts: [body, ...(permission.replyText ? [permission.replyText] : []), ...(permission.replyParts || [])],
    interactive: permission.interactive,
    contextPatch: {
      ...(permission.contextPatch || {}),
      profile: permission.contextPatch?.profile || merged,
    },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleB5ChecklistEntry,
  buildChecklistBody,
  resolveInterestPhrase,
  resolvePriorityLine,
};
