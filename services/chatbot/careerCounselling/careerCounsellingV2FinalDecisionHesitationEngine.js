'use strict';

const {
  STAGES,
  PHASE11_STEPS,
  PHASE11_ENGINE_VERSION,
  ONE_ON_ONE_SESSION_URL,
  getPhase11Message,
} = require('../../../constants/careerCounsellingV2FinalDecisionHesitation');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const { isSocialGreetingOnly } = require('./careerCounsellingV2ResponseParser');
const {
  isHesitationNone,
  isConfidenceYes,
  isConfidenceNo,
  isEscalationDone,
  parseHesitationOrNone,
} = require('./careerCounsellingV2FinalDecisionHesitationParser');
const {
  buildPersonalizedHesitationReply,
  evaluatePhase11Escalation,
  buildOneOnOneEscalationReply,
} = require('./careerCounsellingV2FinalDecisionHesitationCore');
const {
  logPhase11HesitationStarted,
  logPhase11HesitationIdentified,
  logPhase11HesitationResponded,
  logPhase11HesitationResolved,
  logPhase11HesitationContinued,
  logPhase11EscalationRecommended,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');

function withTracking(profile = {}, patch = {}) {
  return { ...profile, ...patch };
}

function noteRaisedHesitation(profile = {}, hesitationId, extras = {}) {
  const raised = [
    ...new Set([
      ...(Array.isArray(profile.phase11RaisedHesitations)
        ? profile.phase11RaisedHesitations
        : []),
      hesitationId,
    ].filter(Boolean)),
  ];
  return withTracking(profile, {
    phase11RaisedHesitations: raised,
    phase11PersonalizedResponseCount:
      Number(profile.phase11PersonalizedResponseCount || 0) + 1,
    phase11MultiTopicUtterance:
      Boolean(profile.phase11MultiTopicUtterance) || Boolean(extras.multiTopic),
    phase11ReassuranceAskCount:
      Number(profile.phase11ReassuranceAskCount || 0) +
      (extras.reassuranceAsk ? 1 : 0),
  });
}

function presentOneOnOneEscalation(ctx, decision, analyticsMeta = {}) {
  const built = buildOneOnOneEscalationReply(ctx.profile || {}, decision);

  logPhase11EscalationRecommended({
    stage: STAGES.PHASE_11_FINAL_DECISION_HESITATION,
    reason: decision.reason,
    url: ONE_ON_ONE_SESSION_URL,
    ...analyticsMeta,
  });
  logProfileUpdated({
    stage: STAGES.PHASE_11_FINAL_DECISION_HESITATION,
    fieldsUpdated: [
      'phase11Escalated',
      'phase11EscalationReason',
      'phase11OneOnOneUrl',
      'phase11Completed',
    ],
    ...analyticsMeta,
  });

  return {
    reply: built.reply,
    context: {
      ...ctx,
      stage: STAGES.PHASE_11_FINAL_DECISION_HESITATION,
      step: 'hesitation_escalation',
      lastQuestionKey: 'hesitation_escalation',
      profile: withTracking(ctx.profile || {}, {
        phase11Completed: true,
        phase11Escalated: true,
        phase11EscalationReason: decision.reason,
        phase11OneOnOneUrl: ONE_ON_ONE_SESSION_URL,
        phase11ExitTarget: 'one_on_one_escalation',
      }),
    },
    clearState: false,
    analytics: [
      { type: 'phase11_escalation_recommended', reason: decision.reason },
      { type: 'one_on_one_recommended', source: 'phase11_hesitation', reason: decision.reason },
    ],
  };
}

async function exitToNextStage(ctx, analyticsMeta = {}, opts = {}) {
  const decision = evaluatePhase11Escalation(ctx, opts);
  if (decision.escalate) {
    return presentOneOnOneEscalation(ctx, decision, analyticsMeta);
  }

  // Handoff-only: non-escalate exit → Phase 12 (service selection). Phase 11 logic otherwise frozen.
  logPhase11HesitationContinued({
    stage: STAGES.PHASE_11_FINAL_DECISION_HESITATION,
    exitTarget: 'phase_12_personalized_counseling_recommendation',
    escalationSkipped: decision.reason,
    ...analyticsMeta,
  });
  const {
    processCounselingExperienceSelectionTurn,
  } = require('./careerCounsellingV2CounselingExperienceSelectionEngine');
  return processCounselingExperienceSelectionTurn('', {
    ...ctx,
    profile: withTracking(ctx.profile || {}, {
      phase11Completed: true,
      phase11Escalated: false,
      phase11ExitTarget: 'phase_12_personalized_counseling_recommendation',
    }),
  }, {
    startCounselingExperienceSelection: true,
    analytics: analyticsMeta,
  });
}

function startFinalDecisionHesitation(ctx, analyticsMeta = {}) {
  const profile = { ...(ctx.profile || {}) };

  logPhase11HesitationStarted({
    stage: STAGES.PHASE_11_FINAL_DECISION_HESITATION,
    ...analyticsMeta,
  });

  const nextProfile = withTracking(profile, {
    phase11HesitationPresented: true,
    phase11ResolvedHesitations: Array.isArray(profile.phase11ResolvedHesitations)
      ? profile.phase11ResolvedHesitations
      : [],
    phase11RaisedHesitations: Array.isArray(profile.phase11RaisedHesitations)
      ? profile.phase11RaisedHesitations
      : [],
    phase11PersonalizedResponseCount: Number(profile.phase11PersonalizedResponseCount || 0),
    phase11ConfidenceNoCount: Number(profile.phase11ConfidenceNoCount || 0),
    phase11ReassuranceAskCount: Number(profile.phase11ReassuranceAskCount || 0),
    phase11MultiTopicUtterance: Boolean(profile.phase11MultiTopicUtterance),
    phase11ConfidenceCheck: null,
    phase11Escalated: false,
    phase11EngineVersion: PHASE11_ENGINE_VERSION,
  });

  logProfileUpdated({
    stage: STAGES.PHASE_11_FINAL_DECISION_HESITATION,
    fieldsUpdated: ['phase11HesitationPresented', 'phase11EngineVersion'],
    ...analyticsMeta,
  });

  return {
    reply: getPhase11Message('ask'),
    context: {
      ...ctx,
      stage: STAGES.PHASE_11_FINAL_DECISION_HESITATION,
      step: 'hesitation_ask',
      profile: nextProfile,
      lastQuestionKey: 'hesitation_ask',
      phase11StartedAt: new Date().toISOString(),
      phase11SecondUsed: false,
    },
    clearState: false,
    analytics: [{ type: 'phase11_hesitation_started' }],
  };
}

function respondToHesitation(ctx, hesitationId, rawAnswer, analyticsMeta, extras = {}) {
  const nextProfile = noteRaisedHesitation(ctx.profile || {}, hesitationId, extras);
  const built = buildPersonalizedHesitationReply(nextProfile, hesitationId);

  logPhase11HesitationIdentified({
    stage: STAGES.PHASE_11_FINAL_DECISION_HESITATION,
    hesitationId,
    ...analyticsMeta,
  });
  logPhase11HesitationResponded({
    stage: STAGES.PHASE_11_FINAL_DECISION_HESITATION,
    hesitationId,
    ...analyticsMeta,
  });

  return {
    reply: built.reply,
    context: {
      ...ctx,
      step: 'hesitation_confirm',
      currentHesitationId: hesitationId,
      lastQuestionKey: 'hesitation_confirm',
      profile: withTracking(nextProfile, {
        phase11LastHesitationId: hesitationId,
        phase11LastHesitationRaw: String(rawAnswer || '').slice(0, 200),
      }),
    },
    clearState: false,
    analytics: [
      { type: 'phase11_hesitation_identified' },
      { type: 'phase11_hesitation_detected' },
      { type: 'phase11_hesitation_responded' },
    ],
  };
}

async function processFinalDecisionHesitationTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (
    opts.startFinalDecisionHesitation ||
    ctx.step === 'phase11_final_decision_hesitation_placeholder' ||
    (ctx.stage === STAGES.PHASE_11_FINAL_DECISION_HESITATION &&
      !PHASE11_STEPS.includes(ctx.step) &&
      ctx.step !== 'phase12_personalized_counseling_recommendation_placeholder' &&
      !String(ctx.step || '').startsWith('counsel_rec_') &&
      ctx.step !== 'phase13_booking_placeholder' &&
      ctx.step !== 'counseling_invitation_placeholder' &&
      !String(ctx.step || '').startsWith('invite_') &&
      ctx.step !== 'conversation_complete')
  ) {
    return startFinalDecisionHesitation(ctx, analyticsMeta);
  }

  if (
    ctx.stage === 'phase_12_personalized_counseling_recommendation' ||
    ctx.stage === 'phase_13_booking_orchestrator' ||
    ctx.stage === 'phase_13_booking_placeholder' ||
    ctx.step === 'phase12_personalized_counseling_recommendation_placeholder' ||
    ctx.step === 'phase13_booking_placeholder' ||
    ctx.step === 'phase14_journey_completion_placeholder' ||
    ctx.step === 'journey_completed' ||
    (typeof ctx.step === 'string' && ctx.step.startsWith('counsel_rec_') ||
        ctx.step.startsWith('booking_'))
  ) {
    const {
      processCounselingExperienceSelectionTurn,
    } = require('./careerCounsellingV2CounselingExperienceSelectionEngine');
    return processCounselingExperienceSelectionTurn(inbound, ctx, {
      startCounselingExperienceSelection:
        ctx.step === 'phase12_personalized_counseling_recommendation_placeholder' ||
        opts.startCounselingExperienceSelection,
      analytics: analyticsMeta,
    });
  }

  if (
    ctx.stage === STAGES.COUNSELING_INVITATION ||
    ctx.stage === STAGES.COUNSELING_INVITATION_PLACEHOLDER ||
    ctx.stage === STAGES.CONVERSATION_COMPLETE ||
    ctx.step === 'counseling_invitation_placeholder' ||
    ctx.step === 'conversation_complete' ||
    (typeof ctx.step === 'string' && ctx.step.startsWith('invite_'))
  ) {
    const {
      processCounselingInvitationTurn,
    } = require('./careerCounsellingV2CounselingInvitationEngine');
    return processCounselingInvitationTurn(inbound, ctx, {
      startCounselingInvitation:
        ctx.step === 'counseling_invitation_placeholder' ||
        opts.startCounselingInvitation,
      analytics: analyticsMeta,
    });
  }

  if (isCareerCounsellingJourneyBreakout(inbound)) {
    return {
      reply: BREAKOUT_DEFLECTION,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'hesitation_escalation') {
    if (isEscalationDone(inbound) || isHesitationNone(inbound) || isConfidenceYes(inbound)) {
      return {
        reply: 'Glad that helped. You can return anytime if you want more guidance.',
        context: {
          ...ctx,
          stage: STAGES.CONVERSATION_COMPLETE,
          step: 'conversation_complete',
          profile: withTracking(ctx.profile || {}, {
            phase11EscalationAcknowledged: true,
          }),
        },
        clearState: false,
        analytics: [],
      };
    }
    const parsedEarly = parseHesitationOrNone(inbound);
    if (parsedEarly?.kind === 'expert_request') {
      return presentOneOnOneEscalation(
        ctx,
        { escalate: true, reason: 'explicit_expert_request' },
        analyticsMeta
      );
    }
    return {
      reply: [
        'Whenever you’re ready, the optional One-on-One form is here:',
        ONE_ON_ONE_SESSION_URL,
        '',
        getPhase11Message('escalation_soft_close'),
      ].join('\n'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (isSocialGreetingOnly(inbound)) {
    return {
      reply: `${getPhase11Message('greeting_mid')}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'hesitation_ask') {
    const parsedAsk = parseHesitationOrNone(inbound);
    if (parsedAsk?.kind === 'expert_request') {
      return presentOneOnOneEscalation(
        {
          ...ctx,
          profile: withTracking(ctx.profile || {}, {
            phase11ConfidenceCheck: 'expert_requested',
          }),
        },
        { escalate: true, reason: 'explicit_expert_request' },
        analyticsMeta
      );
    }

    if (isHesitationNone(inbound) || parsedAsk?.kind === 'none') {
      const ack = getPhase11Message('fast_path_ack');
      const exited = await exitToNextStage(
        {
          ...ctx,
          profile: withTracking(ctx.profile || {}, {
            phase11ConfidenceCheck: 'ready',
            phase11ResolvedHesitations: [
              ...new Set([
                ...(ctx.profile?.phase11ResolvedHesitations || []),
                'none',
              ]),
            ],
          }),
        },
        analyticsMeta
      );
      return {
        ...exited,
        reply: `${ack}\n\n${exited.reply}`,
      };
    }

    if (parsedAsk?.kind === 'deflect') {
      return {
        reply: `${parsedAsk.reply}\n\n${getPhase11Message('ask')}`,
        context: ctx,
        clearState: false,
        analytics: [],
      };
    }
    if (parsedAsk?.kind === 'hesitation') {
      return respondToHesitation(ctx, parsedAsk.id, parsedAsk.rawAnswer, analyticsMeta, {
        multiTopic: parsedAsk.multiTopic,
        reassuranceAsk: parsedAsk.reassuranceAsk,
      });
    }
    return {
      reply: getPhase11Message('ask'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'hesitation_confirm') {
    const parsedConfirm = parseHesitationOrNone(inbound);
    if (parsedConfirm?.kind === 'expert_request') {
      return presentOneOnOneEscalation(
        ctx,
        { escalate: true, reason: 'explicit_expert_request' },
        analyticsMeta
      );
    }

    if (isConfidenceYes(inbound)) {
      const id = ctx.currentHesitationId || ctx.profile?.phase11LastHesitationId;
      logPhase11HesitationResolved({
        stage: STAGES.PHASE_11_FINAL_DECISION_HESITATION,
        hesitationId: id,
        ...analyticsMeta,
      });
      return exitToNextStage(
        {
          ...ctx,
          profile: withTracking(ctx.profile || {}, {
            phase11ConfidenceCheck: 'yes',
            phase11ResolvedHesitations: [
              ...new Set([
                ...(ctx.profile?.phase11ResolvedHesitations || []),
                id,
              ].filter(Boolean)),
            ],
          }),
        },
        analyticsMeta
      );
    }

    if (isConfidenceNo(inbound)) {
      const noCount = Number(ctx.profile?.phase11ConfidenceNoCount || 0) + 1;
      if (ctx.phase11SecondUsed) {
        return exitToNextStage(
          {
            ...ctx,
            profile: withTracking(ctx.profile || {}, {
              phase11ConfidenceCheck: 'no_after_second',
              phase11ConfidenceNoCount: noCount,
            }),
          },
          analyticsMeta
        );
      }
      return {
        reply: getPhase11Message('second_prompt'),
        context: {
          ...ctx,
          step: 'hesitation_second',
          phase11SecondUsed: true,
          lastQuestionKey: 'hesitation_second',
          profile: withTracking(ctx.profile || {}, {
            phase11ConfidenceCheck: 'no',
            phase11ConfidenceNoCount: noCount,
          }),
        },
        clearState: false,
        analytics: [],
      };
    }

    if (parsedConfirm?.kind === 'hesitation') {
      return respondToHesitation(
        ctx,
        parsedConfirm.id,
        parsedConfirm.rawAnswer,
        analyticsMeta,
        {
          multiTopic: parsedConfirm.multiTopic,
          reassuranceAsk: parsedConfirm.reassuranceAsk,
        }
      );
    }
    return {
      reply: getPhase11Message('continue_clarify'),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'hesitation_second') {
    const parsedSecond = parseHesitationOrNone(inbound);
    if (parsedSecond?.kind === 'expert_request') {
      return presentOneOnOneEscalation(
        ctx,
        { escalate: true, reason: 'explicit_expert_request' },
        analyticsMeta
      );
    }

    if (isHesitationNone(inbound) || isConfidenceYes(inbound) || parsedSecond?.kind === 'none') {
      return exitToNextStage(ctx, analyticsMeta);
    }
    if (parsedSecond?.kind === 'deflect') {
      const exited = await exitToNextStage(ctx, analyticsMeta);
      return { ...exited, reply: `${parsedSecond.reply}\n\n${exited.reply}` };
    }
    if (parsedSecond?.kind === 'hesitation') {
      const tracked = noteRaisedHesitation(ctx.profile || {}, parsedSecond.id, {
        multiTopic: parsedSecond.multiTopic,
        reassuranceAsk: parsedSecond.reassuranceAsk,
      });
      const built = buildPersonalizedHesitationReply(tracked, parsedSecond.id);
      logPhase11HesitationResponded({
        stage: STAGES.PHASE_11_FINAL_DECISION_HESITATION,
        hesitationId: parsedSecond.id,
        secondPass: true,
        ...analyticsMeta,
      });
      const exited = await exitToNextStage(
        {
          ...ctx,
          profile: withTracking(tracked, {
            phase11LastHesitationId: parsedSecond.id,
            phase11ResolvedHesitations: [
              ...new Set([
                ...(tracked.phase11ResolvedHesitations || []),
                parsedSecond.id,
              ]),
            ],
            phase11ConfidenceCheck: 'second_addressed',
          }),
        },
        analyticsMeta
      );
      return {
        ...exited,
        reply: `${built.reply.split('\n\n')[0]}\n\n${exited.reply}`,
      };
    }
    return exitToNextStage(ctx, analyticsMeta);
  }

  return startFinalDecisionHesitation(ctx, analyticsMeta);
}

module.exports = {
  STAGES,
  PHASE11_STEPS,
  startFinalDecisionHesitation,
  processFinalDecisionHesitationTurn,
  evaluatePhase11Escalation,
  presentOneOnOneEscalation,
};
