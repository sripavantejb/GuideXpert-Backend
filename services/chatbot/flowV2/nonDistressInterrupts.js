'use strict';

const { mergeFlowV2Profile } = require('./flowV2ProfileMerge');
const { buildSilenceNudge, canSendNudge } = require('./router/handlers/r13Handler');

const I1_ROWS = Object.freeze([
  Object.freeze({ id: 'flowv2_i1_building', title: 'Building things' }),
  Object.freeze({ id: 'flowv2_i1_people', title: 'Working with people' }),
  Object.freeze({ id: 'flowv2_i1_numbers', title: 'Numbers & analysis' }),
]);

const I2_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_i2_focus_under_2l', title: 'Focus under ₹2L' }),
  Object.freeze({ id: 'flowv2_i2_show_range', title: 'Show me a range' }),
]);

const I3_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_i3_nearby', title: 'Nearby' }),
  Object.freeze({ id: 'flowv2_i3_brand', title: 'Known brand' }),
  Object.freeze({ id: 'flowv2_i3_my_call', title: 'My call' }),
]);

const I6_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_i6_book', title: 'Book a session' }),
  Object.freeze({ id: 'flowv2_i6_tech', title: 'Tell me about tech' }),
]);

const I1_PATTERN = /\b(not sure|unsure|i do not know|i don'?t know|no idea)\b/i;
const I2_PATTERN =
  /\b(can'?t afford|cannot afford|can not afford|too expensive|money (is )?(a )?problem|financial(ly)? (worried|difficult|struggling)|we don'?t have much money|very low budget)\b/i;
const I3_PATTERN =
  /\b(parents?|family|mom|dad|mother|father)\b.{0,40}\b(want|think|say|prefer|lean|pressure|insist)\b|\bwhat (will|do) (my )?parents?\b/i;
const I4_PATTERN =
  /\b(i'?m worried about|my (biggest )?concern is|worried about (fees|placement|hostel|ragging|coding|distance))\b/i;
const I5_PATTERN =
  /\b(not sure (if|about)|still hesitating|second thoughts|doubt(ing)?|what if i (fail|regret))\b/i;
const I6_PATTERN =
  /\b(mbbs|neet|law college|llb|mba abroad|fashion design|hotel management|agriculture college)\b/i;
const I7_PATTERN =
  /\b(how much (does|is) (this|the) (cost|session|chat|counselling)|is the session (free|paid)|what('?s| is) the (price|fee) for (the )?session)\b/i;
const I9_PATTERN =
  /\b(i('?ve| have)? never (coded|done coding)|no coding experience|don'?t know (how to )?code|coding (scares|worries) me|beginner at coding)\b/i;

function result({ replyText = null, interactive = null, stage, profile, interruptedStage = null, extras = {} }) {
  return {
    replyText,
    replyParts: null,
    interactive,
    contextPatch: { stage, profile, interruptedStage, ...extras },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function detectNonDistressInterrupt(text, stage) {
  const value = String(text || '');
  if ((stage === 'b1_awaiting_reply' || stage === 'b2_awaiting_reply') && I1_PATTERN.test(value)) return 'I-1';
  if (I2_PATTERN.test(value)) return 'I-2';
  if (I3_PATTERN.test(value)) return 'I-3';
  if (I4_PATTERN.test(value)) return 'I-4';
  if (I5_PATTERN.test(value)) return 'I-5';
  if (I6_PATTERN.test(value)) return 'I-6';
  if (I7_PATTERN.test(value)) return 'I-7';
  if (I9_PATTERN.test(value)) return 'I-9';
  return null;
}

function startNonDistressInterrupt(ctx, interruptId) {
  const stage = ctx?.flowV2?.stage || null;
  const profile = ctx?.flowV2?.profile || {};

  if (interruptId === 'I-1') {
    return result({
      interactive: {
        type: 'list',
        body: "Totally normal. Let's narrow it a different way — which sounds more like you?",
        buttonText: 'Select',
        sections: [{ title: 'Which sounds like you?', rows: I1_ROWS }],
      },
      stage: 'interrupt_i1_awaiting_reply',
      profile,
      interruptedStage: stage,
    });
  }

  if (interruptId === 'I-2') {
    return result({
      interactive: {
        type: 'button',
        body:
          'Completely fair — no pressure at all. There are strong project-based colleges under ₹2L, and several give scholarships. Want me to focus there?',
        buttons: I2_BUTTONS,
      },
      stage: 'interrupt_i2_awaiting_reply',
      profile,
      interruptedStage: stage,
    });
  }

  if (interruptId === 'I-3') {
    return result({
      interactive: {
        type: 'button',
        body: 'What do your parents lean toward — staying nearby, a known brand, or are they backing your call?',
        buttons: I3_BUTTONS,
      },
      stage: 'interrupt_i3_awaiting_reply',
      profile,
      interruptedStage: stage,
    });
  }

  if (interruptId === 'I-4') {
    return result({
      interactive: {
        type: 'button',
        body:
          "Got it — that's a real concern, and it's fair to raise it. Exact numbers and campus specifics are what the 1-on-1 covers with current data. Does that help for now?",
        buttons: [
          { id: 'flowv2_i4_yes', title: 'Yes' },
          { id: 'flowv2_i4_no', title: 'No' },
        ],
      },
      stage: 'interrupt_i4_awaiting_reply',
      profile: mergeFlowV2Profile(profile, { concerns: ['volunteered'] }),
      interruptedStage: stage,
    });
  }

  if (interruptId === 'I-5') {
    return result({
      replyText:
        "Totally normal to hesitate — big decisions feel that way. We don't have to force a pick today; we can keep the shortlist practical and leave room to think.",
      stage,
      profile: mergeFlowV2Profile(profile, { hesitations: ['volunteered'] }),
      interruptedStage: null,
    });
  }

  if (interruptId === 'I-6') {
    return result({
      interactive: {
        type: 'button',
        // DEFAULTED PENDING BUSINESS CONFIRMATION — Assumption 2 / medical·law·MBA scope · ENGINEERING_TECH_SCOPE_ONLY
        body:
          "Honest answer — my depth is engineering and tech in India. Our counsellors do cover this — want me to book you with the right person?",
        buttons: I6_BUTTONS,
      },
      stage: 'interrupt_i6_awaiting_reply',
      profile: mergeFlowV2Profile(profile, { outOfScope: true }),
      interruptedStage: stage,
    });
  }

  if (interruptId === 'I-7') {
    return result({
      // DEFAULTED PENDING BUSINESS CONFIRMATION — Assumption 1 / Part 18 · FREE_SESSION
      replyText:
        'This chat is completely free, and so is the 1-on-1 session. Nothing to pay at any point here.',
      stage,
      profile,
      interruptedStage: null,
    });
  }

  // I-9 inline reassurance — no pending stage.
  return result({
    replyText: 'Not a problem — the good programs assume zero coding and teach from scratch with mentors.',
    stage,
    profile,
    interruptedStage: null,
  });
}

function resolveI1Choice(text, interruptedStage) {
  const value = String(text || '');
  const building = /\bbuilding things\b/i.test(value);
  const people = /\bworking with people\b/i.test(value);
  const numbers = /\bnumbers?\s*(and|&)\s*analysis\b/i.test(value);
  if (!building && !people && !numbers) return null;

  if (interruptedStage === 'b1_awaiting_reply') {
    if (building) return { resumeText: 'Startup / entrepreneurship', confirmation: 'Building things — that points toward an entrepreneurship-first filter.' };
    if (people) return { resumeText: 'Strong placements', confirmation: 'Working with people — I’ll use outcomes and opportunities as the first filter.' };
    return { resumeText: 'AI & future tech', confirmation: 'Numbers and analysis — that points toward a more technical, future-facing filter.' };
  }

  if (building) return { resumeText: 'Coding / software / AI', confirmation: 'Building things — coding and software is the strongest starting fit.' };
  if (people) return { resumeText: 'Design / product', confirmation: 'Working with people — product and design is the closest starting fit.' };
  return { resumeText: 'Data / analytics', confirmation: 'Numbers and analysis — data and analytics is the clearest starting fit.' };
}

function handlePendingInterrupt(ctx, text) {
  const stage = ctx?.flowV2?.stage;
  const profile = ctx?.flowV2?.profile || {};
  const interruptedStage = ctx?.flowV2?.interruptedStage || null;

  if (stage === 'interrupt_i1_awaiting_reply') {
    const resolved = resolveI1Choice(text, interruptedStage);
    if (!resolved) return startNonDistressInterrupt({ flowV2: { stage: interruptedStage, profile } }, 'I-1');
    return { interruptResolved: true, interruptedStage, ...resolved, profile };
  }

  if (stage === 'interrupt_i2_awaiting_reply') {
    const focusUnder2L = /\bfocus under\s*₹?\s*2l\b|\byes\b/i.test(String(text || ''));
    const showRange = /\bshow me a range\b|\bno\b/i.test(String(text || ''));
    if (!focusUnder2L && !showRange) {
      return startNonDistressInterrupt({ flowV2: { stage: interruptedStage, profile } }, 'I-2');
    }
    const mergedProfile = focusUnder2L
      ? mergeFlowV2Profile(profile, { budgetBand: 'under_2l', scholarshipFlag: true })
      : profile;
    return result({
      replyText: focusUnder2L
        ? 'Absolutely — I’ll keep the options practical and focus under ₹2L. Let’s continue where we left off.'
        : 'Of course — I’ll keep a range and we can narrow it later. Let’s continue where we left off.',
      stage: interruptedStage,
      profile: mergedProfile,
      interruptedStage: null,
    });
  }

  if (stage === 'interrupt_i3_awaiting_reply') {
    const t = String(text || '').toLowerCase();
    let parentConstraints = null;
    if (/\bnearby\b/.test(t)) parentConstraints = 'nearby';
    else if (/\bknown brand\b|\bbrand\b/.test(t)) parentConstraints = 'known_brand';
    else if (/\bmy call\b|\bmy decision\b/.test(t)) parentConstraints = 'student_call';
    if (!parentConstraints) {
      return startNonDistressInterrupt({ flowV2: { stage: interruptedStage, profile } }, 'I-3');
    }
    return result({
      replyText: 'Got it — I’ll keep that in mind as we shortlist.',
      stage: interruptedStage,
      profile: mergeFlowV2Profile(profile, { parentConstraints }),
      interruptedStage: null,
    });
  }

  if (stage === 'interrupt_i4_awaiting_reply') {
    return result({
      replyText: /\byes\b/i.test(String(text || ''))
        ? 'Good — let’s keep going from where we left off.'
        : 'Fair — we can dig into it more in the 1-on-1. For now, let’s continue.',
      stage: interruptedStage,
      profile,
      interruptedStage: null,
    });
  }

  if (stage === 'interrupt_i6_awaiting_reply') {
    const t = String(text || '');
    if (/\bbook a session\b|\bbook\b/i.test(t)) {
      return result({
        replyText: null,
        interactive: null,
        stage: 'b7_awaiting_entry',
        profile,
        interruptedStage: null,
      });
    }
    return result({
      replyText: 'Happy to stay with tech — let’s keep building your shortlist.',
      stage: interruptedStage || 'b1_awaiting_reply',
      profile: mergeFlowV2Profile(profile, { outOfScope: false }),
      interruptedStage: null,
    });
  }

  return null;
}

/**
 * I-8 — 24h silence mid-flow. Uses the same global nudgeSent gate as R13.
 */
function tryI8SilenceNudge(ctx, silenceMs) {
  const profile = ctx?.flowV2?.profile || {};
  const stage = ctx?.flowV2?.stage || null;
  if (!canSendNudge(profile, stage)) return null;
  return buildSilenceNudge({ profile, stage, silenceMs, name: profile.name });
}

module.exports = {
  detectNonDistressInterrupt,
  startNonDistressInterrupt,
  handlePendingInterrupt,
  resolveI1Choice,
  tryI8SilenceNudge,
  I1_ROWS,
  I2_BUTTONS,
  I3_BUTTONS,
  I6_BUTTONS,
};
