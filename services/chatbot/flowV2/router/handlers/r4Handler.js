'use strict';

/**
 * Flow v2 — R4 · Jumps ahead (sub-cases A–G).
 *
 * Answer the need they stated, write the captured slots, then rejoin the
 * spine at the documented node. R4-A hands off to R4-P (never B1 first).
 */

const { mergeFlowV2Profile } = require('../../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../../constants/careerCounsellingFlowV2Profile');
const { withMergedProfile, combineNodeResults } = require('../../flowV2NodeUtils');
const { handleB1Entry, B1_ROWS, B1_LIST_SECTION_TITLE, B1_LIST_BUTTON_TEXT } = require('../../nodes/b1Goal');
const { handleCoreForkEntry } = require('../../nodes/b2CoreFork');
const { handleB6Entry } = require('../../nodes/b6TheCase');
const { handleB7Entry } = require('../../nodes/b7Book');
const { handleR4PEntry } = require('../../nodes/r4pPredictor');
const { extractFlowV2Slots } = require('../../flowV2SlotExtractor');

const CORE_BRANCHES = new Set(['mechanical', 'civil', 'ece', 'eee', 'core']);

const R4_COLLEGE_COMPARE_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r4b_compare', title: 'Yes, compare fairly' }),
  Object.freeze({ id: 'flowv2_r4b_placements', title: 'Just their placements' }),
]);

const R4_MONEY_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r4c_under_2l', title: 'Under ₹2L' }),
  Object.freeze({ id: 'flowv2_r4c_2_5l', title: '₹2–5L' }),
  Object.freeze({ id: 'flowv2_r4c_5l_plus', title: '₹5L+' }),
  Object.freeze({ id: 'flowv2_r4c_not_sure', title: 'Not sure yet' }),
]);

const R4_ADMISSION_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r4f_book', title: 'Book the session' }),
  Object.freeze({ id: 'flowv2_r4f_shortlist', title: 'Shortlist first' }),
]);

const R4_VS_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_r4g_jobs', title: 'Fastest path to jobs' }),
  Object.freeze({ id: 'flowv2_r4g_mentorship', title: 'Deepest coding mentorship' }),
  Object.freeze({ id: 'flowv2_r4g_cost', title: 'Lower cost' }),
]);

const UNKNOWN_COLLEGE_CHECKLIST = [
  "I don't have reliable detail on that one — I won't guess.",
  "Here's what I'd ask them directly:",
  '• Placement report for your exact branch, last 3 years — not an overall %.',
  '• Who teaches the core subjects, and whether industry mentors are real or brochure copy.',
  '• Internship / project pipeline by name, not "industry exposure".',
  '• Total all-in cost including hostel, laptop, and "other fees".',
  '',
  'To rank options properly against your goals — what matters most to you?',
].join('\n');

const KNOWN_COLLEGE_READS = Object.freeze({
  niat: {
    name: 'NIAT',
    strong: 'AI-first CSE curriculum and project-heavy placement structure',
    weak: 'it is CSE/AI focused — not a pure core-engineering campus',
  },
  scaler: {
    name: 'Scaler',
    strong: 'industry-shaped mentorship and placement coaching',
    weak: 'it is not a traditional degree campus for every student',
  },
  newton: {
    name: 'Newton School',
    strong: 'job-oriented coding intensity',
    weak: 'fit depends heavily on whether you want that pace',
  },
  plaksha: {
    name: 'Plaksha',
    strong: 'interdisciplinary tech education',
    weak: 'selectivity and cost need a personal fit check',
  },
  kalvium: {
    name: 'Kalvium',
    strong: 'work-integrated CSE model',
    weak: 'the model is unconventional — worth verifying against your goals',
  },
});

