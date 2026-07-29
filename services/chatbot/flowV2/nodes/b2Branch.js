'use strict';

/**
 * Flow V3 — B3 · INTEREST (was v2 B2 · Branch).
 *
 * WhatsApp LIST multi-select (cap 4):
 *  - Row titles ≤24 chars, section title short (reply bubbles echo it)
 *  - After the first pick, list includes a tappable "I'm done ✓" row
 *    (students almost never type "done")
 *  - At 4 picks, auto-advance — never loop the same ask forever
 *  - Core → B3.2 fork; Undecided advances once (no loop)
 */

const { extractFlowV2Slots } = require('../flowV2SlotExtractor');
const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { withMergedProfile, advanceToB4 } = require('../flowV2NodeUtils');
const { handleR11 } = require('../router/handlers/r11Handler');
const { handleCoreForkEntry } = require('./b2CoreFork');

const INTEREST_CAP = 4;
const WA_LIST_TITLE_MAX = 24;
const WA_LIST_DESC_MAX = 72;
const WA_LIST_SECTION_MAX = 24;

const DONE_ROW = Object.freeze({
  id: 'flowv2_b3_done',
  title: "I'm done ✓",
  description: 'Continue with my picks',
});

/** Spec options — titles clipped to WhatsApp list limits; detail in description. */
const B2_ROWS = Object.freeze([
  Object.freeze({
    id: 'flowv2_b3_computers',
    title: 'Computers & software',
    description: 'Coding, software, IT',
    label: 'computers_software',
  }),
  Object.freeze({
    id: 'flowv2_b3_ai',
    title: 'Artificial Intelligence',
    description: 'AI / ML paths',
    label: 'artificial_intelligence',
  }),
  Object.freeze({
    id: 'flowv2_b3_data',
    title: 'Data Science',
    description: 'Data & analytics',
    label: 'data_science',
  }),
  Object.freeze({
    id: 'flowv2_b3_cloud',
    title: 'Cloud Computing',
    description: 'Cloud & infra',
    label: 'cloud_computing',
  }),
  Object.freeze({
    id: 'flowv2_b3_cyber',
    title: 'Cyber Security',
    description: 'Security & networks',
    label: 'cyber_security',
  }),
  Object.freeze({
    id: 'flowv2_b3_app',
    title: 'App Development',
    description: 'Mobile apps',
    label: 'app_development',
  }),
  Object.freeze({
    id: 'flowv2_b3_web',
    title: 'Web Development',
    description: 'Web & full-stack',
    label: 'web_development',
  }),
  Object.freeze({
    id: 'flowv2_b3_game',
    title: 'Game Development',
    description: 'Games & interactive',
    label: 'game_development',
  }),
  Object.freeze({
    id: 'flowv2_b3_core',
    title: 'Core engineering',
    description: 'Mech / Civil / ECE / EEE',
    label: 'core_engineering',
    isCore: true,
  }),
  Object.freeze({
    id: 'flowv2_b3_unsure',
    title: 'Not sure yet',
    description: 'Help me figure it out',
    label: 'undecided',
    isUndecided: true,
  }),
]);

// Short section title — only shown inside the opened list picker.
// Card header is suppressed (title: '') so the body asks directly.
const B2_LIST_SECTION_TITLE = 'Options';
const B2_LIST_BUTTON_TEXT = 'Select';

const B2_QUESTION =
  'Good — that helps.\n\nWhich of these actually interest you?\nPick as many as you like (up to 4).';
const B2_REASK_BODY =
  'Noted 👍 Tap more if you want — or tap *I\'m done ✓* when you\'re finished.';
const B2_CAP_BODY = "That's a solid set — continuing with what you've picked.";

/** @deprecated alias — tests / change-slot menus */
const B2_QUESTION_LEGACY = 'Which field pulls you?';

const INTEREST_DEFS = Object.freeze(
  B2_ROWS.map((row) => {
    const cluster =
      row.label === 'undecided'
        ? 'undecided'
        : row.isCore
          ? 'core'
          : row.label === 'artificial_intelligence' || row.label === 'data_science'
            ? 'data_ai'
            : row.label === 'cloud_computing' || row.label === 'cyber_security'
              ? 'infra_security'
              : 'software';
    const branch =
      row.isUndecided || row.label === 'undecided'
        ? null
        : row.isCore
          ? 'mechanical'
          : row.label === 'data_science'
            ? 'data_analytics'
            : 'cse_ai';
    return Object.freeze({
      id: row.id.replace('flowv2_b3_', ''),
      rowId: row.id,
      title: row.title,
      label: row.label,
      cluster,
      branch,
      isCore: Boolean(row.isCore),
      isUndecided: Boolean(row.isUndecided),
      re: new RegExp(
        `${escapeRe(row.id)}|${escapeRe(row.title)}|\\b${escapeRe(row.label.replace(/_/g, ' '))}\\b`,
        'i'
      ),
    });
  })
);

