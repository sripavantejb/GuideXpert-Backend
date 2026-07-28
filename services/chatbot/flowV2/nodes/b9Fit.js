'use strict';

/**
 * Flow V3 — B9 · FIT + Stage 9 NIAT pitch + interest gate (then B10).
 *
 * Fit ask → rich NIAT pitch → "interested?" → only then booking invite.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { assertGuardrails } = require('../../../../constants/careerCounsellingFlowV2Guardrails');
const { withMergedProfile, combineNodeResults } = require('../flowV2NodeUtils');
const { handleB7Entry } = require('./b7Book');
const { FIT_ASK_BODY: SHORTLIST_FIT_ASK, FIT_BUTTONS: SHORTLIST_FIT_BUTTONS } = require('./b8FlatShortlist');

const FIT_ASK_BODY = SHORTLIST_FIT_ASK || 'Would you like me to help you find the best fit?';
const FIT_BUTTONS = SHORTLIST_FIT_BUTTONS || Object.freeze([
  Object.freeze({ id: 'flowv2_b9_yes', title: 'Yes, help me' }),
  Object.freeze({ id: 'flowv2_b9_self', title: "I'll explore myself" }),
]);

const NIAT_INTEREST_BODY = 'Does exploring NIAT further sound interesting to you?';
const NIAT_INTEREST_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_b9_niat_yes', title: "Yes, I'm interested" }),
  Object.freeze({ id: 'flowv2_b9_niat_no', title: 'Not for me' }),
]);

const NIAT_INTEREST_DECLINE = [
  'Totally fair 👍',
  'There are other strong options on that shortlist too — Newton, Scaler, Polar and Plaksha each have a different style.',
  '',
  "If you want a second opinion later, or a free chat with an IITian counsellor, I'm here.",
].join('\n');

const SELF_LOOKUP_TEXT = [
  'Good — take your time exploring 👍',
  '',
  "If you want a second opinion after you've looked, I'm here.",
].join('\n');

const HONEST_PASS_TEXT = [
  "Being straight with you — from what you've shared, I'm not sure any of these colleges is the obvious fit. Your interests point somewhere our catalog doesn't cover well, and I'd rather say that than talk you into one.",
  '',
  'The checklist above still works on whatever you’re considering.',
  '',
  "If it'd help, I can put you in front of a counsellor who'll talk through the options that *do* fit — including ones we have nothing to do with.",
].join('\n');

const COMPARE_TABLE = [
  "Here's how they stack up on what you care about 👇",
  '',
  'Focus           Newton · NIAT · Scaler · Polar · Plaksha',
  'AI / curriculum ●●     · ●●●  · ●●●    · ●●    · ●●●',
  'Projects        ●●●    · ●●●  · ●●●    · ●●●   · ●●',
  'Internships     ●●     · ●●●  · ●●●    · ●●    · ●●',
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
 * Rich NIAT pitch — curriculum, partner campuses, internships, placement support.
 * Sourced from public NIAT/NxtWave materials; no outcome guarantees.
 */
