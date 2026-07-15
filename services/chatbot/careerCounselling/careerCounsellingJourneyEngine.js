'use strict';

const {
  FLOW_ID,
  BREAKOUT_DEFLECTION,
  getMessage,
  getSectionConfig,
  getFirstSection,
} = require('../../../constants/careerCounsellingJourney');
const {
  isCareerCounsellingJourneyBreakout,
  isPermissionYes,
  isPermissionNo,
} = require('./careerCounsellingIntentService');
const {
  isCounsellingQuestion,
  answerCounsellingQuestion,
} = require('./careerCounsellingQuestionService');
const {
  logCareerPhaseStarted,
  logCareerStepCompleted,
  logCareerPhaseCompleted,
  logCareerResume,
} = require('./careerCounsellingAnalytics');

const AWAITING = Object.freeze({
  ACK: 'ack',
  PERMISSION: 'permission',
});

function initialContext() {
  const first = getFirstSection(1);
  return {
    flow: FLOW_ID,
    phase: 1,
    step: first?.step || 'welcome',
    awaiting: null,
    phasesCompleted: [],
  };
}

function isAcknowledgment(text) {
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!t) return false;
  return (
    /^(ok|okay|yes|yeah|yep|yup|sure|continue|go on|got it|understood|hmm|hm|alright|fine|next|proceed|absolutely|definitely|makes sense|sounds good|i see|noted|👍|✅)$/i.test(
      t
    ) || /\b(make(s)? sense|sounds good|i (see|understand|agree))\b/i.test(t)
  );
}

function buildSectionDelivery(section) {
  const content = getMessage(section.contentKey);
  if (section.type === 'permission') {
    return content;
  }
  if (section.type === 'hold') {
    return content;
  }
  const checkpoint = section.checkpointKey ? getMessage(section.checkpointKey) : '';
  return checkpoint ? `${content}\n\n${checkpoint}` : content;
}

function buildResumeSuffix(section) {
  if (!section || section.type === 'hold' || section.type === 'permission') {
    return '';
  }
  const checkpoint = section.checkpointKey ? getMessage(section.checkpointKey) : '';
  if (!checkpoint) return '';
  return `\n\n${getMessage('resume_checkpoint_prefix')} ${checkpoint}`;
}

function applyStepTransition(ctx, next) {
  return {
    ...ctx,
    phase: next.phase,
    step: next.step,
    awaiting: null,
  };
}

function deliverSection(section, ctx, analyticsMeta = {}) {
  const nextCtx = {
    ...ctx,
    awaiting: section.type === 'permission' ? AWAITING.PERMISSION : AWAITING.ACK,
  };
  return {
    reply: buildSectionDelivery(section),
    context: nextCtx,
    analytics: [{ type: 'step_delivered', step: section.step, phase: ctx.phase, ...analyticsMeta }],
  };
}

function advanceFromSection(section, ctx, analyticsMeta = {}) {
  logCareerStepCompleted({
    phase: ctx.phase,
    step: section.step,
    ...analyticsMeta,
  });

  const nextRef = section.next;
  if (!nextRef) {
    return { reply: getMessage('awaiting_ack_nudge'), context: ctx, analytics: [] };
  }

  const nextSection = getSectionConfig(nextRef.phase, nextRef.step);
  if (!nextSection) {
    return { reply: getMessage('awaiting_ack_nudge'), context: applyStepTransition(ctx, nextRef), analytics: [] };
  }

  const delivered = deliverSection(nextSection, applyStepTransition(ctx, nextRef), analyticsMeta);
  delivered.analytics.unshift({
    type: 'step_completed',
    step: section.step,
    phase: ctx.phase,
    ...analyticsMeta,
  });
  return delivered;
}