function escapeRe(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function clip(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function toWaRow(row) {
  const out = {
    id: row.id,
    title: clip(row.title, WA_LIST_TITLE_MAX),
  };
  if (row.description) out.description = clip(row.description, WA_LIST_DESC_MAX);
  return out;
}

/**
 * Initial ask: all 10 interest rows.
 * Follow-up (≥1 pick): Done first, then remaining unselected interests.
 */
function buildInterestRows(selectedLabels = []) {
  const selected = new Set(selectedLabels || []);
  if (selected.size === 0) {
    return B2_ROWS.map(toWaRow);
  }

  const remaining = B2_ROWS.filter((row) => {
    if (selected.has(row.label)) return false;
    // Once they have a real interest, drop "Not sure yet".
    if (row.isUndecided) return false;
    return true;
  }).map(toWaRow);

  return [toWaRow(DONE_ROW), ...remaining].slice(0, 10);
}

function buildB2ListInteractive(body, selectedLabels = []) {
  return {
    type: 'list',
    title: '',
    body,
    buttonText: B2_LIST_BUTTON_TEXT,
    sections: [
      {
        title: clip(B2_LIST_SECTION_TITLE, WA_LIST_SECTION_MAX),
        rows: buildInterestRows(selectedLabels),
      },
    ],
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
  if (!t) return null;
  // Prefer exact id / title hits first (list postbacks).
  for (const def of INTEREST_DEFS) {
    if (t === def.rowId || t.toLowerCase() === def.title.toLowerCase()) return def;
  }
  for (const def of INTEREST_DEFS) {
    if (def.re.test(t)) return def;
  }
  // Truncated WhatsApp titles / aliases
  if (/\bcore engineering\b/i.test(t) || /\bmech\b.*\bcivil\b/i.test(t)) {
    return INTEREST_DEFS.find((d) => d.isCore) || null;
  }
  if (/\bnot sure\b/i.test(t) || /help me figure/i.test(t)) {
    return INTEREST_DEFS.find((d) => d.isUndecided) || null;
  }
  if (/\bcomputers?\b|\bsoftware\b|coding \/ software/i.test(t)) {
    return INTEREST_DEFS.find((d) => d.label === 'computers_software') || null;
  }
  return null;
}

function looksLikeDone(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (t === 'flowv2_b3_done' || t === DONE_ROW.id.toLowerCase()) return true;
  if (t === "i'm done ✓" || t === "i'm done" || t === 'im done' || t === 'done' || t === 'done.') {
    return true;
  }
  return /\bi'?m done\b|\bdone\b/.test(t) && !/\bnot sure\b/.test(t);
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
  const selected = Array.isArray(mergedProfile.interests) ? mergedProfile.interests : [];
  return {
    replyText: null,
    replyParts: null,
    interactive: buildB2ListInteractive(body, selected),
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
    interactive: buildB2ListInteractive(B2_QUESTION, []),
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
      return finalizeInterests(ctx, profile, ['undecided'], {});
    }
    return finalizeInterests(ctx, profile, existing, freePatch);
  }

  const matched = matchInterest(text);

  if (!matched) {
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
    // Unrecognised — re-show list with Done if they already picked something.
    const body = existing.length ? B2_REASK_BODY : B2_QUESTION;
    return continueMultiSelect(mergeFlowV2Profile(profile, freePatch), body);
  }

  if (matched.isUndecided && existing.length === 0) {
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
    interestCluster: deriveCluster(
      interests,
      INTEREST_DEFS.filter((d) => interests.includes(d.label))
    ),
  });

  // Cap reached → advance immediately (no more looping).
  if (interests.length >= INTEREST_CAP) {
    return finalizeInterests(ctx, merged, interests, {});
  }

  return continueMultiSelect(merged, B2_REASK_BODY);
}

module.exports = {
  handleB2Entry,
  handleB2Reply,
  isCoreEngineeringBranch,
  isBusinessBranch,
  branchAckLine,
  buildB2ListInteractive,
  buildInterestRows,
  B2_ROWS,
  DONE_ROW,
  B2_QUESTION,
  B2_REASK_BODY,
  B2_QUESTION_LEGACY,
  B2_LIST_SECTION_TITLE,
  B2_LIST_BUTTON_TEXT,
  INTEREST_CAP,
  matchInterest,
  looksLikeDone,
};
