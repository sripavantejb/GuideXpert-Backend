'use strict';

/**
 * Flow V3 — B8 · SHORTLIST (Company Stage 8 — 3 medal colleges).
 *
 * Newton / NIAT / Scaler with medal framing. Same-turn handoff to B9 fit ask.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { assertGuardrails } = require('../../../../constants/careerCounsellingFlowV2Guardrails');
const { withMergedProfile, combineNodeResults } = require('../flowV2NodeUtils');

/** Company Stage 8 medal shortlist — Newton, NIAT, Scaler only. */
const FLAT_CATALOG = Object.freeze([
  Object.freeze({
    id: 'newton',
    name: 'Newton School of Technology',
    medal: '🥇',
  }),
  Object.freeze({
    id: 'niat',
    name: 'NIAT',
    medal: '🥈',
  }),
  Object.freeze({
    id: 'scaler',
    name: 'Scaler',
    medal: '🥉',
  }),
]);

const WIDER_CATALOG_LINE =
  "Wider options people often ask about: Plaksha · Kalvium · Masters' Union · Krea · UPES · SRM AP.\n\nRun them through the same checklist before you decide.";

/** Soft optional line — company Stage 8 is medal list without partnership pitch. */
const DISCLOSURE = '';

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
    "From what you've shared...",
    'I think these colleges could be worth exploring:',
  ];
  for (const c of colleges) {
    lines.push(`${c.medal} ${c.name}`);
  }
  lines.push(
    'Each has a different learning style, so the right choice depends on your goals, budget, and interests.'
  );
  return lines.join('\n');
}

function looksLikeWiderAsk(text) {
  const t = String(text || '').toLowerCase();
  return /\bshow me all\b|\bfull list\b|\bother options\b|\bwhat are the other\b/.test(t);
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

  const colleges = orderCatalog(profile);
  const body = buildShortlistBody(profile, colleges);
  assertGuardrails(body);

  const shortlist = colleges.map((c) => ({
    id: c.id,
    name: c.name,
    medal: c.medal,
  }));
  const merged = mergeFlowV2Profile(profile, { shortlist });
  merged.shortlist = shortlist;

  const fit = require('./b9Fit');
  const next = fit.handleB9Entry(withMergedProfile(ctx, merged));
  return combineNodeResults([body], next);
}

function handleB8Reply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  if (looksLikeWiderAsk(text)) {
    assertGuardrails(WIDER_CATALOG_LINE);
    return {
      replyText: WIDER_CATALOG_LINE,
      replyParts: null,
      interactive: null,
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
  buildShortlistBody,
  FLAT_CATALOG,
  DISCLOSURE,
  WIDER_CATALOG_LINE,
  interestPhrase,
  priorityPhrase,
};
