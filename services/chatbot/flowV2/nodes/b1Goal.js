'use strict';

/**
 * Flow V3 — B4 · PRIORITY (was v2 B1 GOAL).
 *
 * Module path remains b1Goal.js to limit import churn. Stages:
 *   b4_awaiting_entry (drained) / b4_awaiting_reply (and legacy b1_* aliases).
 * Nine-row priority list. On success → B5 CHECKLIST.
 */

const { extractFlowV2Slots } = require('../flowV2SlotExtractor');
const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { withMergedProfile, combineNodeResults, advanceToB5Checklist } = require('../flowV2NodeUtils');
const { handleB5ChecklistEntry } = require('./b5Checklist');

const B1_ROWS = Object.freeze([
  Object.freeze({ id: 'flowv2_b4_placements', title: 'Placements' }),
  Object.freeze({ id: 'flowv2_b4_internships', title: 'Internships' }),
  Object.freeze({ id: 'flowv2_b4_curriculum', title: 'Curriculum' }),
  Object.freeze({ id: 'flowv2_b4_faculty', title: 'Faculty' }),
  Object.freeze({ id: 'flowv2_b4_campus', title: 'Campus life' }),
  Object.freeze({ id: 'flowv2_b4_fees', title: 'Fees & scholarships' }),
  Object.freeze({ id: 'flowv2_b4_location', title: 'Location' }),
  Object.freeze({ id: 'flowv2_b4_higher_studies', title: 'Higher studies' }),
  Object.freeze({ id: 'flowv2_b4_startup', title: 'Startup / entrepreneurship' }),
]);

// Legacy id aliases so older taps / tests still resolve.
const LEGACY_PRIORITY_IDS = Object.freeze({
  flowv2_b1_placements: 'placements',
  flowv2_b1_ai_future_tech: 'ai_future_tech',
  flowv2_b1_affordable_fees: 'fees',
  flowv2_b1_higher_studies: 'higher_studies',
  flowv2_b1_startup: 'startup',
  flowv2_b1_not_sure: 'not_sure',
  flowv2_b4_placements: 'placements',
  flowv2_b4_internships: 'internships',
  flowv2_b4_curriculum: 'curriculum',
  flowv2_b4_faculty: 'faculty',
  flowv2_b4_campus: 'campus',
  flowv2_b4_fees: 'fees',
  flowv2_b4_location: 'location',
  flowv2_b4_higher_studies: 'higher_studies',
  flowv2_b4_startup: 'startup',
});

const B1_LIST_SECTION_TITLE = 'What matters most?';
const B1_LIST_BUTTON_TEXT = 'Select';
const B1_QUESTION_TAIL = 'Last question before I give you something useful — what matters most?';
const B1_REASK_BODY = 'No worries — take your time. Pick whichever fits best for now:';

function qualificationAckLine(qualification) {
  const q = String(qualification || '').toLowerCase();
  if (q.includes('(pcm)') || q.includes('(mpc)')) return 'Perfect — MPC keeps engineering and tech wide open for you.';
  if (q.includes('(pcb)') || q.includes('(bipc)')) return 'Got it.';
  if (q.includes('(commerce)') || q.includes('mec') || q.includes('cec')) {
    return 'Got it — commerce opens up business, finance and design routes.';
  }
  if (q === 'diploma') return 'Good — and lateral entry gives you a real head start.';
  if (q === 'drop year' || q.includes('dropper') || q.includes('gap year')) {
    return 'Good — and a drop year works more often than people think.';
  }
  if (q === 'degree' || q.includes('already in college') || q.includes('b.tech') || q.includes('graduation')) {
    return 'Understood.';
  }
  if (q === '11th studying') return "Good timing — you've got room to prepare properly.";
  if (q === '10th completed') return "Good — plenty of runway to plan this properly.";
  return 'Thanks for sharing that.';
}

function buildB1ListInteractive(body) {
  return {
    type: 'list',
    body,
    buttonText: B1_LIST_BUTTON_TEXT,
    sections: [{ title: B1_LIST_SECTION_TITLE, rows: B1_ROWS }],
  };
}

