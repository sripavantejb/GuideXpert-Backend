'use strict';

/**
 * Flow V3 — B8 · SHORTLIST (5 flat new-age + mandatory disclosure).
 *
 * DEFAULTED PENDING BUSINESS CONFIRMATION — ◆ DIFF-1 differentiator lines
 * are provisional until content fact-checks them.
 *
 * No medals / no Best Match tiers. Wider catalog on tap only.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { assertGuardrails } = require('../../../../constants/careerCounsellingFlowV2Guardrails');
const { withMergedProfile, combineNodeResults } = require('../flowV2NodeUtils');

/** DEFAULTED PENDING BUSINESS CONFIRMATION — ◆ DIFF-1 */
const FLAT_CATALOG = Object.freeze([
  Object.freeze({
    id: 'newton',
    name: 'Newton School of Technology',
    // DEFAULTED PENDING BUSINESS CONFIRMATION — ◆ DIFF-1
    differentiator:
      'four-year degree with project work from early semesters — strongest when you want applied building early',
  }),
  Object.freeze({
    id: 'niat',
    name: 'NIAT',
    // DEFAULTED PENDING BUSINESS CONFIRMATION — ◆ DIFF-1
    differentiator:
      'AI-first curriculum with industry-integrated learning — strongest when AI and software depth matter most',
  }),
  Object.freeze({
    id: 'scaler',
    name: 'Scaler School of Technology',
    // DEFAULTED PENDING BUSINESS CONFIRMATION — ◆ DIFF-1
    differentiator:
      'software engineering with industry mentorship emphasis — strongest when mentorship and career scope matter',
  }),
  Object.freeze({
    id: 'plaksha',
    name: 'Plaksha University',
    // DEFAULTED PENDING BUSINESS CONFIRMATION — ◆ DIFF-1
    differentiator:
      'interdisciplinary tech education with a research-leaning campus — strongest when breadth across tech domains matters',
  }),
  Object.freeze({
    id: 'kalvium',
    name: 'Kalvium',
    // DEFAULTED PENDING BUSINESS CONFIRMATION — ◆ DIFF-1
    differentiator:
      'work-integrated engineering model with early industry exposure — strongest when earning-while-learning structure matters',
  }),
]);

const WIDER_CATALOG_LINE =
  "Wider options people often ask about: Masters' Union · Krea · Ahmedabad Univ · UPES · SRM AP.\n\nSame caveat: these are colleges GuideXpert works with, so we know them well — and you should weigh that.";

const DISCLOSURE =
  "Straight up: these are colleges GuideXpert works with, so we know them well — and you should weigh that. Run all five through the seven checks above, and run any other college you're considering through the same list.\n\nThey're different from each other in learning style, fees and location, so the right one depends on you.";

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

function orderCatalog(profile) {
  const list = [...FLAT_CATALOG];
  const primary = String((profile?.goalPriority && profile.goalPriority[0]) || '').toLowerCase();
  if (primary === 'fees' || primary === 'affordable' || primary === 'fee') {
    return list.map((c) => ({
      ...c,
      differentiator: `${c.differentiator}; check full four-year cost before you decide`,
    }));
  }
  if (profile?.scholarshipFlag === true) {
    return list.map((c) => ({
      ...c,
      differentiator: `${c.differentiator}; ask scholarship criteria in writing`,
    }));
  }
  if (profile?.coreInterest) {
    return list.map((c) =>
      c.id === 'niat'
        ? {
            ...c,
            differentiator:
              'project-led CSE/AI path that can still use mechanical/automation instincts — strongest if you converted from core and want applied builds',
          }
        : c
    );
  }
  return list;
}

function buildShortlistBody(profile, colleges) {
  const lines = [
    `From what you've told me — ${interestPhrase(profile)}, and ${priorityPhrase(profile)} — these five are worth looking at:`,
    '',
  ];
  for (const c of colleges) {
    lines.push(`*${c.name}* — ${c.differentiator}`);
    lines.push('');
  }
  lines.push(DISCLOSURE);
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

  const shortlist = colleges.map((c) => ({ id: c.id, name: c.name, differentiator: c.differentiator }));
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