function standardShape({
  replyText = null,
  replyParts = null,
  interactive = null,
  stage,
  profile,
  extras = {},
}) {
  return {
    replyText,
    replyParts,
    interactive,
    contextPatch: { stage, profile, ...extras },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function withJump(profile, jumpType, extra = {}) {
  return mergeFlowV2Profile(profile, {
    door: 'jumps_ahead',
    jumpType,
    temperature: jumpType === 'vs' ? 'hot' : 'warm',
    ...extra,
  });
}

function detectKnownCollege(text) {
  const t = String(text || '').toLowerCase();
  for (const [key, meta] of Object.entries(KNOWN_COLLEGE_READS)) {
    if (t.includes(key) || t.includes(meta.name.toLowerCase())) return meta;
  }
  if (t.includes("masters' union") || t.includes('masters union')) {
    return {
      name: "Masters' Union",
      strong: 'industry-connected programs',
      weak: 'fit and cost need a personal check I will not invent',
    };
  }
  return null;
}

function extractCollegeName(text) {
  const known = detectKnownCollege(text);
  if (known) return known.name;
  const m = String(text || '').match(/\b(?:about|is|at)\s+([A-Za-z][A-Za-z0-9'&. -]{1,40})/i);
  return m ? m[1].trim() : String(text || '').trim().slice(0, 60) || 'that college';
}

function buildB1Interactive(body) {
  return {
    type: 'list',
    body,
    buttonText: B1_LIST_BUTTON_TEXT,
    sections: [{ title: B1_LIST_SECTION_TITLE, rows: B1_ROWS }],
  };
}

async function handleR4A(ctx, text, classification) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const slots = classification?.extractedSlots || extractFlowV2Slots(text, profile);
  const merged = withJump(profile, 'rank', slots);
  return handleR4PEntry(withMergedProfile(ctx, merged));
}

function handleR4B(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const college = extractCollegeName(text);
  const known = detectKnownCollege(text);
  const merged = withJump(profile, 'college', { collegeOfInterest: college });

  if (!known) {
    return standardShape({
      replyText: null,
      interactive: buildB1Interactive(UNKNOWN_COLLEGE_CHECKLIST),
      stage: 'b1_awaiting_reply',
      profile: merged,
    });
  }

  const body = [
    "Good that you're researching rather than guessing.",
    '',
    `Straight read: ${known.name} is strong on ${known.strong}, less so on ${known.weak}.`,
    '',
    'Let me put two comparable ones next to it so you can judge on what matters to YOU — sound good?',
  ].join('\n');

  return standardShape({
    interactive: { type: 'button', body, buttons: R4_COLLEGE_COMPARE_BUTTONS },
    stage: 'r4_college_awaiting_reply',
    profile: merged,
  });
}

async function handleR4BReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const t = String(text || '');
  const compare = /\bcompare fairly\b|\byes\b/i.test(t);
  const placements = /\bjust their placements\b|\bplacements?\b/i.test(t);
  if (!compare && !placements) {
    return handleR4B(ctx, profile.collegeOfInterest || text);
  }

  const prefix = compare
    ? "Fair comparison coming — but to rank these properly I need one thing: what matters most to you?"
    : "Placement numbers only make sense against YOUR goals — what matters most to you?";

  const b1 = handleB1Entry(withMergedProfile(ctx, profile));
  return combineNodeResults([prefix], b1);
}

function handleR4C(ctx, text, classification) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const slots = classification?.extractedSlots || {};
  const merged = withJump(profile, 'money', slots);
  const body =
    "Totally fair thing to lead with — and honestly, good news: there are strong project-based colleges well under ₹2L/yr, and several offer scholarships.\n\nWhat range is comfortable for your family?";
  return standardShape({
    interactive: { type: 'button', body, buttons: R4_MONEY_BUTTONS },
    stage: 'r4_money_awaiting_reply',
    profile: merged,
  });
}

async function handleR4CReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const t = String(text || '').toLowerCase();
  let budgetBand = null;
  let scholarshipFlag = null;
  if (/under\s*₹?\s*2l/.test(t)) {
    budgetBand = 'under_2l';
    scholarshipFlag = true;
  } else if (/₹?\s*2\s*[–-]\s*5l|2-5l|2 to 5/.test(t)) {
    budgetBand = '2_4l';
  } else if (/₹?\s*5l\+|5l\+|5\s*\+|above\s*5/.test(t)) {
    budgetBand = 'above_10l';
  } else if (/not sure/.test(t)) {
    budgetBand = null;
  } else {
    return handleR4C(ctx, text, {});
  }

  const patch = {};
  if (budgetBand) patch.budgetBand = budgetBand;
  if (scholarshipFlag) patch.scholarshipFlag = true;
  const merged = mergeFlowV2Profile(profile, patch);
  const prefix = 'Good — that keeps it realistic. What matters most to you?';
  const b1 = handleB1Entry(withMergedProfile(ctx, merged));
  return combineNodeResults([prefix], b1);
}

async function handleR4D(ctx, text, classification) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const slots = classification?.extractedSlots || extractFlowV2Slots(text, profile);
  const branch = slots.branchInterest || null;
  const careerGoal = String(text || '').trim().slice(0, 120) || null;
  const merged = withJump(profile, 'goal', {
    ...slots,
    careerGoal,
    ...(branch ? { branchInterest: branch } : {}),
  });

  if (branch && CORE_BRANCHES.has(String(branch).toLowerCase())) {
    const normalized = mergeFlowV2Profile(merged, {
      branchInterest: String(branch).toLowerCase() === 'eee' ? 'ece' : String(branch).toLowerCase(),
    });
    return handleCoreForkEntry(withMergedProfile(ctx, normalized), text);
  }

  const prefix = branch
    ? "Clear goal — that helps a lot, and it's a flexible one.\nTo point you at the right colleges: what matters most to you?"
    : 'Got it — to point you at the right colleges: what matters most to you?';
  const b1 = handleB1Entry(withMergedProfile(ctx, merged));
  return combineNodeResults([prefix], b1);
}