function isGoalPriorityFilled(goalPriority) {
  return Array.isArray(goalPriority) && goalPriority.length > 0;
}

function resolvePriorityFromText(text, patch) {
  if (isGoalPriorityFilled(patch.goalPriority)) return patch.goalPriority;
  const raw = String(text || '').trim();
  if (LEGACY_PRIORITY_IDS[raw]) return [LEGACY_PRIORITY_IDS[raw]];
  const lower = raw.toLowerCase();
  for (const row of B1_ROWS) {
    if (lower === row.title.toLowerCase() || lower === row.id.toLowerCase()) {
      return [LEGACY_PRIORITY_IDS[row.id] || row.title.toLowerCase()];
    }
  }
  return null;
}

function handleB1Entry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  if (isGoalPriorityFilled(profile.goalPriority)) {
    return handleB5ChecklistEntry(withMergedProfile(ctx, profile));
  }

  const body = `${qualificationAckLine(profile.qualification)} ${B1_QUESTION_TAIL}`;
  return {
    replyText: null,
    replyParts: null,
    interactive: buildB1ListInteractive(body),
    contextPatch: { stage: 'b4_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

const GOAL_ACK_LEAD = Object.freeze({
  placements:
    "Noted — placements first. That genuinely changes what I'd recommend, so thanks for being clear.",
  placement:
    "Noted — placements first. That genuinely changes what I'd recommend, so thanks for being clear.",
  internships: 'Good — early internships are one of the clearest filters.',
  internship: 'Good — early internships are one of the clearest filters.',
  curriculum: 'Useful — syllabus reality matters more than brochures.',
  faculty: 'Good call — faculty quality is hard to fake.',
  campus: 'Fair — campus life is part of the decision.',
  fees: 'Completely fair — and there are genuinely good options in that range.',
  affordable: 'Completely fair — and there are genuinely good options in that range.',
  location: 'Got it — proximity matters, and we will treat it that way.',
  higher_studies: 'Useful to know — that changes which colleges actually make sense.',
  startup: "Good — that's a different filter entirely, and a useful one.",
  entrepreneurship: "Good — that's a different filter entirely, and a useful one.",
  ai_future_tech: "Good instinct — that's where the sharpest students are heading right now.",
  not_sure: 'Totally fine — we can keep that open.',
});

function goalPriorityAckLine(goalPriority) {
  const key = String(goalPriority[0] || '').toLowerCase();
  return GOAL_ACK_LEAD[key] || 'Noted — got it.';
}

function reAskB1(mergedProfile) {
  return {
    replyText: null,
    replyParts: null,
    interactive: buildB1ListInteractive(B1_REASK_BODY),
    contextPatch: { stage: 'b4_awaiting_reply', profile: mergedProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function handleB1Reply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const patch = extractFlowV2Slots(text, profile);
  const priorities = resolvePriorityFromText(text, patch);

  if (!isGoalPriorityFilled(priorities)) {
    const mergedProfile = mergeFlowV2Profile(profile, patch);
    return reAskB1(mergedProfile);
  }

  const extra = { goalPriority: priorities };
  if (priorities.includes('fees') || String(text).toLowerCase().includes('scholarship')) {
    extra.scholarshipFlag = true;
  }

  const mergedProfile = mergeFlowV2Profile(profile, { ...patch, ...extra });
  const ackLine = goalPriorityAckLine(priorities);
  const nextResult = handleB5ChecklistEntry(withMergedProfile(ctx, mergedProfile));
  return combineNodeResults([ackLine], nextResult);
}

module.exports = {
  handleB1Entry,
  handleB1Reply,
  qualificationAckLine,
  goalPriorityAckLine,
  buildB1ListInteractive,
  B1_ROWS,
  B1_LIST_SECTION_TITLE,
  B1_LIST_BUTTON_TEXT,
  B1_QUESTION_TAIL,
  B1_REASK_BODY,
  advanceToB5Checklist,
};
