'use strict';

/**
 * Flow V3 — B3 · INTEREST (was v2 B2 · Branch).
 *
 * 10-row multi-select (cap 4). "done" finishes. Core → B3.2 fork.
 * Undecided is a legitimate answer (no default branch).
 */

const { extractFlowV2Slots } = require('../flowV2SlotExtractor');
const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { withMergedProfile, advanceToB4 } = require('../flowV2NodeUtils');
const { handleR11 } = require('../router/handlers/r11Handler');
const { handleCoreForkEntry } = require('./b2CoreFork');

const INTEREST_CAP = 4;

const B2_ROWS = Object.freeze([
  Object.freeze({ id: 'flowv2_b3_computers', title: 'Computers & software' }),
  Object.freeze({ id: 'flowv2_b3_ai', title: 'Artificial Intelligence' }),
  Object.freeze({ id: 'flowv2_b3_data', title: 'Data Science' }),
  Object.freeze({ id: 'flowv2_b3_cloud', title: 'Cloud Computing' }),
  Object.freeze({ id: 'flowv2_b3_cyber', title: 'Cyber Security' }),
  Object.freeze({ id: 'flowv2_b3_app', title: 'App Development' }),
  Object.freeze({ id: 'flowv2_b3_web', title: 'Web Development' }),
  Object.freeze({ id: 'flowv2_b3_game', title: 'Game Development' }),
  Object.freeze({ id: 'flowv2_b3_core', title: 'Core engineering (Mech / Civil / ECE / EEE)' }),
  Object.freeze({ id: 'flowv2_b3_unsure', title: 'Not sure yet — help me figure it out' }),
]);

const B2_LIST_SECTION_TITLE = 'Tap one, then tap more if you want';
const B2_LIST_BUTTON_TEXT = 'Pick your interests';

const B2_QUESTION =
  'Good — that helps.\n\nWhich of these actually interest you? Pick as many as you like.';
const B2_REASK_BODY = 'Noted 👍 Tap any others, or send "done" when you\'re finished.';
const B2_CAP_BODY =
  "That's plenty — four is the useful max. Send \"done\" when you're ready, or tap done.";

/** @deprecated alias — tests / change-slot menus */
const B2_QUESTION_LEGACY = 'Which field pulls you?';

const INTEREST_DEFS = Object.freeze([
  Object.freeze({
    id: 'computers',
    re: /\bcomputers?\b|\bsoftware\b|flowv2_b3_computers|coding \/ software/i,
    label: 'computers_software',
    cluster: 'software',
    branch: 'cse_ai',
  }),
  Object.freeze({
    id: 'ai',
    re: /\bartificial intelligence\b|flowv2_b3_ai|^ai$/i,
    label: 'artificial_intelligence',
    cluster: 'data_ai',
    branch: 'cse_ai',
  }),
  Object.freeze({
    id: 'data',
    re: /\bdata science\b|\bdata \/ analytics\b|flowv2_b3_data/i,
    label: 'data_science',
    cluster: 'data_ai',
    branch: 'data_analytics',
  }),
  Object.freeze({
    id: 'cloud',
    re: /\bcloud computing\b|flowv2_b3_cloud/i,
    label: 'cloud_computing',
    cluster: 'infra_security',
    branch: 'cse_ai',
  }),
  Object.freeze({
    id: 'cyber',
    re: /\bcyber security\b|flowv2_b3_cyber/i,
    label: 'cyber_security',
    cluster: 'infra_security',
    branch: 'cse_ai',
  }),
  Object.freeze({
    id: 'app',
    re: /\bapp development\b|flowv2_b3_app/i,
    label: 'app_development',
    cluster: 'software',
    branch: 'cse_ai',
  }),
  Object.freeze({
    id: 'web',
    re: /\bweb development\b|flowv2_b3_web/i,
    label: 'web_development',
    cluster: 'software',
    branch: 'cse_ai',
  }),
  Object.freeze({
    id: 'game',
    re: /\bgame development\b|flowv2_b3_game/i,
    label: 'game_development',
    cluster: 'software',
    branch: 'cse_ai',
  }),
  Object.freeze({
    id: 'core',
    re: /\bcore engineering\b|flowv2_b3_core/i,
    label: 'core_engineering',
    cluster: 'core',
    branch: 'mechanical',
    isCore: true,
  }),
  Object.freeze({
    id: 'unsure',
    re: /\bnot sure yet\b|help me figure it out|flowv2_b3_unsure/i,
    label: 'undecided',
    cluster: 'undecided',
    branch: null,
    isUndecided: true,
  }),
]);

