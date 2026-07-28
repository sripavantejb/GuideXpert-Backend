'use strict';

/**
 * Flow V3 — B9 · FIT (Company Stage 8 ask + Stage 9 NIAT soft nudge).
 *
 * Ask → on yes: company NIAT pitch → B10.
 * Self-explore honoured once.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { assertGuardrails } = require('../../../../constants/careerCounsellingFlowV2Guardrails');
const { advanceToB10 } = require('../flowV2NodeUtils');

// Company Stage 8 closing ask (shown after medal shortlist).
const FIT_ASK_BODY = 'Would you like me to help you find the best fit?';
const FIT_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_b9_yes', title: 'Yes, help me' }),
  // Company: "I'll explore myself" (19 ≤ 20)
  Object.freeze({ id: 'flowv2_b9_self', title: "I'll explore myself" }),
]);

const SELF_LOOKUP_TEXT = [
  'Good — take your time exploring 👍',
  '',
  "If you want a second opinion after you've looked, I'm here.",
].join('\n');

const HONEST_PASS_TEXT = [
  "Being straight with you — from what you've shared, I'm not sure any of these three is the obvious fit. Your interests point somewhere our catalog doesn't cover well, and I'd rather say that than talk you into one.",
  '',
  'The checklist above still works on whatever you’re considering.',
  '',
  "If it'd help, I can put you in front of a counsellor who'll talk through the options that *do* fit — including ones we have nothing to do with.",
].join('\n');

/** Compact compare — 3 medal colleges. */
const COMPARE_TABLE = [
  "Here's how the three stack up on what you care about 👇",
  '',
  'Focus           Newton · NIAT · Scaler',
  'AI / curriculum ●●     · ●●●  · ●●●',
  'Projects        ●●●    · ●●●  · ●●●',
  'Internships     ●●     · ●●●  · ●●●',
  'Mentorship      ●●     · ●●●  · ●●●',
].join('\n');

const NIAT_NAME = 'NIAT';

function priorityPhrase(profile) {
  const p = Array.isArray(profile?.goalPriority) ? profile.goalPriority[0] : null;
  if (!p) return 'finding a solid fit';
  return String(p).replace(/_/g, ' ');
}

function interestPhrase(profile) {
  const cluster = profile?.interestCluster;
  if (cluster === 'software') return 'software and building';
  if (cluster === 'data_ai') return 'AI and data';
  if (cluster === 'infra_security') return 'cloud and security';
  if (cluster === 'core') return 'core engineering with a software door';
  if (cluster === 'undecided') return 'still exploring directions';
  const interests = Array.isArray(profile?.interests) ? profile.interests : [];
  if (interests.length) return interests.slice(0, 2).join(' and ').replace(/_/g, ' ');
  return 'what you shared';
}

function priorityTiedReason(profile) {
  const primary = String((profile?.goalPriority && profile.goalPriority[0]) || '').toLowerCase();
  const cluster = String(profile?.interestCluster || '').toLowerCase();
  if (primary.includes('placement')) {
    return 'its industry-linked training is built around becoming job-ready, not just exam-ready';
  }
  if (primary.includes('internship') || primary.includes('project')) {
    return 'students get real project and internship exposure early, not certificate theatre in the final year';
  }
  if (primary.includes('curriculum') || primary.includes('ai') || primary.includes('future')) {
    return 'the curriculum is updated for industry tools and AI/software depth, not a once-a-decade syllabus cycle';
  }
  if (primary.includes('faculty') || primary.includes('mentor')) {
    return 'industry-experienced mentors sit alongside teaching, which matches how you said you want to learn';
  }
  if (primary.includes('fee') || primary.includes('afford') || primary.includes('scholarship')) {
    return "you'll still need to check full four-year cost and scholarships in writing — and a counsellor call is the right place for that";
  }
  if (primary.includes('location') || primary.includes('campus') || primary.includes('sport')) {
    return "campus environment and day-to-day learning culture are easier to judge with someone who's walked students through it";
  }
  if (cluster === 'data_ai') {
    return 'its AI-first path lines up with where your head already is';
  }
  if (cluster === 'software' || cluster === 'infra_security') {
    return 'coding and applied building start early, which matches a software-leaning direction';
  }
  return 'it balances modern curriculum, real internships and an industry-linked environment better than a brochure ranking can';
}

/**
 * Honest pass only when catalog clearly does not fit — not a silent always-NIAT lie.
 */
function shouldHonestPass(profile) {
  const cluster = String(profile?.interestCluster || '').toLowerCase();
  const status = String(profile?.status || '').toLowerCase();
  if (
    status === 'out_of_scope_core' ||
    (profile?.coreBridgeClosed === true && cluster === 'core')
  ) {
    return true;
  }
  const hasPriority = Array.isArray(profile?.goalPriority) && profile.goalPriority.length > 0;
  const hasBranch = typeof profile?.branchInterest === 'string' && profile.branchInterest.length > 0;
  if (cluster === 'undecided' && !hasPriority && !hasBranch) return true;
  return false;
}

/**
 * Company Stage 9 — soft NIAT nudge (verbatim).
 */
