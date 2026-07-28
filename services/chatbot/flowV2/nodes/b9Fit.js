'use strict';

/**
 * Flow V3 — B9 · FIT (was v2 B6 · The Case).
 *
 * Ask → narrow with reason → honest pass below threshold → B10.
 * Compare table only on tap.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { assertGuardrails } = require('../../../../constants/careerCounsellingFlowV2Guardrails');
const { advanceToB10 } = require('../flowV2NodeUtils');

/** Provisional honest-pass threshold (plan default). */
const HONEST_PASS_THRESHOLD = 0.45;

const FIT_ASK_BODY = 'Want me to narrow it down to the one that fits you best?';
const FIT_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_b9_yes', title: 'Yes, narrow it down' }),
  Object.freeze({ id: 'flowv2_b9_self', title: "I'll look them up myself" }),
]);

const SELF_LOOKUP_TEXT = [
  "Good — that's the right instinct 👍 Take the seven checks with you.",
  '',
  "If you want a second opinion after you've looked, I'm here.",
].join('\n');

const HONEST_PASS_TEXT = [
  "Being straight with you — from what you've shared, I'm not sure any of these three is the obvious fit. Your interests point somewhere our catalog doesn't cover well, and I'd rather say that than talk you into one.",
  '',
  'The seven checks above still work on whatever you\'re considering.',
  '',
  "If it'd help, I can put you in front of a counsellor who'll talk through the options that *do* fit — including ones we have nothing to do with.",
].join('\n');

const COMPARE_TABLE = [
  "Here's how the three stack up on what you care about 👇",
  '',
  'Factor           NIAT    Scaler   Newton',
  'Placements       ●●●     ●●●      ●●●',
  'AI focus         ●●●     ●●●      ●●',
  'Projects         ●●●     ●●●      ●●●',
  'Mentorship       ●●●     ●●●      ●●',
].join('\n');

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

/**
 * Lightweight fit scorer — spreads across catalog based on priority + cluster.
 * Returns { id, name, score, reason }.
 */
function scoreFit(profile) {
  const shortlist = Array.isArray(profile?.shortlist) && profile.shortlist.length
    ? profile.shortlist
    : [
        { id: 'newton', name: 'Newton School of Technology' },
        { id: 'niat', name: 'NIAT' },
        { id: 'scaler', name: 'Scaler School of Technology' },
      ];

  const primary = String((profile?.goalPriority && profile.goalPriority[0]) || '').toLowerCase();
  const cluster = String(profile?.interestCluster || '').toLowerCase();
  const interests = (Array.isArray(profile?.interests) ? profile.interests : []).map((x) =>
    String(x).toLowerCase()
  );

  const scores = shortlist.map((c) => {
    let score = 0.5;
    const id = String(c.id || '').toLowerCase();

    if (cluster === 'data_ai' || interests.some((i) => i.includes('ai') || i.includes('data'))) {
      if (id === 'niat') score += 0.25;
      if (id === 'scaler') score += 0.15;
      if (id === 'newton') score += 0.1;
    } else if (cluster === 'infra_security') {
      if (id === 'scaler') score += 0.2;
      if (id === 'niat') score += 0.15;
      if (id === 'newton') score += 0.1;
    } else if (cluster === 'software' || cluster === 'core') {
      if (id === 'newton') score += 0.2;
      if (id === 'niat') score += 0.18;
      if (id === 'scaler') score += 0.15;
    }

    if (primary.includes('placement')) {
      if (id === 'niat') score += 0.12;
      if (id === 'scaler') score += 0.1;
    }
    if (primary.includes('fee') || primary.includes('afford')) {
      if (id === 'newton') score += 0.08;
      score -= 0.05; // fees are a weak catalog signal overall
    }
    if (primary.includes('ai') || primary.includes('future')) {
      if (id === 'niat') score += 0.2;
    }
    if (profile?.coreInterest) {
      if (id === 'niat') score += 0.1;
      if (id === 'newton') score += 0.08;
    }
    if (cluster === 'undecided' && !primary) {
      score -= 0.15;
    }

    let reason = 'it lines up with how you described learning and outcomes';
    if (id === 'niat') {
      reason =
        primary.includes('ai') || cluster === 'data_ai'
          ? 'its AI-first path matches what you said you care about'
          : 'its industry-integrated learning matches your priorities';
    } else if (id === 'newton') {
      reason = 'project work early matches how you want to learn';
    } else if (id === 'scaler') {
      reason = 'mentorship and career scope match what you highlighted';
    }

    return {
      id: c.id,
      name: c.name || c.id,
      score: Math.min(1, Math.max(0, score)),
      reason,
    };
  });

  scores.sort((a, b) => b.score - a.score);
  return scores[0];
}