function handleR4E(ctx, text, classification) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const slots = classification?.extractedSlots || extractFlowV2Slots(text, profile);
  const merged = withJump(profile, 'best', slots);
  const pushback = /\bjust (give|tell) me\b|\bsafe pick\b|\bjust the best\b/i.test(String(text || ''));

  if (pushback) {
    const body = [
      'Fair. Broadly safe bet for most students aiming tech: a placement-strong, project-heavy CSE/AI program that is not the most expensive option.',
      "But honestly — two taps and I can do much better than \"broadly\". What matters most to you?",
    ].join('\n\n');
    return standardShape({
      interactive: buildB1Interactive(body),
      stage: 'b1_awaiting_reply',
      profile: merged,
    });
  }

  const body = [
    'I\'ll get you there — but "best" depends on you, and I\'d hate to send you somewhere that\'s wrong for your goal.',
    '',
    'Two quick taps and I\'ll give you a real shortlist instead of a generic one. What matters most to you?',
  ].join('\n');

  return standardShape({
    interactive: buildB1Interactive(body),
    stage: 'b1_awaiting_reply',
    profile: merged,
  });
}

function handleR4F(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const merged = withJump(profile, 'admission');
  const body = [
    "I won't guess at dates — those change and a wrong one could cost you a seat.",
    '',
    'Your counsellor will have the current calendar. Want me to set that up? Meanwhile I can shortlist colleges against your goals.',
  ].join('\n');
  return standardShape({
    interactive: { type: 'button', body, buttons: R4_ADMISSION_BUTTONS },
    stage: 'r4_admission_awaiting_reply',
    profile: merged,
  });
}

async function handleR4FReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const t = String(text || '');
  if (/\bbook the session\b|\bbook\b/i.test(t)) {
    return handleB7Entry(withMergedProfile(ctx, profile));
  }
  if (/\bshortlist first\b|\bshortlist\b/i.test(t)) {
    return handleB1Entry(withMergedProfile(ctx, profile));
  }
  return handleR4F(ctx, text);
}