function buildNiatCounsellorPitch(_profile) {
  return [
    'Sure 😊',
    'From your interests, NIAT looks like one of the strongest options to explore.',
    'It focuses on:',
    '✅ AI & Tech skills',
    '✅ Practical learning',
    '✅ Industry projects',
    '✅ Strong placement support',
    "But I don't want you to choose a college just because I suggested it.",
    "Let's make sure it's actually the right fit for you.",
  ].join('\n');
}

function looksLikeYes(text) {
  const t = String(text || '').toLowerCase();
  return (
    t.includes('flowv2_b9_yes') ||
    t.includes('yes, help') ||
    t.includes('yes, narrow') ||
    t === 'yes' ||
    t.includes('help me') ||
    t.includes('narrow it') ||
    t.includes('suggest') ||
    t.includes('best college') ||
    t.includes('best fit')
  );
}

function looksLikeSelf(text) {
  const t = String(text || '').toLowerCase();
  return (
    t.includes('flowv2_b9_self') ||
    t.includes('look them up') ||
    t.includes("i'll look") ||
    t.includes('explore myself') ||
    t.includes("i'll explore") ||
    t.includes('myself')
  );
}

function looksLikeCompare(text) {
  const t = String(text || '').toLowerCase();
  return /\bcompare\b|\bstack up\b|\bvs\b|\bversus\b/.test(t);
}

function namedCollegeFromText(text, profile) {
  const t = String(text || '').toLowerCase();
  const list = Array.isArray(profile?.shortlist) ? profile.shortlist : [];
  for (const c of list) {
    const name = String(c.name || c.id || '').toLowerCase();
    const first = name.split(' ')[0];
    if (first && t.includes(first)) return c;
  }
  if (/\bniat\b/.test(t)) return { id: 'niat', name: NIAT_NAME };
  if (/\bnewton\b/.test(t)) return { id: 'newton', name: 'Newton School of Technology' };
  if (/\bscaler\b/.test(t)) return { id: 'scaler', name: 'Scaler' };
  if (/\bplaksha\b/.test(t)) return { id: 'plaksha', name: 'Plaksha University' };
  if (/\bkalvium\b/.test(t)) return { id: 'kalvium', name: 'Kalvium' };
  return null;
}

function deliverNiatPitch(ctx, profile) {
  if (shouldHonestPass(profile)) {
    const merged = mergeFlowV2Profile(profile, {
      honestPassFired: true,
      fitCollege: null,
      recommendation: null,
    });
    assertGuardrails(HONEST_PASS_TEXT);
    return advanceToB10(merged, HONEST_PASS_TEXT);
  }

  const body = buildNiatCounsellorPitch(profile);
  assertGuardrails(body);
  const merged = mergeFlowV2Profile(profile, {
    fitCollege: 'niat',
    fitReason: priorityTiedReason(profile),
    recommendation: 'niat',
    honestPassFired: false,
  });
  return advanceToB10(merged, body);
}

/** If student named a non-NIAT college, acknowledge it then still offer counsellor depth. */
function deliverNamedCollege(ctx, profile, college) {
  const id = String(college.id || '').toLowerCase();
  if (id === 'niat') return deliverNiatPitch(ctx, profile);

  const body = [
    `Got it — *${college.name}* is on your shortlist.`,
    '',
    `You said ${priorityPhrase(profile)} matters most. I can walk you through how it compares on curriculum, internships and fees on a short counsellor call — that's cleaner than me guessing from four answers.`,
    '',
    'Shall I book you in?',
  ].join('\n');
  assertGuardrails(body);
  const merged = mergeFlowV2Profile(profile, {
    fitCollege: college.id,
    fitReason: `student asked about ${college.name}`,
    recommendation: college.id,
    honestPassFired: false,
  });
  return advanceToB10(merged, body);
}

function handleB9Entry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  return {
    replyText: null,
    replyParts: null,
    interactive: { type: 'button', body: FIT_ASK_BODY, buttons: FIT_BUTTONS },
    contextPatch: { stage: 'b9_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function handleB9Reply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  if (looksLikeCompare(text)) {
    assertGuardrails(COMPARE_TABLE);
    return {
      replyText: COMPARE_TABLE,
      replyParts: null,
      interactive: { type: 'button', body: FIT_ASK_BODY, buttons: FIT_BUTTONS },
      contextPatch: { stage: 'b9_awaiting_reply', profile },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  const named = namedCollegeFromText(text, profile);
  if (named && !looksLikeSelf(text) && !looksLikeYes(text)) {
    return deliverNamedCollege(ctx, profile, named);
  }

  if (looksLikeSelf(text)) {
    const merged = mergeFlowV2Profile(profile, { nudgeSent: false });
    return {
      replyText: SELF_LOOKUP_TEXT,
      replyParts: null,
      interactive: null,
      contextPatch: { stage: 'b9_parked_warm', profile: merged },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  if (looksLikeYes(text)) {
    return deliverNiatPitch(ctx, profile);
  }

  return {
    replyText: null,
    replyParts: null,
    interactive: { type: 'button', body: FIT_ASK_BODY, buttons: FIT_BUTTONS },
    contextPatch: { stage: 'b9_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleB9Entry,
  handleB9Reply,
  buildNiatCounsellorPitch,
  shouldHonestPass,
  priorityTiedReason,
  FIT_ASK_BODY,
  FIT_BUTTONS,
  HONEST_PASS_TEXT,
  COMPARE_TABLE,
  SELF_LOOKUP_TEXT,
  interestPhrase,
};