function buildNiatCounsellorPitch(profile) {
  const why = priorityTiedReason(profile);
  const interest = interestPhrase(profile);
  return [
    'Sure 😊',
    `From what you shared about ${interest}, NIAT (NxtWave Institute of Advanced Technologies) is one of the strongest options to explore — ${why}.`,
    '',
    '📚 Curriculum',
    '• AI-first B.Tech-style path with 4 phases: Decode → Develop → Architect → Ship',
    '• Focus on full-stack, AI/ML and shipping real projects — not only semester exams',
    '• Industry-oriented syllabus that refreshes with tools students actually use',
    '',
    '🏫 Degree + tied-up colleges',
    '• NIAT is an industry upskilling layer by NxtWave (not a standalone degree university)',
    '• You study on partner university campuses; the UGC-recognised degree comes from that university',
    '• Partner network spans multiple cities — examples include campuses linked with Chaitanya, DY Patil, Yenepoya, Crescent, S-VYASA, Aurora and others',
    '',
    '🛠️ Internships & real work',
    '• Internships can start early in the journey — not only in the final year',
    '• Multiple hands-on projects across the 4 years',
    '• Many students also get stipend-based internship opportunities (amounts vary by role)',
    '',
    '💼 Placement support',
    '• Mock interviews, mentoring and hiring-partner access through the NxtWave network',
    '• Strong placement support culture — results still depend on your effort and performance',
    '',
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

function looksLikeNiatNotInterested(text) {
  const t = String(text || '').trim().toLowerCase();
  return (
    t === 'flowv2_b9_niat_no' ||
    t.includes('not for me') ||
    t.includes('not interested') ||
    t.includes('no thanks') ||
    t.includes('maybe later') ||
    t === 'no'
  );
}

function looksLikeNiatInterested(text) {
  const t = String(text || '').trim().toLowerCase();
  if (looksLikeNiatNotInterested(t)) return false;
  return (
    t === 'flowv2_b9_niat_yes' ||
    t.includes("yes, i'm interested") ||
    t.includes('yes im interested') ||
    t.includes("i'm interested") ||
    t.includes('yes, book') ||
    t === 'yes' ||
    t.includes('tell me more') ||
    t.includes('book session') ||
    t.includes('book my')
  );
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
  if (/\bpolar\b/.test(t)) return { id: 'polar', name: 'Polar School of Technology' };
  if (/\bplaksha\b/.test(t)) return { id: 'plaksha', name: 'Plaksha University' };
  if (/\bkalvium\b/.test(t)) return { id: 'kalvium', name: 'Kalvium' };
  return null;
}

function deliverNiatInterestAsk(ctx, profile, pitchText) {
  assertGuardrails(pitchText);
  assertGuardrails(NIAT_INTEREST_BODY);
  const merged = mergeFlowV2Profile(profile, {
    fitCollege: 'niat',
    fitReason: priorityTiedReason(profile),
    recommendation: 'niat',
    honestPassFired: false,
    niatInterest: null,
  });
  return {
    replyText: null,
    replyParts: [pitchText],
    interactive: {
      type: 'button',
      body: NIAT_INTEREST_BODY,
      buttons: NIAT_INTEREST_BUTTONS,
    },
    contextPatch: { stage: 'b9_niat_interest_awaiting_reply', profile: merged },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function deliverNiatPitch(ctx, profile) {
  if (shouldHonestPass(profile)) {
    const merged = mergeFlowV2Profile(profile, {
      honestPassFired: true,
      fitCollege: null,
      recommendation: null,
    });
    assertGuardrails(HONEST_PASS_TEXT);
    // Soft counsellor invite only — still ask before hard booking push.
    const askBody = 'Would a free chat with an IITian counsellor help you sort this?';
    const buttons = Object.freeze([
      Object.freeze({ id: 'flowv2_b9_niat_yes', title: 'Yes, book session' }),
      Object.freeze({ id: 'flowv2_b9_niat_no', title: 'Maybe Later' }),
    ]);
    return {
      replyText: null,
      replyParts: [HONEST_PASS_TEXT],
      interactive: { type: 'button', body: askBody, buttons },
      contextPatch: { stage: 'b9_niat_interest_awaiting_reply', profile: merged },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  return deliverNiatInterestAsk(ctx, profile, buildNiatCounsellorPitch(profile));
}

function deliverNamedCollege(ctx, profile, college) {
  const id = String(college.id || '').toLowerCase();
  if (id === 'niat') return deliverNiatPitch(ctx, profile);

  const body = [
    `Got it — *${college.name}* is on your shortlist.`,
    '',
    `You said ${priorityPhrase(profile)} matters most. I can walk you through how it compares on curriculum, internships and fees — including how it stacks next to NIAT — on a short counsellor call.`,
    '',
    'Would that be useful?',
  ].join('\n');
  assertGuardrails(body);
  const merged = mergeFlowV2Profile(profile, {
    fitCollege: college.id,
    fitReason: `student asked about ${college.name}`,
    recommendation: college.id,
    honestPassFired: false,
  });
  return {
    replyText: null,
    replyParts: [body],
    interactive: {
      type: 'button',
      body: 'Want me to book a free IITian session to dig into this?',
      buttons: NIAT_INTEREST_BUTTONS,
    },
    contextPatch: { stage: 'b9_niat_interest_awaiting_reply', profile: merged },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
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

function handleB9NiatInterestReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  if (looksLikeNiatNotInterested(text)) {
    const merged = mergeFlowV2Profile(profile, { niatInterest: false });
    return {
      replyText: NIAT_INTEREST_DECLINE,
      replyParts: null,
      interactive: null,
      contextPatch: { stage: 'b9_parked_warm', profile: merged },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  if (looksLikeNiatInterested(text)) {
    const merged = mergeFlowV2Profile(profile, { niatInterest: true });
    return handleB7Entry(withMergedProfile(ctx, merged));
  }

  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'button',
      body: NIAT_INTEREST_BODY,
      buttons: NIAT_INTEREST_BUTTONS,
    },
    contextPatch: { stage: 'b9_niat_interest_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function handleB9Reply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const stage = ctx?.flowV2?.stage;

  if (stage === 'b9_niat_interest_awaiting_reply') {
    return handleB9NiatInterestReply(ctx, text);
  }

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
  handleB9NiatInterestReply,
  buildNiatCounsellorPitch,
  shouldHonestPass,
  priorityTiedReason,
  FIT_ASK_BODY,
  FIT_BUTTONS,
  NIAT_INTEREST_BODY,
  NIAT_INTEREST_BUTTONS,
  HONEST_PASS_TEXT,
  COMPARE_TABLE,
  SELF_LOOKUP_TEXT,
  interestPhrase,
};
