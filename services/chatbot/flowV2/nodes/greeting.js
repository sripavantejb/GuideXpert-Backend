'use strict';

/**
 * Flow v2 — Greeting (first live beat).
 *
 * `handleGreetingEntry` fires when `context.flowV2.stage` is falsy (first
 * turn). Replies move through name, qualification, and entry-side-track
 * stages before rejoining B1.
 * Both are only ever invoked by `flowV2Dispatcher.processFlowV2Turn` — see
 * that file for the actual routing guarantee (this is the source of the
 * "never send the full greeting twice" contract, not node-file discipline
 * alone).
 */

const { extractFlowV2Slots, extractName } = require('../flowV2SlotExtractor');
const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { handleR11, OUT_OF_SCOPE_BUTTONS } = require('../router/handlers/r11Handler');

const QUALIFICATION_ROWS = Object.freeze([
  Object.freeze({ id: 'flowv2_qual_10_completed', title: '10th Completed' }),
  Object.freeze({ id: 'flowv2_qual_11_studying', title: '11th Studying' }),
  Object.freeze({ id: 'flowv2_qual_12_pcm', title: '12th Completed (PCM)' }),
  Object.freeze({ id: 'flowv2_qual_12_pcb', title: '12th Completed (PCB)' }),
  Object.freeze({ id: 'flowv2_qual_12_commerce', title: '12th Completed (Commerce)' }),
  Object.freeze({ id: 'flowv2_qual_12_arts', title: '12th Completed (Arts)' }),
  Object.freeze({ id: 'flowv2_qual_diploma', title: 'Diploma' }),
  Object.freeze({ id: 'flowv2_qual_degree', title: 'Degree' }),
  Object.freeze({ id: 'flowv2_qual_drop_year', title: 'Drop Year' }),
  Object.freeze({ id: 'flowv2_qual_other', title: 'Other' }),
]);

const QUALIFICATION_LIST_SECTION_TITLE = 'Where are you right now?';
const QUALIFICATION_LIST_BUTTON_TEXT = 'Select';
const UNKNOWN_NAME_GREETING =
  "Hi 😊 I'm Rithika from GuideXpert. I help students figure out the right path after Class 12. May I know your name?";
const NAME_REASK = "Sorry, didn't catch that 😊 What should I call you?";
const NEUTRAL_QUALIFICATION_LINE = 'Nice to meet you 😊 Quick one first — can I know your qualification?';
const GUESS_CONFIRM_YES = Object.freeze({ id: 'flowv2_guess_confirm_yes', title: "Yes, that's right" });
const GUESS_CONFIRM_NO = Object.freeze({ id: 'flowv2_guess_confirm_no', title: 'No, let me pick' });

function buildQualificationListInteractive(body) {
  return {
    type: 'list',
    body,
    buttonText: QUALIFICATION_LIST_BUTTON_TEXT,
    sections: [{ title: QUALIFICATION_LIST_SECTION_TITLE, rows: QUALIFICATION_ROWS }],
  };
}

/** Only an already-accepted Flow v2 profile name may skip the name ask. */
function resolveGreetingName(ctx) {
  return extractName(ctx?.flowV2?.profile?.name);
}

function buildGreetingText(firstName) {
  return firstName
    ? `Nice to meet you, ${firstName} 😊 Quick one first — can I know your qualification?`
    : UNKNOWN_NAME_GREETING;
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
  if (!firstName) {
    return {
      replyText: UNKNOWN_NAME_GREETING,
      replyParts: null,
      interactive: null,
      contextPatch: { stage: 'greeting_awaiting_name', nameAttempts: 0 },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  if (profile.qualification) return qualificationRoute(profile, profile.qualification);
  return {
    replyText: null,
    replyParts: null,
    interactive: buildQualificationListInteractive(buildGreetingText(firstName)),
    contextPatch: { stage: 'greeting_awaiting_qualification', nameAttempts: null },
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
        'Got it. PCB usually points toward medical or life sciences — are you set on that, or open to tech too? Plenty of PCB students move into bioinformatics or AI in healthcare.',
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
  return resultWithProfile(mergedProfile, 'greeting_captured_pending_b1', { replyText: 'Got it.' });
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
  return { ...result, contextPatch: { ...result.contextPatch, pendingQualificationGuess: null } };
}

function qualificationPrompt(profile, body = NEUTRAL_QUALIFICATION_LINE) {
  return resultWithProfile(profile, 'greeting_awaiting_qualification', {
    interactive: buildQualificationListInteractive(body),
    extraContext: { nameAttempts: null },
  });
}

function handleNameReply(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const name = extractName(text);
  if (name) {
    const mergedProfile = mergeFlowV2Profile(profile, { name });
    if (mergedProfile.qualification) return qualificationRoute(mergedProfile, mergedProfile.qualification);
    const body = `Nice to meet you, ${name} 😊 Quick one first — can I know your qualification?`;
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

/**
 * @param {{ flowV2?: { stage?: string, profile?: object } }} ctx
 * @param {string} text
 * @returns {object} standard Flow v2 node return shape (see flowV2Dispatcher.js)
 */
function handleGreetingReply(ctx, text) {
  const stage = ctx?.flowV2?.stage;
  if (stage === 'greeting_awaiting_name') return handleNameReply(ctx, text);
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const normalizedText = String(text || '').replace(/[—–]/g, '-');
  const exactRow = QUALIFICATION_ROWS.find(
    (row) => row.title.toLowerCase() === String(text || '').trim().toLowerCase()
  );
  const patch = exactRow
    ? { qualification: exactRow.title }
    : extractFlowV2Slots(normalizedText, profile);
  if (patch.qualification) {
    const { qualification, ...rest } = patch;
    return acceptQualification(ctx, qualification, rest);
  }

  return qualificationPrompt(mergeFlowV2Profile(profile, patch));
}

function continueToB1(profile) {
  return resultWithProfile(profile, 'greeting_captured_pending_b1');
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
  // Reused by R10's deterministic PCM/PCB resolution.
  acceptQualification,
};
