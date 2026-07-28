'use strict';

/**
 * Flow v2 — Greeting / Node E (first live beat).
 *
 * `handleGreetingEntry` fires when `context.flowV2.stage` is falsy (first
 * turn). Master Flow: never ask for name — seed from profile/CRM if present,
 * open the 9-row stage list immediately, then entry side-tracks → B1.
 * Both are only ever invoked by `flowV2Dispatcher.processFlowV2Turn` — see
 * that file for the actual routing guarantee (this is the source of the
 * "never send the full greeting twice" contract, not node-file discipline
 * alone).
 */

const { extractFlowV2Slots, extractName } = require('../flowV2SlotExtractor');
const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { handleR11, OUT_OF_SCOPE_BUTTONS } = require('../router/handlers/r11Handler');
const { combineNodeResults, withMergedProfile } = require('../flowV2NodeUtils');
const { handleB1Entry } = require('./b1Goal');
const { handleB3Entry } = require('./b3Constraints');

const QUALIFICATION_ROWS = Object.freeze([
  // waTitle = Master Flow locked list labels (WhatsApp ≤24 chars).
  // title = canonical internal value used by routing / profile.
  Object.freeze({ id: 'flowv2_qual_10_completed', title: '10th Completed', waTitle: 'Class 10' }),
  Object.freeze({ id: 'flowv2_qual_11_studying', title: '11th Studying', waTitle: 'Class 11' }),
  Object.freeze({ id: 'flowv2_qual_12_pcm', title: '12th Completed (PCM)', waTitle: '12th — MPC' }),
  Object.freeze({ id: 'flowv2_qual_12_pcb', title: '12th Completed (PCB)', waTitle: '12th — BiPC' }),
  Object.freeze({
    id: 'flowv2_qual_12_commerce',
    title: '12th Completed (Commerce)',
    waTitle: '12th — MEC / CEC',
  }),
  Object.freeze({ id: 'flowv2_qual_diploma', title: 'Diploma', waTitle: 'Diploma' }),
  Object.freeze({ id: 'flowv2_qual_drop_year', title: 'Drop Year', waTitle: 'Dropper / gap year' }),
  Object.freeze({ id: 'flowv2_qual_degree', title: 'Degree', waTitle: 'Already in college' }),
  Object.freeze({ id: 'flowv2_qual_other', title: 'Other', waTitle: 'Something else' }),
]);

function findQualificationRow(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  return (
    QUALIFICATION_ROWS.find(
      (row) =>
        row.id.toLowerCase() === t ||
        row.title.toLowerCase() === t ||
        (row.waTitle && row.waTitle.toLowerCase() === t)
    ) || null
  );
}
const QUALIFICATION_LIST_SECTION_TITLE = 'Choose your stage';
const QUALIFICATION_LIST_BUTTON_TEXT = 'Select';
/** Master Flow Node E open — Rithika persona, never asks for name. */
const NEUTRAL_QUALIFICATION_LINE = 'First — where are you right now?';
const NAME_REASK = "Sorry, didn't catch that 😊 What should I call you?";

function buildNodeEOpenBody(firstName) {
  const hello = firstName ? `Hey ${firstName} 👋` : 'Hi 👋';
  return (
    `${hello}\n\n` +
    "I'm Rithika, from GuideXpert's counselling desk. We help students find a college that actually fits them — not just the ones with the biggest ads.\n\n" +
    "Takes about 2 minutes, and it's free.\n\n" +
    NEUTRAL_QUALIFICATION_LINE
  );
}

function buildNamedQualificationBody(firstName) {
  return buildNodeEOpenBody(firstName);
}

const UNKNOWN_NAME_GREETING = buildNodeEOpenBody(null);
const GUESS_CONFIRM_YES = Object.freeze({ id: 'flowv2_guess_confirm_yes', title: "Yes, that's right" });
const GUESS_CONFIRM_NO = Object.freeze({ id: 'flowv2_guess_confirm_no', title: 'No, let me pick' });

function buildQualificationListInteractive(body) {
  return {
    type: 'list',
    body,
    buttonText: QUALIFICATION_LIST_BUTTON_TEXT,
    sections: [
      {
        title: QUALIFICATION_LIST_SECTION_TITLE,
        rows: QUALIFICATION_ROWS.map((row) => ({
          id: row.id,
          title: row.waTitle || row.title,
        })),
      },
    ],
  };
}