const BUSINESS_BRANCH_VALUES = Object.freeze(['business/commerce', 'business', 'mba', 'bba']);
function isBusinessBranch(branchInterest) {
  if (!branchInterest) return false;
  return BUSINESS_BRANCH_VALUES.includes(String(branchInterest).toLowerCase());
}

const CORE_ENGINEERING_BRANCH_VALUES = Object.freeze(['mechanical', 'civil', 'ece', 'eee', 'core']);
function isCoreEngineeringBranch(branchInterest) {
  if (!branchInterest) return false;
  return CORE_ENGINEERING_BRANCH_VALUES.includes(String(branchInterest).toLowerCase());
}

function isBranchFilled(branchInterest) {
  return typeof branchInterest === 'string' && branchInterest.length > 0;
}

function hasInterests(profile) {
  return Array.isArray(profile?.interests) && profile.interests.length > 0;
}

function outOfScopeWithProfile(mergedProfile) {
  const result = handleR11();
  return { ...result, contextPatch: { ...result.contextPatch, profile: mergedProfile } };
}

function buildB2ListInteractive(body) {
  return {
    type: 'list',
    body,
    buttonText: B2_LIST_BUTTON_TEXT,
    sections: [{ title: B2_LIST_SECTION_TITLE, rows: B2_ROWS }],
  };
}

function branchAckLine(branchInterest) {
  const b = String(branchInterest || '').toLowerCase();
  if (b === 'cse_ai' || b === 'cse' || b === 'it') {
    return "Solid — and it's the most flexible base you can pick right now.";
  }
  if (b === 'design') return 'Good — design plus tech is a genuinely strong combination right now.';
  if (b === 'data_analytics') return 'Good pick — that sits right next to AI.';
  return 'Got it, noted.';
}

function matchInterest(text) {
  const t = String(text || '').trim();
  for (const def of INTEREST_DEFS) {
    if (def.re.test(t)) return def;
  }
  return null;
}

function deriveCluster(interests, defsHit) {
  if (defsHit.some((d) => d.isUndecided)) return 'undecided';
  if (defsHit.some((d) => d.isCore)) return 'core';
  const clusters = defsHit.map((d) => d.cluster).filter(Boolean);
  if (clusters.includes('data_ai')) return 'data_ai';
  if (clusters.includes('infra_security')) return 'infra_security';
  if (clusters.includes('software')) return 'software';
  return clusters[0] || null;
}

function deriveBranch(defsHit) {
  if (defsHit.some((d) => d.isUndecided)) return null;
  if (defsHit.some((d) => d.isCore)) return 'mechanical';
  const withBranch = defsHit.find((d) => d.branch);
  return withBranch ? withBranch.branch : null;
}

function looksLikeDone(text) {
  const t = String(text || '').trim().toLowerCase();
  return t === 'done' || t === 'done.' || t === 'finish' || t === "i'm done" || t === 'im done';
}

function finalizeInterests(ctx, profile, interests, freePatch = {}) {
  const defsHit = INTEREST_DEFS.filter((d) => interests.includes(d.label));
  const interestCluster = deriveCluster(interests, defsHit);
  const branchInterest = deriveBranch(defsHit);

  const patch = {
    ...freePatch,
    interests,
    interestCluster,
  };
  if (branchInterest) patch.branchInterest = branchInterest;

  const mergedProfile = mergeFlowV2Profile(profile, patch);

  if (interestCluster === 'core' || (branchInterest && isCoreEngineeringBranch(branchInterest))) {
    return handleCoreForkEntry(withMergedProfile(ctx, mergedProfile));
  }
  if (branchInterest && isBusinessBranch(branchInterest)) {
    return outOfScopeWithProfile(mergedProfile);
  }

  const ack =
    interestCluster === 'undecided'
      ? "Totally fine — we'll figure the direction together."
      : branchAckLine(branchInterest || 'cse_ai');
  return advanceToB4(mergedProfile, ack);
}

