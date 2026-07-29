'use strict';

/**
 * Flow V3 — B8 · SHORTLIST (Company Stage 8).
 *
 * After Stage 7 framing, ask before showing colleges, then ship top 5
 * + fit ask in ONE interactive so WhatsApp never drops the list.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { assertGuardrails } = require('../../../../constants/careerCounsellingFlowV2Guardrails');

const FLAT_CATALOG = Object.freeze([
  Object.freeze({ id: 'newton', name: 'Newton School of Technology', medal: '🥇' }),
  Object.freeze({ id: 'niat', name: 'NIAT', medal: '🥈' }),
  Object.freeze({ id: 'scaler', name: 'Scaler', medal: '🥉' }),
  Object.freeze({ id: 'polar', name: 'Polar School of Technology', medal: null }),
  Object.freeze({ id: 'plaksha', name: 'Plaksha University', medal: null }),
]);

const WIDER_CATALOG_LINE =
  "Wider options people often ask about: Kalvium · Masters' Union · Krea · Ahmedabad Univ · UPES · SRM AP.\n\nRun them through the same checklist before you decide.";

const DISCLOSURE = '';

/** Explicit gate after Stage 7 — before the top-5 list. */
const SHORTLIST_ASK_BODY = 'Want to see your top 5 college matches?';
const SHORTLIST_ASK_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_b8_show', title: 'Yes, show me' }),
  Object.freeze({ id: 'flowv2_b8_later', title: 'Maybe Later' }),
]);

const SHORTLIST_ASK_DECLINE = [
  'No problem 😊',
  "Whenever you're ready for the shortlist, just say the word.",
].join('\n');

const FIT_ASK_BODY = 'Want me to pick the best fit for you?';
const FIT_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_b9_yes', title: 'Yes, help me' }),
  Object.freeze({ id: 'flowv2_b9_self', title: "I'll explore myself" }),
]);

function interestPhrase(profile) {
  const cluster = profile?.interestCluster;
  if (cluster === 'software') return "you're leaning towards software";
  if (cluster === 'data_ai') return 'AI and data is where your head is';
  if (cluster === 'infra_security') return 'cloud and security interests you';
  if (cluster === 'core' || profile?.coreInterest) return "you're coming at this from a core branch";
  const b = String(profile?.branchInterest || '').toLowerCase();
  if (b.includes('cse') || b === 'cse_ai' || b === 'it') return "you're leaning towards software";
  if (b.includes('data') || b.includes('ai')) return 'AI and data is where your head is';
  return "you're still weighing directions";
}

function priorityPhrase(profile) {
  const p = Array.isArray(profile?.goalPriority) ? profile.goalPriority[0] : null;
  if (!p) return 'finding a solid fit';
  return String(p).replace(/_/g, ' ');
}

function orderCatalog(_profile) {
  return [...FLAT_CATALOG];
}

function buildShortlistBody(_profile, colleges) {
  const lines = [
    "From what you've shared💡",
    '',
    'Here your top 5 colleges👇',
    '',
  ];
  for (const c of colleges) {
    const mark = c.medal || '🔹';
    lines.push(`${mark} ${c.name}`);
  }
  lines.push(
    '',
    'Each college has its own strengths.',
    '',
    'The best choice depends on your career goals, budget, and interests. 🎯',
    '',
    FIT_ASK_BODY
  );
  return lines.join('\n');
}

function looksLikeWiderAsk(text) {
  const t = String(text || '').toLowerCase();
  return /\bshow me all\b|\bfull list\b|\bother options\b|\bwhat are the other\b/.test(t);
}

function looksLikeShowShortlist(text) {
  const t = String(text || '').trim().toLowerCase();
  return (
    t === 'flowv2_b8_show' ||
    t.includes('yes, show') ||
    t === 'yes' ||
    t.includes('show me') ||
    t.includes('top 5') ||
    t.includes('suggest')
  );
}

function looksLikeDeferShortlist(text) {
  const t = String(text || '').trim().toLowerCase();
  return (
    t === 'flowv2_b8_later' ||
    t.includes('maybe later') ||
    t.includes('not now') ||
    t.includes('not right now') ||
    t === 'no'
  );
}

/** After Stage 7 — ask before dumping the college list. */
function handleB8ShortlistAskEntry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  if (Array.isArray(profile.shortlist) && profile.shortlist.length > 0) {
    return handleB8Entry(ctx);
  }
  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'button',
      body: SHORTLIST_ASK_BODY,
      buttons: SHORTLIST_ASK_BUTTONS,
    },
    contextPatch: { stage: 'b8_shortlist_ask_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function handleB8ShortlistAskReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  if (looksLikeDeferShortlist(text)) {
    const merged = mergeFlowV2Profile(profile, { shortlistAskDeclined: true });
    return {
      replyText: SHORTLIST_ASK_DECLINE,
      replyParts: null,
      interactive: null,
      contextPatch: { stage: 'b8_shortlist_ask_declined', profile: merged },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  if (!looksLikeShowShortlist(text)) {
    return handleB8ShortlistAskEntry(ctx);
  }

  return handleB8Entry(withProfile(ctx, profile));
}

function withProfile(ctx, profile) {
  return { ...(ctx || {}), flowV2: { ...((ctx && ctx.flowV2) || {}), profile } };
}

function handleB8Entry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  if (
    profile.status === 'out_of_scope_core' ||
    (profile.coreBridgeClosed === true && !profile.branchInterest)
  ) {
    return {
      replyText: "We're parked on the honest core-engineering path — message anytime if you want to revisit.",
      replyParts: null,
      interactive: null,
      contextPatch: { stage: 'parked_core', profile },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  // Already showed shortlist this journey — only re-ask fit if needed.
  if (Array.isArray(profile.shortlist) && profile.shortlist.length > 0) {
    const fit = require('./b9Fit');
    return fit.handleB9Entry(ctx);
  }

  const colleges = orderCatalog(profile);
  const body = buildShortlistBody(profile, colleges);
  assertGuardrails(body);

  const shortlist = colleges.map((c) => ({
    id: c.id,
    name: c.name,
    medal: c.medal,
  }));
  const merged = mergeFlowV2Profile(profile, { shortlist, shortlistAskDeclined: false });
  merged.shortlist = shortlist;

  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'button',
      body,
      buttons: FIT_BUTTONS,
    },
    contextPatch: { stage: 'b9_awaiting_reply', profile: merged },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function handleB8Reply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  if (looksLikeWiderAsk(text)) {
    assertGuardrails(WIDER_CATALOG_LINE);
    return {
      replyText: WIDER_CATALOG_LINE,
      replyParts: null,
      interactive: {
        type: 'button',
        body: FIT_ASK_BODY,
        buttons: FIT_BUTTONS,
      },
      contextPatch: { stage: 'b9_awaiting_reply', profile },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }
  const fit = require('./b9Fit');
  return fit.handleB9Reply(ctx, text);
}

module.exports = {
  handleB8Entry,
  handleB8Reply,
  handleB8ShortlistAskEntry,
  handleB8ShortlistAskReply,
  buildShortlistBody,
  FLAT_CATALOG,
  DISCLOSURE,
  WIDER_CATALOG_LINE,
  SHORTLIST_ASK_BODY,
  SHORTLIST_ASK_BUTTONS,
  SHORTLIST_ASK_DECLINE,
  FIT_ASK_BODY,
  FIT_BUTTONS,
  interestPhrase,
  priorityPhrase,
};