/** Prefer profile name, then CRM/lead context — never block Node E on a name ask. */
function resolveGreetingName(ctx) {
  return (
    extractName(ctx?.flowV2?.profile?.name) ||
    extractName(ctx?.leadContext?.gx?.fullName) ||
    extractName(ctx?.leadContext?.iit?.fullName) ||
    extractName(ctx?.leadContext?.booking?.fullName) ||
    null
  );
}

function buildGreetingText(firstName) {
  return buildNodeEOpenBody(firstName || null);
}

/**
 * @param {{ flowV2?: { stage?: string|null }, leadContext?: object }} ctx
 * @returns {object} standard Flow v2 node return shape (see flowV2Dispatcher.js)
 */
function handleGreetingEntry(ctx) {
  // Defense-in-depth only — the real guarantee against double-greeting is
  // enforced by flowV2Dispatcher (only calls this when stage is falsy).
  if (ctx?.flowV2?.stage) {
    return {
      replyText: null,
      replyParts: null,
      interactive: null,
      contextPatch: {},
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  const firstName = resolveGreetingName(ctx);
  let profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  if (firstName && !profile.name) {
    profile = mergeFlowV2Profile(profile, { name: firstName });
  }
  if (profile.qualification) return qualificationRoute(profile, profile.qualification);
  // Master Flow Node E: never ask for name — go straight to the stage list.
  return {
    replyText: null,
    replyParts: null,
    interactive: buildQualificationListInteractive(buildNodeEOpenBody(firstName)),
    contextPatch: { stage: 'greeting_awaiting_qualification', profile, nameAttempts: null },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function button(id, title) {
  return Object.freeze({ id, title });
}

function interactiveButtons(body, buttons) {
  return { type: 'button', body, buttons };
}

function interactiveList(body, rows, title = 'Choose a direction') {
  return { type: 'list', body, buttonText: 'Select', sections: [{ title, rows }] };
}

function resultWithProfile(profile, stage, { replyText = null, interactive = null, extraContext = {} } = {}) {
  return {
    replyText,
    replyParts: null,
    interactive,
    contextPatch: { stage, profile, ...extraContext },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

function qualificationRoute(mergedProfile, qualification) {
  if (qualification === '10th Completed') {
    return resultWithProfile(mergedProfile, 'entry_class10_awaiting_reply', {
      interactive: interactiveButtons(
        "Nice — you're early, which is genuinely an advantage. Most students only start thinking about this in 12th.\nAre you choosing your 11th stream right now?",
        [
          button('flowv2_entry_10_choosing', 'Yes, choosing stream'),
          button('flowv2_entry_10_exploring', 'Just exploring'),
          button('flowv2_entry_10_parent', 'Parent asked me to'),
        ]
      ),
    });
  }
  if (qualification === '11th Studying') {
    const profile = mergeFlowV2Profile(mergedProfile, { timeline: 'next_year' });
    return resultWithProfile(profile, 'entry_class11_awaiting_reply', {
      interactive: interactiveButtons(
        "Good timing — you've got room to prepare properly.\nAre you looking at entrance exams, or more at which colleges to target?",
        [button('flowv2_entry_11_exams', 'Exams'), button('flowv2_entry_11_colleges', 'Colleges'), button('flowv2_entry_11_both', 'Both')]
      ),
    });
  }
  if (qualification === '12th Completed (PCB)') {
    return resultWithProfile(mergedProfile, 'entry_pcb_awaiting_reply', {
      interactive: interactiveButtons(
        'Got it. BiPC usually points toward medical or life sciences — are you set on that, or open to tech too? Plenty of BiPC students move into bioinformatics or AI in healthcare.',
        [button('flowv2_entry_pcb_medical', 'Medical'), button('flowv2_entry_pcb_tech', 'Open to tech'), button('flowv2_entry_pcb_unsure', 'Not sure')]
      ),
    });
  }
  if (qualification === '12th Completed (Commerce)') {
    return resultWithProfile(mergedProfile, 'entry_commerce_awaiting_reply', {
      interactive: interactiveList(
        'Commerce stream — so we’re looking at business, finance, design or management rather than engineering. Which direction pulls you?',
        [
          button('flowv2_entry_commerce_business', 'Business/Mgmt'),
          button('flowv2_entry_commerce_design', 'Design'),
          button('flowv2_entry_commerce_finance', 'Finance'),
          button('flowv2_entry_commerce_unsure', 'Not sure'),
        ]
      ),
    });
  }
  if (qualification === '12th Completed (Arts)') {
    // DEFAULTED PENDING BUSINESS CONFIRMATION — Assumption 2 / medical·law·MBA &
    // non-eng streams (Part 2.3 / 18) · ENGINEERING_TECH_SCOPE_ONLY.
    // See careerCounsellingFlowV2BusinessDefaults.js.
    const result = handleR11();
    return {
      ...result,
      interactive: {
        ...result.interactive,
        body: "Honest answer — my depth is engineering and tech programs in India, so I'd rather not guess at Arts pathways and point you wrong. Our counsellors do cover this properly though. Want me to book you with the right person?",
        buttons: OUT_OF_SCOPE_BUTTONS,
      },
      contextPatch: { stage: 'entry_arts_honest_scope', profile: mergedProfile },
    };
  }
  if (qualification === 'Diploma') {
    return resultWithProfile(mergedProfile, 'entry_diploma_awaiting_reply', {
      interactive: interactiveButtons(
        "Diploma's a solid route — and you've got a real advantage: lateral entry straight into 2nd year B.Tech. Is that what you're after?",
        [
          button('flowv2_entry_diploma_lateral', 'Yes, lateral entry'),
          button('flowv2_entry_diploma_full', 'Full B.Tech'),
          button('flowv2_entry_diploma_job', 'Job instead'),
        ]
      ),
    });
  }
  if (qualification === 'Degree') {
    return resultWithProfile(mergedProfile, 'entry_degree_awaiting_reply', {
      interactive: interactiveButtons(
        'Understood. Are you looking to switch colleges, or thinking about what comes after — higher studies or placements?',
        [
          button('flowv2_entry_degree_switch', 'Switch college'),
          button('flowv2_entry_degree_after', 'After graduation'),
          button('flowv2_entry_degree_explore', 'Just exploring'),
        ]
      ),
    });
  }
  if (qualification === 'Drop Year') {
    const profile = mergeFlowV2Profile(mergedProfile, { entryType: 'dropper' });
    return resultWithProfile(profile, 'entry_drop_year_awaiting_reply', {
      interactive: interactiveButtons(
        "Good — and for what it's worth, a drop year is normal and it works.\nColleges care where you're heading, not the gap.\nAre you reattempting an exam, or looking at direct admission this year?",
        [
          button('flowv2_entry_drop_reattempt', 'Reattempting'),
          button('flowv2_entry_drop_direct', 'Direct admission'),
          button('flowv2_entry_drop_both', 'Both'),
        ]
      ),
    });
  }
  if (qualification === 'Other') {
    return resultWithProfile(mergedProfile, 'entry_other_awaiting_text', {
      replyText: "No problem — tell me in your own words where you're at and I'll take it from there.",
    });
  }
  // Default eng path (12th PCM and any unhandled row) — Master Flow: fire B1
  // in the same turn, not a dead-end "Got it." park on greeting_captured_pending_b1.
  return continueToB1(mergedProfile);
}

function acceptQualification(ctx, qualification, extraPatch = {}) {
  const currentProfile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const streamByQualification = {
    '12th Completed (PCM)': 'PCM',
    '12th Completed (PCB)': 'PCB',
    '12th Completed (Commerce)': 'Commerce',
    '12th Completed (Arts)': 'Arts',
  };
  const mergedProfile = mergeFlowV2Profile(currentProfile, {
    ...extraPatch,
    qualification,
    stream: streamByQualification[qualification],
  });
  const result = qualificationRoute(mergedProfile, qualification);
  return {
    ...result,
    contextPatch: {
      ...result.contextPatch,
      pendingQualificationGuess: null,
      pendingAmbiguousResolution: null,
    },
  };
}

function qualificationPrompt(profile, body = NEUTRAL_QUALIFICATION_LINE, extraContext = {}) {
  return resultWithProfile(profile, 'greeting_awaiting_qualification', {
    interactive: buildQualificationListInteractive(body),
    extraContext: { nameAttempts: null, ...extraContext },
  });
}

function handleNameReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const name = extractName(text);
  if (name) {
    const mergedProfile = mergeFlowV2Profile(profile, { name });
    if (mergedProfile.qualification) return qualificationRoute(mergedProfile, mergedProfile.qualification);
    const body = buildNamedQualificationBody(name);
    return qualificationPrompt(mergedProfile, body);
  }
  const attempts = Number(ctx?.flowV2?.nameAttempts || 0) + 1;
  if (attempts < 2) {
    return resultWithProfile(profile, 'greeting_awaiting_name', {
      replyText: NAME_REASK,
      extraContext: { nameAttempts: attempts },
    });
  }
  if (profile.qualification) return qualificationRoute(profile, profile.qualification);
  return qualificationPrompt(profile);
}

const STREAM_CONFIRM_BUTTONS = Object.freeze([
  button('flowv2_r10_stream_pcm', 'MPC / PCM'),
  button('flowv2_r10_stream_pcb', 'BiPC / PCB'),
  button('flowv2_r10_stream_commerce', 'MEC / CEC'),
]);

function streamPrompt(profile) {
  return resultWithProfile(profile, 'greeting_awaiting_qualification', {
    interactive: interactiveButtons('Got it — which stream?', STREAM_CONFIRM_BUTTONS),
    extraContext: {
      pendingQualificationGuess: null,
      pendingAmbiguousResolution: { slot: 'qualification', partial: 'inter_stream' },
    },
  });
}

function resolvePendingAmbiguity(ctx, text) {
  const pending = ctx?.flowV2?.pendingAmbiguousResolution;
  if (!pending || pending.slot !== 'qualification') return null;
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const t = String(text || '').toLowerCase();

  if (pending.partial === 'inter_stream') {
    if (/\b(mpc|pcm)\b/.test(t)) return acceptQualification(ctx, '12th Completed (PCM)', { temperature: 'warm' });
    if (/\b(bipc|pcb)\b/.test(t)) return acceptQualification(ctx, '12th Completed (PCB)', { temperature: 'warm' });
    if (/\b(mec|cec)\b/.test(t)) return acceptQualification(ctx, '12th Completed (Commerce)', { temperature: 'warm' });
  }
  if (pending.partial === 'inter') {
    if (/\b(1st|first)\b/.test(t)) {
      return acceptQualification(ctx, '11th Studying', { temperature: 'warm' });
    }
    if (/\b(2nd|second|finished|completed)\b/.test(t)) return streamPrompt(profile);
  }
  if (pending.partial === '2nd_year') {
    if (/\bdiploma\b/.test(t)) return acceptQualification(ctx, 'Diploma', { temperature: 'warm' });
    if (/\b(b\.?\s*tech|degree)\b/.test(t)) return acceptQualification(ctx, 'Degree', { temperature: 'warm' });
    if (/\b(inter|12th)\b/.test(t)) return streamPrompt(profile);
  }
  if (pending.partial === 'passed_out') {
    if (/^\s*12th\s*$|\binter\b/i.test(text)) return streamPrompt(profile);
    if (/\bdiploma\b/.test(t)) return acceptQualification(ctx, 'Diploma', { temperature: 'warm' });
    if (/\bdegree\b/.test(t)) return acceptQualification(ctx, 'Degree', { temperature: 'warm' });
  }

  return qualificationPrompt(profile, NEUTRAL_QUALIFICATION_LINE, {
    pendingQualificationGuess: null,
    pendingAmbiguousResolution: null,
  });
}

function resolvePendingGuess(ctx, text) {
  const guess = ctx?.flowV2?.pendingQualificationGuess;
  if (!guess) return null;
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const t = String(text || '').trim().toLowerCase();
  const yes = t === 'yes' || t === "yes, that's right" || t === 'flowv2_guess_confirm_yes';
  const no = t === 'no' || t === 'no, let me pick' || t === 'flowv2_guess_confirm_no';

  if (yes) return acceptQualification(ctx, guess, { temperature: 'warm' });
  if (no) {
    return qualificationPrompt(profile, NEUTRAL_QUALIFICATION_LINE, {
      pendingQualificationGuess: null,
      pendingAmbiguousResolution: null,
    });
  }

  const exactRow = findQualificationRow(text);
  const corrected = exactRow?.title || extractFlowV2Slots(text, profile).qualification;
  if (corrected) return acceptQualification(ctx, corrected, { temperature: 'warm' });
  return qualificationPrompt(profile, NEUTRAL_QUALIFICATION_LINE, {
    pendingQualificationGuess: null,
    pendingAmbiguousResolution: null,
  });
}

function qualificationReflection(qualification) {
  const q = String(qualification || '');
  if (q === '12th Completed (PCM)') return '12th MPC';
  if (q === '12th Completed (PCB)') return '12th BiPC';
  if (q === '12th Completed (Commerce)') return '12th MEC / CEC';
  if (q === '12th Completed (Arts)') return '12th Arts';
  return q;
}

function r3Reflection(text, slots) {
  const facts = [];
  if (slots.qualification) facts.push(qualificationReflection(slots.qualification));
  if (slots.branchInterest) facts.push(slots.branchInterest);
  if (slots.budgetBand) {
    const amount = String(text || '').match(/(\d+(?:\.\d+)?)\s*(?:lakhs?|l\b)/i);
    facts.push(amount ? `around ₹${amount[1]}L` : 'your budget');
  }
  if (slots.cityPref) facts.push(slots.cityPref);
  return `That's really helpful, thanks — ${facts.join(', ')}. That's most of what I need already.`;
}

/**
 * @param {{ flowV2?: { stage?: string, profile?: object } }} ctx
 * @param {string} text
 * @param {{ classification?: object, messageType?: string }} [options]
 * @returns {object} standard Flow v2 node return shape (see flowV2Dispatcher.js)
 */
function handleGreetingReply(ctx, text, options = {}) {
  const stage = ctx?.flowV2?.stage;
  if (stage === 'greeting_awaiting_name') return handleNameReply(ctx, text);
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const pendingGuessResult = resolvePendingGuess(ctx, text);
  if (pendingGuessResult) return pendingGuessResult;
  const pendingAmbiguityResult = resolvePendingAmbiguity(ctx, text);
  if (pendingAmbiguityResult) return pendingAmbiguityResult;
  const normalizedText = String(text || '').replace(/[—–]/g, '-');
  const exactRow = findQualificationRow(text);
  const patch = exactRow
    ? { qualification: exactRow.title }
    : extractFlowV2Slots(normalizedText, profile);
  if (patch.qualification) {
    const { qualification, ...rest } = patch;
    const isR3 = options.classification?.bucket === 'R3';
    const temperature = isR3 ? 'hot' : profile.temperature || 'warm';
    const accepted = acceptQualification(ctx, qualification, { ...rest, temperature });
    if (isR3) {
      const reflection = r3Reflection(text, options.classification.extractedSlots || patch);
      let next = accepted;
      if (next.contextPatch.stage === 'greeting_captured_pending_b1') {
        next = handleB1Entry(withMergedProfile(ctx, accepted.contextPatch.profile));
      }
      if (next.contextPatch.stage === 'b3_awaiting_entry') {
        return combineNodeResults(
          [reflection],
          handleB3Entry(withMergedProfile(ctx, next.contextPatch.profile))
        );
      }
      const combined = combineNodeResults([reflection], next);
      const hasFullConstraintSkip =
        Boolean(accepted.contextPatch.profile.branchInterest) &&
        Boolean(accepted.contextPatch.profile.budgetBand) &&
        Boolean(accepted.contextPatch.profile.cityPref);
      return hasFullConstraintSkip
        ? {
            ...combined,
            contextPatch: { ...combined.contextPatch, r3OverAnswerPending: true },
          }
        : combined;
    }
    return accepted;
  }

  return qualificationPrompt(mergeFlowV2Profile(profile, patch), NEUTRAL_QUALIFICATION_LINE, {
    pendingQualificationGuess: null,
    pendingAmbiguousResolution: null,
  });
}

function continueToB1(profile) {
  return handleB1Entry({ flowV2: { profile } });
}

function handleEntrySideTrackReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const stage = ctx?.flowV2?.stage;
  const t = String(text || '').toLowerCase();

  if (stage === 'entry_class10_awaiting_reply') {
    return resultWithProfile(profile, 'entry_class10_stream_advice_parked', {
      replyText: 'That makes sense. At Class 10, the right next step is choosing a stream — not shortlisting colleges yet. I’ll keep this focused on stream planning.',
    });
  }
  if (stage === 'entry_class11_awaiting_reply') return continueToB1(profile);
  if (stage === 'entry_pcb_awaiting_reply') {
    if (/\bmedical\b/.test(t)) {
      const result = handleR11();
      return { ...result, contextPatch: { stage: 'entry_pcb_medical_scope', profile } };
    }
    return continueToB1(profile);
  }
  if (stage === 'entry_commerce_awaiting_reply') {
    let branchInterest = null;
    if (/\bdesign\b/.test(t)) branchInterest = 'design';
    else if (/\bbusiness\b|\bmgmt\b|\bmanagement\b|\bfinance\b/.test(t)) branchInterest = 'Business/Commerce';
    const mergedProfile = mergeFlowV2Profile(profile, { stream: 'Commerce', branchInterest });
    // DEFAULTED PENDING BUSINESS CONFIRMATION — Assumption 2 / CAT-1 no mixed
    // catalogs (Part 2.3 / 18) · ENGINEERING_TECH_SCOPE_ONLY + NO_MIXED_CATALOGS.
    // See careerCounsellingFlowV2BusinessDefaults.js.
    const result = handleR11();
    return {
      ...result,
      interactive: {
        ...result.interactive,
        body:
          "Honest answer — GuideXpert's verified catalog here is engineering and tech, so I won't mix in or invent business, finance, or design colleges. A counsellor can still help with that path properly. Want me to connect you?",
      },
      contextPatch: { stage: 'entry_commerce_honest_scope', profile: mergedProfile },
    };
  }
  if (stage === 'entry_diploma_awaiting_reply') {
    const entryType = /\blateral\b/.test(t) ? 'lateral' : 'regular';
    return continueToB1(mergeFlowV2Profile(profile, { entryType }));
  }
  if (stage === 'entry_degree_awaiting_reply') {
    if (/\bswitch\b/.test(t)) {
      return resultWithProfile(profile, 'entry_degree_switch_guidance', {
        interactive: interactiveButtons(
          'Switching colleges mid-degree can be genuinely difficult, so I don’t want to oversell it. A counsellor can check your specific university and transfer options with you.',
          OUT_OF_SCOPE_BUTTONS
        ),
      });
    }
    return continueToB1(profile);
  }
  if (stage === 'entry_drop_year_awaiting_reply') return continueToB1(profile);
  if (stage === 'entry_other_awaiting_text') {
    const patch = extractFlowV2Slots(text, profile);
    if (patch.qualification && patch.qualification !== 'Other') {
      const { qualification, ...rest } = patch;
      return acceptQualification(ctx, qualification, rest);
    }
    return resultWithProfile(profile, 'entry_other_awaiting_text', {
      replyText: "Thanks — I want to place you correctly. Are you in school, diploma, degree, or taking a drop year?",
    });
  }
  if (
    stage === 'entry_arts_honest_scope' ||
    stage === 'entry_commerce_honest_scope' ||
    stage === 'entry_pcb_medical_scope' ||
    stage === 'entry_degree_switch_guidance'
  ) {
    if (/\btech\b|\btell me\b|\bcontinue\b/.test(t)) return continueToB1(profile);
    return resultWithProfile(profile, stage, {
      interactive: interactiveButtons(
        'I can keep this to the engineering and tech options I can verify, or connect you with the right counsellor.',
        OUT_OF_SCOPE_BUTTONS
      ),
    });
  }
  if (stage === 'entry_class10_stream_advice_parked') {
    return resultWithProfile(profile, stage, {
      replyText: 'For now, focus on choosing the stream that fits your interests and strengths. College shortlisting can wait until the timing is right.',
    });
  }
  return continueToB1(profile);
}

module.exports = {
  handleGreetingEntry,
  handleGreetingReply,
  // exported for focused unit testing
  resolveGreetingName,
  buildGreetingText,
  handleNameReply,
  handleEntrySideTrackReply,
  buildQualificationListInteractive,
  QUALIFICATION_ROWS,
  QUALIFICATION_LIST_SECTION_TITLE,
  QUALIFICATION_LIST_BUTTON_TEXT,
  UNKNOWN_NAME_GREETING,
  NAME_REASK,
  NEUTRAL_QUALIFICATION_LINE,
  GUESS_CONFIRM_YES,
  GUESS_CONFIRM_NO,
  buildNodeEOpenBody,
  // Reused by R10's deterministic PCM/PCB resolution.
  acceptQualification,
  findQualificationRow,
};
