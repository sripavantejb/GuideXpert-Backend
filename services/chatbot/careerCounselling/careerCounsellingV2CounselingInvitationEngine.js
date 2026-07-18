'use strict';

const {
  STAGES,
  INVITATION_STEPS,
  INVITATION_ENGINE_VERSION,
  READINESS_BANDS,
  getInviteMessage,
} = require('../../../constants/careerCounsellingV2CounselingInvitation');
const { BREAKOUT_DEFLECTION } = require('../../../constants/careerCounsellingJourney');
const { isCareerCounsellingJourneyBreakout } = require('./careerCounsellingIntentService');
const { isSocialGreetingOnly } = require('./careerCounsellingV2ResponseParser');
const { bookingPageUrl } = require('../bookingContext/bookingContextResolver');
const {
  isInvitationAccept,
  isInvitationDefer,
  isInvitationDecline,
  isInvitationQuestion,
} = require('./careerCounsellingV2CounselingInvitationParser');
const { calculateDecisionReadiness } = require('./careerCounsellingV2ConcernResolutionCore');
const {
  logCounselingInvitationStarted,
  logCounselingInvitationShown,
  logCounselingInvitationAccepted,
  logCounselingInvitationDeclined,
  logCounselingInvitationDeferred,
  logProfileUpdated,
} = require('./careerCounsellingV2Analytics');

function evaluateReadiness(profile = {}) {
  let score = Number(profile.decisionReadiness);
  if (!Number.isFinite(score)) {
    score = calculateDecisionReadiness(profile);
  }

  let band = READINESS_BANDS.EXPLORING;
  if (score >= 70) band = READINESS_BANDS.READY;
  else if (score >= 50) band = READINESS_BANDS.NEARLY_READY;

  return { decisionReadiness: score, readinessBand: band };
}

function journeyHighlights(profile = {}) {
  const bits = [];
  if (profile.preferredCourse) bits.push(`course interest (${profile.preferredCourse})`);
  if (profile.careerPriority) bits.push(`career priority (${profile.careerPriority})`);
  if (Array.isArray(profile.recommendedColleges) && profile.recommendedColleges.length > 0) {
    bits.push('a personalized shortlist');
  }
  if (profile.preferredCollege) bits.push(`a comparison lean toward ${profile.preferredCollege}`);
  if (Array.isArray(profile.resolvedConcerns) && profile.resolvedConcerns.length > 0) {
    bits.push(`addressed concerns (${profile.resolvedConcerns.slice(0, 3).join(', ')})`);
  }
  if (bits.length === 0) {
    return 'the counseling steps you completed in this conversation';
  }
  return bits.slice(0, 4).join(', ');
}

function buildPersonalizedInvitation(profile, readiness, url) {
  const highlights = journeyHighlights(profile);
  const lines = [];

  lines.push(`You’ve already covered ${highlights}.`);
  lines.push('');

  if (readiness.readinessBand === READINESS_BANDS.READY) {
    lines.push('You’re ready for deeper, institution-specific help from a counsellor.');
  } else if (readiness.readinessBand === READINESS_BANDS.NEARLY_READY) {
    lines.push('A counsellor can help tighten the last trade-offs.');
  } else {
    lines.push('A counsellor can help sort next steps with your profile as context.');
  }

  lines.push('');
  lines.push('They can help with:');
  lines.push('✅ Institution-specific guidance');
  lines.push('✅ Admissions clarity');
  lines.push('✅ Scholarships & next steps');
  lines.push('');
  lines.push('Optional — your AI journey already helps.');
  lines.push('');
  lines.push('Website booking only (not WhatsApp):');
  lines.push(url);
  lines.push('');
  lines.push(getInviteMessage('choice_prompt', url));

  return lines.join('\n');
}

function answerInviteQuestion(inbound, profile, url) {
  const t = String(inbound || '').toLowerCase();
  if (/\bbook|website|link|how (do|to) (i )?book/i.test(t)) {
    return [
      'Bookings are created only on the GuideXpert website — I cannot book inside WhatsApp.',
      '',
      url,
      '',
      getInviteMessage('choice_prompt', url),
    ].join('\n');
  }
  if (/\bwhy|value|human|counsellor|counselor/i.test(t)) {
    return [
      `A counsellor can take what you already built (${journeyHighlights(profile)}) and help with institution-specific guidance, admissions process questions, scholarships, and concrete next steps.`,
      '',
      'It stays optional. Website booking link:',
      url,
      '',
      getInviteMessage('choice_prompt', url),
    ].join('\n');
  }
  if (/\bshortlist|compare|verdict|college/i.test(t)) {
    return [
      profile.preferredCollege
        ? `From this journey, your comparison lean was ${profile.preferredCollege}. A counsellor can validate institution-specific fit around that lean.`
        : 'Your shortlist and comparison from this journey remain the base for any human session.',
      '',
      getInviteMessage('question_fallback', url),
    ].join('\n');
  }
  return getInviteMessage('question_fallback', url);
}

function completeConversation(ctx, profilePatch, reply, analyticsType, analyticsMeta = {}) {
  const profile = {
    ...(ctx.profile || {}),
    ...profilePatch,
    counselingInvitationShown: true,
    invitationEngineVersion: INVITATION_ENGINE_VERSION,
  };

  logProfileUpdated({
    stage: STAGES.CONVERSATION_COMPLETE,
    fieldsUpdated: Object.keys(profilePatch || {}),
    ...analyticsMeta,
  });

  return {
    reply,
    context: {
      ...ctx,
      stage: STAGES.CONVERSATION_COMPLETE,
      step: 'conversation_complete',
      profile,
      lastQuestionKey: 'conversation_complete',
      conversationCompletedAt: new Date().toISOString(),
    },
    clearState: false,
    analytics: [{ type: analyticsType }],
  };
}