function handleR4G(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const merged = withJump(profile, 'vs');
  const body = [
    'Both are genuinely strong — so let\'s decide it on you, not on hype. Quick: which matters more to you right now?',
  ].join('\n');
  return standardShape({
    interactive: { type: 'button', body, buttons: R4_VS_BUTTONS },
    stage: 'r4_vs_awaiting_reply',
    profile: merged,
    extras: { r4VsPair: String(text || '').trim().slice(0, 80) },
  });
}

async function handleR4GReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const t = String(text || '').toLowerCase();
  let lean = null;
  let reason = null;
  if (/fastest path to jobs|jobs/.test(t)) {
    lean = 'the placement-stronger option';
    reason = 'you asked for the fastest path to jobs';
  } else if (/deepest coding mentorship|mentorship/.test(t)) {
    lean = 'the mentorship-heavy option';
    reason = 'you asked for the deepest coding mentorship';
  } else if (/lower cost|cost/.test(t)) {
    lean = 'the lower-cost option';
    reason = 'you asked to keep cost down';
  } else {
    return handleR4G(ctx, ctx?.flowV2?.r4VsPair || text);
  }

  const prefix = [
    `Based on that, I'd lean ${lean} — because ${reason}.`,
    '',
    "Honestly though, this final call is what a 1-on-1 nails in 20 minutes with real numbers in front of you. Want me to set it up after a quick case?",
  ].join('\n');

  const hotProfile = mergeFlowV2Profile(profile, { temperature: 'hot' });
  const b6 = handleB6Entry(withMergedProfile(ctx, hotProfile));
  // If B6 cannot run without shortlist, fall through to B7 invite early.
  if (!b6 || (!b6.replyText && !b6.replyParts && !b6.interactive)) {
    const b7 = handleB7Entry(withMergedProfile(ctx, hotProfile));
    return combineNodeResults([prefix], b7);
  }
  return combineNodeResults([prefix], {
    ...b6,
    contextPatch: {
      ...b6.contextPatch,
      stage: b6.contextPatch?.stage || 'b7_awaiting_entry',
      profile: hotProfile,
    },
  });
}

/**
 * @param {object} ctx
 * @param {string} text
 * @param {{ subCase?: string|null, extractedSlots?: object }} classification
 */
async function handleR4(ctx, text, classification = {}) {
  const sub = classification.subCase || null;
  switch (sub) {
    case 'rank':
      return handleR4A(ctx, text, classification);
    case 'college':
      return handleR4B(ctx, text);
    case 'money':
      return handleR4C(ctx, text, classification);
    case 'goal':
      return handleR4D(ctx, text, classification);
    case 'best':
      return handleR4E(ctx, text, classification);
    case 'admission':
      return handleR4F(ctx, text);
    case 'vs':
      return handleR4G(ctx, text);
    default:
      return handleR4A(ctx, text, classification);
  }
}

async function handleR4PendingReply(ctx, text) {
  const stage = ctx?.flowV2?.stage;
  if (stage === 'r4_college_awaiting_reply') return handleR4BReply(ctx, text);
  if (stage === 'r4_money_awaiting_reply') return handleR4CReply(ctx, text);
  if (stage === 'r4_admission_awaiting_reply') return handleR4FReply(ctx, text);
  if (stage === 'r4_vs_awaiting_reply') return handleR4GReply(ctx, text);
  return null;
}

module.exports = {
  handleR4,
  handleR4PendingReply,
  R4_COLLEGE_COMPARE_BUTTONS,
  R4_MONEY_BUTTONS,
  R4_ADMISSION_BUTTONS,
  R4_VS_BUTTONS,
  UNKNOWN_COLLEGE_CHECKLIST,
};