function buildFitAnswer(profile, best) {
  const coreLine = profile?.coreInterest
    ? `\nAnd given you came in via ${String(profile.coreInterest)}, this path still lets you aim that at robotics, automation or EV if you want.\n`
    : '\n';

  const weak =
    !profile?.goalPriority?.length || profile?.interestCluster === 'undecided'
      ? '\nSome profile signals are still thin — treat this as decision support, not certainty.\n'
      : '';

  return [
    'Sure 😊',
    '',
    `You said ${priorityPhrase(profile)} matters most, and you're interested in ${interestPhrase(profile)}. On that specific basis, I'd look at *${best.name}* first — ${best.reason}.`,
    coreLine.trimEnd(),
    '',
    "That's my read from four answers, though. It's not a verdict. The other two may suit you better once someone's seen your marks, your budget and where you can actually study.",
    '',
    'Which is exactly what the next step is for.',
    weak.trimEnd(),
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n')
    .trim();
}

function looksLikeYes(text) {
  const t = String(text || '').toLowerCase();
  return (
    t.includes('flowv2_b9_yes') ||
    t.includes('yes, narrow') ||
    t === 'yes' ||
    t.includes('narrow it')
  );
}

function looksLikeSelf(text) {
  const t = String(text || '').toLowerCase();
  return (
    t.includes('flowv2_b9_self') ||
    t.includes('look them up') ||
    t.includes("i'll look") ||
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
    if (name && t.includes(name.split(' ')[0])) return c;
  }
  if (/\bniat\b/.test(t)) return { id: 'niat', name: 'NIAT' };
  if (/\bnewton\b/.test(t)) return { id: 'newton', name: 'Newton School of Technology' };
  if (/\bscaler\b/.test(t)) return { id: 'scaler', name: 'Scaler School of Technology' };
  return null;
}

function deliverFit(ctx, profile, forcedCollege = null) {
  const best = forcedCollege
    ? {
        ...scoreFit({ ...profile, shortlist: [forcedCollege, ...(profile.shortlist || [])] }),
        id: forcedCollege.id,
        name: forcedCollege.name,
      }
    : scoreFit(profile);

  if (!best || best.score < HONEST_PASS_THRESHOLD) {
    const merged = mergeFlowV2Profile(profile, {
      honestPassFired: true,
      fitCollege: null,
      recommendation: null,
    });
    assertGuardrails(HONEST_PASS_TEXT);
    return advanceToB10(merged, HONEST_PASS_TEXT);
  }

  const body = buildFitAnswer(profile, best);
  assertGuardrails(body);
  const merged = mergeFlowV2Profile(profile, {
    fitCollege: best.id,
    fitReason: best.reason,
    recommendation: best.id,
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
  if (named && !looksLikeSelf(text)) {
    return deliverFit(ctx, profile, named);
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
    return deliverFit(ctx, profile);
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
  scoreFit,
  buildFitAnswer,
  HONEST_PASS_THRESHOLD,
  FIT_ASK_BODY,
  HONEST_PASS_TEXT,
  COMPARE_TABLE,
};