function startCounselingInvitation(ctx, analyticsMeta = {}) {
  const profile = { ...(ctx.profile || {}) };
  const readiness = evaluateReadiness(profile);
  const url = bookingPageUrl();
  const reply = buildPersonalizedInvitation(
    { ...profile, decisionReadiness: readiness.decisionReadiness },
    readiness,
    url
  );

  logCounselingInvitationStarted({
    stage: STAGES.COUNSELING_INVITATION,
    decisionReadiness: readiness.decisionReadiness,
    readinessBand: readiness.readinessBand,
    ...analyticsMeta,
  });
  logCounselingInvitationShown({
    stage: STAGES.COUNSELING_INVITATION,
    decisionReadiness: readiness.decisionReadiness,
    readinessBand: readiness.readinessBand,
    bookingPageUrl: url,
    ...analyticsMeta,
  });

  const nextProfile = {
    ...profile,
    decisionReadiness: readiness.decisionReadiness,
    counselingInvitationShown: true,
    counselingInvitationAccepted: false,
    counselingInvitationDeclined: false,
    counselingInvitationDeferred: false,
    handoffReason: null,
    invitationEngineVersion: INVITATION_ENGINE_VERSION,
  };

  logProfileUpdated({
    stage: STAGES.COUNSELING_INVITATION,
    fieldsUpdated: ['counselingInvitationShown', 'decisionReadiness'],
    ...analyticsMeta,
  });

  return {
    reply,
    context: {
      ...ctx,
      stage: STAGES.COUNSELING_INVITATION,
      step: 'invite_offer',
      profile: nextProfile,
      lastQuestionKey: 'invite_offer',
      readinessBand: readiness.readinessBand,
      invitationStartedAt: new Date().toISOString(),
    },
    clearState: false,
    analytics: [
      { type: 'counseling_invitation_started' },
      { type: 'counseling_invitation_shown' },
    ],
  };
}

async function processCounselingInvitationTurn(text, context = {}, opts = {}) {
  const inbound = String(text || '').trim();
  const analyticsMeta = opts.analytics || {};
  let ctx = { ...context };
  const url = bookingPageUrl();

  if (
    opts.startCounselingInvitation ||
    ctx.step === 'counseling_invitation_placeholder' ||
    (ctx.stage === STAGES.COUNSELING_INVITATION &&
      !INVITATION_STEPS.includes(ctx.step) &&
      ctx.step !== 'conversation_complete')
  ) {
    return startCounselingInvitation(ctx, analyticsMeta);
  }

  if (ctx.stage === STAGES.CONVERSATION_COMPLETE || ctx.step === 'conversation_complete') {
    return {
      reply: getInviteMessage('complete_sticky', url),
      context: {
        ...ctx,
        stage: STAGES.CONVERSATION_COMPLETE,
        step: 'conversation_complete',
      },
      clearState: false,
      analytics: [],
    };
  }

  if (isCareerCounsellingJourneyBreakout(inbound)) {
    return {
      reply: BREAKOUT_DEFLECTION,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (isSocialGreetingOnly(inbound)) {
    return {
      reply: `${getInviteMessage('greeting_mid', url)}\n\n${getInviteMessage('awaiting_ack_nudge', url)}`,
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  if (ctx.step === 'invite_offer' || ctx.step === 'invite_questions') {
    if (isInvitationAccept(inbound)) {
      logCounselingInvitationAccepted({
        stage: STAGES.COUNSELING_INVITATION,
        bookingPageUrl: url,
        ...analyticsMeta,
      });
      return completeConversation(
        ctx,
        {
          counselingInvitationAccepted: true,
          counselingInvitationDeclined: false,
          counselingInvitationDeferred: false,
          handoffReason: 'accepted_website_cta',
        },
        getInviteMessage('accepted', url),
        'counseling_invitation_accepted',
        analyticsMeta
      );
    }

    if (isInvitationDefer(inbound)) {
      logCounselingInvitationDeferred({
        stage: STAGES.COUNSELING_INVITATION,
        bookingPageUrl: url,
        ...analyticsMeta,
      });
      return completeConversation(
        ctx,
        {
          counselingInvitationDeferred: true,
          counselingInvitationAccepted: false,
          counselingInvitationDeclined: false,
          handoffReason: 'deferred',
        },
        getInviteMessage('deferred', url),
        'counseling_invitation_deferred',
        analyticsMeta
      );
    }

    if (isInvitationDecline(inbound)) {
      logCounselingInvitationDeclined({
        stage: STAGES.COUNSELING_INVITATION,
        ...analyticsMeta,
      });
      return completeConversation(
        ctx,
        {
          counselingInvitationDeclined: true,
          counselingInvitationAccepted: false,
          counselingInvitationDeferred: false,
          handoffReason: 'declined',
        },
        getInviteMessage('declined', url),
        'counseling_invitation_declined',
        analyticsMeta
      );
    }

    if (isInvitationQuestion(inbound) || inbound.length >= 4) {
      return {
        reply: answerInviteQuestion(inbound, ctx.profile || {}, url),
        context: {
          ...ctx,
          stage: STAGES.COUNSELING_INVITATION,
          step: 'invite_questions',
          lastQuestionKey: 'invite_questions',
        },
        clearState: false,
        analytics: [{ type: 'invitation_followup_question' }],
      };
    }

    return {
      reply: getInviteMessage('clarify_choice', url),
      context: ctx,
      clearState: false,
      analytics: [],
    };
  }

  return startCounselingInvitation(ctx, analyticsMeta);
}

module.exports = {
  STAGES,
  INVITATION_STEPS,
  startCounselingInvitation,
  processCounselingInvitationTurn,
  evaluateReadiness,
  buildPersonalizedInvitation,
};
