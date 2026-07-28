'use strict';

/**
 * Flow v2 — R13 · Silence / Returning.
 *
 * ONE lifetime nudge shared with I-8 / R6 timeout paths via profile.nudgeSent.
 * Never nudges opted_out, parked_core, or crisisLocked leads.
 * Returning students resume at the stored stage — never restart discovery.
 */

const { mergeFlowV2Profile } = require('../../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../../constants/careerCounsellingFlowV2Profile');

const GREETING_NUDGE_MS = 4 * 60 * 60 * 1000;
const MIDFLOW_NUDGE_MS = 24 * 60 * 60 * 1000;

function canSendNudge(profile, stage) {
  const p = profile || {};
  if (p.nudgeSent === true) return false;
  if (p.optedOut === true) return false;
  if (p.crisisLocked === true) return false;
  if (stage === 'parked_core' || stage === 'r4p_parked_rank_list') return false;
  if (p.coreBridgeClosed === true && stage === 'parked_core') return false;
  return true;
}

function markNudgeSent(profile) {
  return mergeFlowV2Profile(profile || emptyFlowV2Profile(), {
    nudgeSent: true,
    nudgeSentAt: new Date().toISOString(),
  });
}

/**
 * Build a silence nudge if eligible. Caller supplies silenceMs and whether
 * the lead was only greeted (no reply) vs mid-flow.
 */
function buildSilenceNudge({ profile, stage, silenceMs, name = null }) {
  if (!canSendNudge(profile, stage)) return null;
  const who = name || profile?.name || 'there';
  const greetedOnly =
    !stage ||
    stage === 'greeting_awaiting_name' ||
    stage === 'greeting_awaiting_qualification' ||
    stage === 'greeting_awaiting_reply';

  if (greetedOnly && silenceMs >= GREETING_NUDGE_MS) {
    return {
      replyText: null,
      replyParts: null,
      interactive: {
        type: 'list',
        body: `Hey ${who} — still here whenever you want a hand picking a college. Just one tap to start 🙂`,
        buttonText: 'Select',
        sections: [
          {
            title: 'Start',
            rows: [
              { id: 'flowv2_r13_start', title: 'Help me shortlist' },
              { id: 'flowv2_r13_later', title: 'Maybe later' },
            ],
          },
        ],
      },
      contextPatch: {
        stage: 'greeted_no_reply',
        profile: markNudgeSent(profile),
      },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  if (!greetedOnly && silenceMs >= MIDFLOW_NUDGE_MS) {
    return {
      replyText: null,
      replyParts: null,
      interactive: {
        type: 'button',
        body: `Hey ${who} — no rush at all 🙂\nYour shortlist is saved right here whenever you want it.\nWant me to send the comparison, or leave it for now?`,
        buttons: [
          { id: 'flowv2_r13_send_comparison', title: 'Send comparison' },
          { id: 'flowv2_r13_leave_it', title: 'Leave it for now' },
        ],
      },
      contextPatch: {
        stage,
        profile: markNudgeSent(profile),
        interruptedStage: stage,
      },
      nextState: 'career_counselling_flow_v2',
      intent: 'career_counselling_flow_v2',
    };
  }

  return null;
}

const RETURNING_PATTERN = /\b(hey|hi|hello|sorry|was busy|back|i'?m back)\b/i;

function isReturningMessage(text) {
  return RETURNING_PATTERN.test(String(text || ''));
}

/**
 * Resume copy when a student returns days later.
 */
function handleR13Returning(ctx, text) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const stage = ctx?.flowV2?.stage || null;
  const who = profile.name || 'there';
  const shortlistCount = Array.isArray(profile.shortlist) ? profile.shortlist.length : 0;

  if (!isReturningMessage(text) && stage && stage !== 'greeted_no_reply') {
    return null;
  }

  const body =
    shortlistCount > 0
      ? `No worries at all, ${who} 🙂 We'd shortlisted ${shortlistCount} last time. Want to pick up at the comparison, or add anything new first?`
      : `No worries at all, ${who} 🙂 Want to pick up where we left off, or start fresh?`;

  return {
    replyText: null,
    replyParts: null,
    interactive: {
      type: 'button',
      body,
      buttons: [
        { id: 'flowv2_r13_compare', title: 'Compare them' },
        { id: 'flowv2_r13_add', title: 'Add something' },
        { id: 'flowv2_r13_fresh', title: 'Start fresh' },
      ],
    },
    contextPatch: {
      stage: stage || 'b1_awaiting_reply',
      profile,
      r13ResumePending: true,
    },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  canSendNudge,
  markNudgeSent,
  buildSilenceNudge,
  handleR13Returning,
  isReturningMessage,
  GREETING_NUDGE_MS,
  MIDFLOW_NUDGE_MS,
};
