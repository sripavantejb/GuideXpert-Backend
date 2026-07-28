'use strict';

const { mergeFlowV2Profile } = require('./flowV2ProfileMerge');

const I1_ROWS = Object.freeze([
  Object.freeze({ id: 'flowv2_i1_building', title: 'Building things' }),
  Object.freeze({ id: 'flowv2_i1_people', title: 'Working with people' }),
  Object.freeze({ id: 'flowv2_i1_numbers', title: 'Numbers & analysis' }),
]);

const I2_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_i2_focus_under_2l', title: 'Focus under ₹2L' }),
  Object.freeze({ id: 'flowv2_i2_show_range', title: 'Show me a range' }),
]);

const I1_PATTERN = /\b(not sure|unsure|i do not know|i don'?t know|no idea)\b/i;
const I2_PATTERN =
  /\b(can'?t afford|cannot afford|can not afford|too expensive|money (is )?(a )?problem|financial(ly)? (worried|difficult|struggling)|we don'?t have much money|very low budget)\b/i;
const I9_PATTERN =
  /\b(i('?ve| have)? never (coded|done coding)|no coding experience|don'?t know (how to )?code|coding (scares|worries) me|beginner at coding)\b/i;

function result({ replyText = null, interactive = null, stage, profile, interruptedStage = null }) {
  return {
    replyText,
    replyParts: null,
    interactive,
    contextPatch: { stage, profile, interruptedStage },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function detectNonDistressInterrupt(text, stage) {
  const value = String(text || '');
  if ((stage === 'b1_awaiting_reply' || stage === 'b2_awaiting_reply') && I1_PATTERN.test(value)) return 'I-1';
  if (I2_PATTERN.test(value)) return 'I-2';
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

  return null;
}

module.exports = {
  detectNonDistressInterrupt,
  startNonDistressInterrupt,
  handlePendingInterrupt,
  resolveI1Choice,
  I1_ROWS,
  I2_BUTTONS,
};