function handlePermissionSection(section, inbound, ctx, analyticsMeta = {}) {
  if (isPermissionYes(inbound)) {
    logCareerStepCompleted({ phase: ctx.phase, step: section.step, ...analyticsMeta });
    logCareerPhaseCompleted({ phase: ctx.phase, ...analyticsMeta });

    const nextCtx = applyStepTransition(ctx, section.yesNext);
    nextCtx.phasesCompleted = [...(ctx.phasesCompleted || []), ctx.phase];
    nextCtx.awaiting = null;

    logCareerPhaseStarted({ phase: nextCtx.phase, ...analyticsMeta });

    const holdSection = getSectionConfig(nextCtx.phase, nextCtx.step);
    const transition = getMessage(section.yesReplyKey);
    const holdNote = holdSection ? getMessage(holdSection.contentKey) : '';
    const reply = holdNote ? `${transition}\n\n${holdNote}` : transition;

    return {
      reply,
      context: nextCtx,
      analytics: [
        { type: 'phase_completed', phase: ctx.phase, ...analyticsMeta },
        { type: 'phase_started', phase: nextCtx.phase, ...analyticsMeta },
      ],
    };
  }

  if (isPermissionNo(inbound)) {
    logCareerStepCompleted({ phase: ctx.phase, step: section.step, outcome: 'declined', ...analyticsMeta });
    const nextCtx = applyStepTransition(ctx, section.noNext);
    nextCtx.awaiting = null;
    return {
      reply: getMessage(section.noReplyKey),
      context: nextCtx,
      analytics: [{ type: 'step_completed', step: section.step, outcome: 'declined', ...analyticsMeta }],
    };
  }

  if (isCounsellingQuestion(inbound)) {
    const answer = answerCounsellingQuestion(inbound);
    logCareerResume({ phase: ctx.phase, step: ctx.step, reason: 'after_question', ...analyticsMeta });
    return {
      reply: `${answer}\n\n${getMessage(section.clarifyKey)}`,
      context: { ...ctx, awaiting: AWAITING.PERMISSION },
      analytics: [{ type: 'resume', phase: ctx.phase, step: ctx.step, ...analyticsMeta }],
    };
  }

  return {
    reply: getMessage(section.clarifyKey),
    context: { ...ctx, awaiting: AWAITING.PERMISSION },
    analytics: [],
  };
}

function handleHoldSection(section, inbound, ctx, analyticsMeta = {}) {
  if (section.reengageKey && isPermissionYes(inbound)) {
    const permission = getSectionConfig(1, 'phase1_permission');
    return deliverSection(permission, applyStepTransition(ctx, { phase: 1, step: 'phase1_permission' }), {
      ...analyticsMeta,
      reason: 'reengage',
    });
  }
  if (section.reengageKey) {
    return {
      reply: getMessage(section.reengageKey),
      context: ctx,
      analytics: [],
    };
  }
  return {
    reply: getMessage(section.contentKey),
    context: ctx,
    analytics: [],
  };
}

function processJourneyTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const isNewEntry = Boolean(opts.isNewEntry);
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };

  if (isNewEntry || !ctx.flow || !ctx.phase || !ctx.step) {
    ctx = initialContext();
    logCareerPhaseStarted({ phase: ctx.phase, ...analyticsMeta });
    const first = getSectionConfig(ctx.phase, ctx.step);
    const delivered = deliverSection(first, ctx, analyticsMeta);
    delivered.analytics.unshift({ type: 'phase_started', phase: ctx.phase, ...analyticsMeta });
    return { ...delivered, clearState: false };
  }

  if (isCareerCounsellingJourneyBreakout(inbound)) {
    return {
      reply: BREAKOUT_DEFLECTION,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  const section = getSectionConfig(ctx.phase, ctx.step);
  if (!section) {
    ctx = initialContext();
    logCareerPhaseStarted({ phase: ctx.phase, ...analyticsMeta });
    const first = getSectionConfig(ctx.phase, ctx.step);
    return { ...deliverSection(first, ctx, analyticsMeta), clearState: false };
  }

  if (section.type === 'hold') {
    return { ...handleHoldSection(section, inbound, ctx, analyticsMeta), clearState: false };
  }

  if (section.type === 'permission') {
    return { ...handlePermissionSection(section, inbound, ctx, analyticsMeta), clearState: false };
  }

  // Section awaiting user input
  if (isCounsellingQuestion(inbound)) {
    const answer = answerCounsellingQuestion(inbound);
    logCareerResume({ phase: ctx.phase, step: ctx.step, reason: 'after_question', ...analyticsMeta });
    return {
      reply: `${answer}${buildResumeSuffix(section)}`,
      context: { ...ctx, awaiting: AWAITING.ACK },
      clearState: false,
      analytics: [{ type: 'resume', phase: ctx.phase, step: ctx.step, ...analyticsMeta }],
    };
  }

  if (isAcknowledgment(inbound)) {
    return { ...advanceFromSection(section, ctx, analyticsMeta), clearState: false };
  }

  return {
    reply: getMessage('awaiting_ack_nudge'),
    context: { ...ctx, awaiting: AWAITING.ACK },
    clearState: false,
    analytics: [],
  };
}

module.exports = {
  FLOW_ID,
  AWAITING,
  initialContext,
  isAcknowledgment,
  processJourneyTurn,
  buildSectionDelivery,
};