function continueMultiSelect(mergedProfile, body) {
  return {
    replyText: null,
    replyParts: null,
    interactive: buildB2ListInteractive(body),
    contextPatch: { stage: 'b2_awaiting_reply', profile: mergedProfile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 */
function handleB2Entry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  if (profile.coreBridgeClosed === true) {
    return advanceToB4(profile, null);
  }

  // Skip if interests already captured OR branch known from R3/R4/ad.
  if (hasInterests(profile) || isBranchFilled(profile.branchInterest)) {
    if (isCoreEngineeringBranch(profile.branchInterest) && profile.coreBridgeAttempted !== true) {
      return handleCoreForkEntry(ctx);
    }
    if (isBusinessBranch(profile.branchInterest)) {
      return outOfScopeWithProfile(profile);
    }
    return advanceToB4(profile, null);
  }

  return {
    replyText: null,
    replyParts: null,
    interactive: buildB2ListInteractive(B2_QUESTION),
    contextPatch: { stage: 'b2_awaiting_reply', profile },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @param {string} text
 */
function handleB2Reply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const freePatch = extractFlowV2Slots(text, profile);
  const existing = Array.isArray(profile.interests) ? [...profile.interests] : [];

  if (looksLikeDone(text)) {
    if (existing.length === 0) {
      // Done with nothing selected — treat as undecided rather than looping forever.
      return finalizeInterests(ctx, profile, ['undecided'], freePatch);
    }
    return finalizeInterests(ctx, profile, existing, freePatch);
  }

  const matched = matchInterest(text);

  // Legacy single-select titles still work as first (and only) pick + auto-finish
  // when they map cleanly — except we keep multi-select for V3 rows.
  if (!matched) {
    // Fall back: extractor branchInterest (free text / legacy).
    if (freePatch.branchInterest) {
      if (isCoreEngineeringBranch(freePatch.branchInterest)) {
        const merged = mergeFlowV2Profile(profile, freePatch);
        return handleCoreForkEntry(withMergedProfile(ctx, merged));
      }
      if (isBusinessBranch(freePatch.branchInterest)) {
        return outOfScopeWithProfile(mergeFlowV2Profile(profile, freePatch));
      }
      const interests = existing.length
        ? existing
        : [String(freePatch.branchInterest).toLowerCase()];
      return finalizeInterests(ctx, profile, interests, freePatch);
    }
    return continueMultiSelect(mergeFlowV2Profile(profile, freePatch), B2_REASK_BODY);
  }

  if (matched.isUndecided && existing.length === 0) {
    // Do not merge free-text branch guesses ("figure it out" → IT).
    return finalizeInterests(ctx, profile, ['undecided'], {});
  }

  if (matched.isCore) {
    const interests = [...new Set([...existing, matched.label])].slice(0, INTEREST_CAP);
    return finalizeInterests(ctx, profile, interests, {
      ...freePatch,
      branchInterest: 'mechanical',
      coreInterest: freePatch.coreInterest || 'mechanical',
    });
  }

  let interests = [...existing];
  if (!interests.includes(matched.label)) {
    interests.push(matched.label);
  }
  interests = interests.slice(0, INTEREST_CAP);

  const merged = mergeFlowV2Profile(profile, {
    ...freePatch,
    interests,
    interestCluster: deriveCluster(interests, INTEREST_DEFS.filter((d) => interests.includes(d.label))),
  });

  if (interests.length >= INTEREST_CAP) {
    return continueMultiSelect(merged, B2_CAP_BODY);
  }

  // Multi-select: keep collecting until "done".
  return continueMultiSelect(merged, B2_REASK_BODY);
}

module.exports = {
  handleB2Entry,
  handleB2Reply,
  isCoreEngineeringBranch,
  isBusinessBranch,
  branchAckLine,
  buildB2ListInteractive,
  B2_ROWS,
  B2_QUESTION,
  B2_REASK_BODY,
  B2_QUESTION_LEGACY,
  INTEREST_CAP,
  matchInterest,
};
