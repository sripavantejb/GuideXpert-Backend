'use strict';

const { logChatbotEvent } = require('../chatbotStructuredLog');

const PIPELINE = 'career_counselling_v2';

function logCareerCounsellingV2Event(event, fields = {}) {
  logChatbotEvent(event, {
    pipeline: PIPELINE,
    discoveryStage: fields.stage ?? null,
    discoveryStep: fields.step ?? null,
    profileCompletionPct: fields.profileCompletionPct ?? null,
    ...fields,
  });
}

function logDiscoveryStarted(fields) {
  logCareerCounsellingV2Event('discovery_started', fields);
}

function logDiscoveryQuestionAnswered(fields) {
  logCareerCounsellingV2Event('discovery_question_answered', fields);
}

function logProfileUpdated(fields) {
  logCareerCounsellingV2Event('profile_updated', fields);
}

function logDiscoveryCompleted(fields) {
  logCareerCounsellingV2Event('discovery_completed', fields);
}

function logEvaluationStarted(fields) {
  logCareerCounsellingV2Event('evaluation_started', fields);
}

function logEvaluationTopicViewed(fields) {
  logCareerCounsellingV2Event('evaluation_topic_viewed', fields);
}

function logEvaluationPrioritySelected(fields) {
  logCareerCounsellingV2Event('evaluation_priority_selected', fields);
}

function logEvaluationCompleted(fields) {
  logCareerCounsellingV2Event('evaluation_completed', fields);
}

function logMindsetShiftCompleted(fields) {
  logCareerCounsellingV2Event('mindset_shift_completed', fields);
}

function logModernEducationStarted(fields) {
  logCareerCounsellingV2Event('modern_education_started', fields);
}

function logModernTopicViewed(fields) {
  logCareerCounsellingV2Event('modern_topic_viewed', fields);
}

function logLearningPreferenceSelected(fields) {
  logCareerCounsellingV2Event('learning_preference_selected', fields);
}

function logLearningStyleIdentified(fields) {
  logCareerCounsellingV2Event('learning_style_identified', fields);
}

function logModernEducationCompleted(fields) {
  logCareerCounsellingV2Event('modern_education_completed', fields);
}

function logPersonalizationStarted(fields) {
  logCareerCounsellingV2Event('personalization_started', fields);
}

function logCareerPriorityCaptured(fields) {
  logCareerCounsellingV2Event('career_priority_captured', fields);
}

function logLocationPreferenceCaptured(fields) {
  logCareerCounsellingV2Event('location_preference_captured', fields);
}

function logBudgetPreferenceCaptured(fields) {
  logCareerCounsellingV2Event('budget_preference_captured', fields);
}

function logParentPreferencesCaptured(fields) {
  logCareerCounsellingV2Event('parent_preferences_captured', fields);
}

function logConcernCaptured(fields) {
  logCareerCounsellingV2Event('concern_captured', fields);
}

function logCounselingProfileCompleted(fields) {
  logCareerCounsellingV2Event('counseling_profile_completed', fields);
}

function logCounselingConfidenceCalculated(fields) {
  logCareerCounsellingV2Event('counseling_confidence_calculated', fields);
}

function logCareerDropoff(fields) {
  logCareerCounsellingV2Event('career_dropoff', fields);
}

function logCareerInterruption(fields) {
  logCareerCounsellingV2Event('career_interruption', fields);
}

function logShortlistStarted(fields) {
  logCareerCounsellingV2Event('shortlist_started', fields);
}

function logEligibilityRetrieved(fields) {
  logCareerCounsellingV2Event('eligibility_retrieved', fields);
}

function logRecommendationGenerated(fields) {
  logCareerCounsellingV2Event('recommendation_generated', fields);
}

function logRecommendationViewed(fields) {
  logCareerCounsellingV2Event('recommendation_viewed', fields);
}

function logRecommendationReasonViewed(fields) {
  logCareerCounsellingV2Event('recommendation_reason_viewed', fields);
}

function logRecommendationConfidence(fields) {
  logCareerCounsellingV2Event('recommendation_confidence', fields);
}

function logShortlistCompleted(fields) {
  logCareerCounsellingV2Event('shortlist_completed', fields);
}

function logComparisonStarted(fields) {
  logCareerCounsellingV2Event('comparison_started', fields);
}

function logCollegesSelectedForComparison(fields) {
  logCareerCounsellingV2Event('colleges_selected_for_comparison', fields);
}

function logComparisonDimensionViewed(fields) {
  logCareerCounsellingV2Event('comparison_dimension_viewed', fields);
}

function logComparisonCompleted(fields) {
  logCareerCounsellingV2Event('comparison_completed', fields);
}

function logFollowupQuestionAsked(fields) {
  logCareerCounsellingV2Event('followup_question_asked', fields);
}

function logDecisionConfidenceCalculated(fields) {
  logCareerCounsellingV2Event('decision_confidence_calculated', fields);
}

function logPreferredCollegeIdentified(fields) {
  logCareerCounsellingV2Event('preferred_college_identified', fields);
}

function logConcernResolutionStarted(fields) {
  logCareerCounsellingV2Event('concern_resolution_started', fields);
}

function logConcernIdentified(fields) {
  logCareerCounsellingV2Event('concern_identified', fields);
}

function logConcernCategoryDetected(fields) {
  logCareerCounsellingV2Event('concern_category_detected', fields);
}

function logConcernAnswered(fields) {
  logCareerCounsellingV2Event('concern_answered', fields);
}

function logConcernResolved(fields) {
  logCareerCounsellingV2Event('concern_resolved', fields);
}

function logConcernReopened(fields) {
  logCareerCounsellingV2Event('concern_reopened', fields);
}

function logDecisionReadinessCalculated(fields) {
  logCareerCounsellingV2Event('decision_readiness_calculated', fields);
}

function logCounselingInvitationStarted(fields) {
  logCareerCounsellingV2Event('counseling_invitation_started', fields);
}

function logCounselingInvitationShown(fields) {
  logCareerCounsellingV2Event('counseling_invitation_shown', fields);
}

function logCounselingInvitationAccepted(fields) {
  logCareerCounsellingV2Event('counseling_invitation_accepted', fields);
}

function logCounselingInvitationDeclined(fields) {
  logCareerCounsellingV2Event('counseling_invitation_declined', fields);
}

function logCounselingInvitationDeferred(fields) {
  logCareerCounsellingV2Event('counseling_invitation_deferred', fields);
}

function logPhase9RecommendationStarted(fields) {
  logCareerCounsellingV2Event('phase9_recommendation_started', fields);
}

function logPhase9RecommendationSynthesized(fields) {
  logCareerCounsellingV2Event('phase9_recommendation_synthesized', fields);
}

function logPhase9RecommendationPresented(fields) {
  logCareerCounsellingV2Event('phase9_recommendation_presented', fields);
}

function logPhase9RecommendationContinued(fields) {
  logCareerCounsellingV2Event('phase9_recommendation_continued', fields);
}

function logPhase10VisionStarted(fields) {
  logCareerCounsellingV2Event('phase10_vision_started', fields);
}

function logPhase10VisionPresented(fields) {
  logCareerCounsellingV2Event('phase10_vision_presented', fields);
}

function logPhase10VisionContinued(fields) {
  logCareerCounsellingV2Event('phase10_vision_continued', fields);
}

function logPhase11HesitationStarted(fields) {
  logCareerCounsellingV2Event('phase11_hesitation_started', fields);
}

/** Frozen funnel: hesitation identified (taxonomy match). */
function logPhase11HesitationDetected(fields) {
  logCareerCounsellingV2Event('phase11_hesitation_detected', fields);
}

function logPhase11HesitationIdentified(fields) {
  logCareerCounsellingV2Event('phase11_hesitation_identified', fields);
  // Dual-emit: production funnel contract uses phase11_hesitation_detected
  logPhase11HesitationDetected(fields);
}

function logPhase11HesitationResponded(fields) {
  logCareerCounsellingV2Event('phase11_hesitation_responded', fields);
}

function logPhase11HesitationResolved(fields) {
  logCareerCounsellingV2Event('phase11_hesitation_resolved', fields);
}

function logPhase11HesitationContinued(fields) {
  logCareerCounsellingV2Event('phase11_hesitation_continued', fields);
}

/**
 * Frozen funnel: One-on-One recommended.
 * @param {object} fields — must include source: 'phase11_hesitation' | 'niat_interest'
 */
function logOneOnOneRecommended(fields) {
  logCareerCounsellingV2Event('one_on_one_recommended', {
    source: fields?.source || null,
    ...fields,
  });
}

/** @deprecated Prefer logOneOnOneRecommended({ source: 'phase11_hesitation' }) — kept for lifecycle dual-emit. */
function logPhase11EscalationRecommended(fields) {
  logCareerCounsellingV2Event('phase11_escalation_recommended', fields);
  logOneOnOneRecommended({
    source: 'phase11_hesitation',
    ...fields,
  });
}

function logNiatInterestDetected(fields) {
  logCareerCounsellingV2Event('niat_interest_detected', fields);
}

/** @deprecated Prefer logOneOnOneRecommended({ source: 'niat_interest' }) — dual-emits frozen contract. */
function logNiatOneOnOneRecommended(fields) {
  logCareerCounsellingV2Event('niat_one_on_one_recommended', fields);
  logOneOnOneRecommended({
    source: 'niat_interest',
    ...fields,
  });
}

/** Frozen: click webhook when available. */
function logOneOnOneLinkClicked(fields) {
  const source = fields?.source || null;
  logCareerCounsellingV2Event('one_on_one_link_clicked', { source, ...fields });
  if (source === 'niat_interest' || source === 'phase11_hesitation') {
    // NIAT-named alias retained for NIAT funnel dashboards
    if (source === 'niat_interest') {
      logCareerCounsellingV2Event('niat_one_on_one_link_clicked', fields);
    }
  }
}

/** @deprecated Prefer logOneOnOneLinkClicked({ source: 'niat_interest' }) */
function logNiatOneOnOneLinkClicked(fields) {
  logOneOnOneLinkClicked({ source: 'niat_interest', ...fields });
}

/** Frozen: form submit webhook when integration available. */
function logOneOnOneFormSubmitted(fields) {
  logCareerCounsellingV2Event('one_on_one_form_submitted', {
    source: fields?.source || null,
    ...fields,
  });
}

function logPhase12Started(fields) {
  logCareerCounsellingV2Event('phase12_started', fields);
}

function logPhase12ServiceSelected(fields) {
  logCareerCounsellingV2Event('phase12_service_selected', fields);
}

function logPhase12Presented(fields) {
  logCareerCounsellingV2Event('phase12_presented', fields);
}

function logPhase12Continue(fields) {
  logCareerCounsellingV2Event('phase12_continue', fields);
}

function logPhase12Declined(fields) {
  logCareerCounsellingV2Event('phase12_declined', fields);
}

function logPhase12Skipped(fields) {
  logCareerCounsellingV2Event('phase12_skipped', fields);
}

function logPhase13Started(fields) {
  logCareerCounsellingV2Event('phase13_started', fields);
}

function logBookingServiceSelected(fields) {
  logCareerCounsellingV2Event('booking_service_selected', fields);
}

function logBookingCtaPresented(fields) {
  logCareerCounsellingV2Event('booking_cta_presented', fields);
}

function logBookingContinue(fields) {
  logCareerCounsellingV2Event('booking_continue', fields);
}

function logBookingUrlShared(fields) {
  logCareerCounsellingV2Event('booking_url_shared', fields);
}

function logBookingResume(fields) {
  logCareerCounsellingV2Event('booking_resume', fields);
}

function logBookingDeferred(fields) {
  logCareerCounsellingV2Event('booking_deferred', fields);
}

function logBookingAbandoned(fields) {
  logCareerCounsellingV2Event('booking_abandoned', fields);
}

/** Student form-Done ack — unlocks post-booking assist (P0 release). */
function logBookingCompleted(fields) {
  logCareerCounsellingV2Event('booking_completed', fields);
}

function logJourneyCompleted(fields) {
  logCareerCounsellingV2Event('journey_completed', fields);
}

function logJourneyOutcome(fields) {
  logCareerCounsellingV2Event('journey_outcome', fields);
}

function logJourneyDuration(fields) {
  logCareerCounsellingV2Event('journey_duration', fields);
}

function logJourneyInteractions(fields) {
  logCareerCounsellingV2Event('journey_interactions', fields);
}

function logPlatformHandoffCreated(fields) {
  logCareerCounsellingV2Event('platform_handoff_created', fields);
}

function logBookingStatusFinal(fields) {
  logCareerCounsellingV2Event('booking_status_final', fields);
}

module.exports = {
  logDiscoveryStarted,
  logDiscoveryQuestionAnswered,
  logProfileUpdated,
  logDiscoveryCompleted,
  logEvaluationStarted,
  logEvaluationTopicViewed,
  logEvaluationPrioritySelected,
  logEvaluationCompleted,
  logMindsetShiftCompleted,
  logModernEducationStarted,
  logModernTopicViewed,
  logLearningPreferenceSelected,
  logLearningStyleIdentified,
  logModernEducationCompleted,
  logPersonalizationStarted,
  logCareerPriorityCaptured,
  logLocationPreferenceCaptured,
  logBudgetPreferenceCaptured,
  logParentPreferencesCaptured,
  logConcernCaptured,
  logCounselingProfileCompleted,
  logCounselingConfidenceCalculated,
  logCareerDropoff,
  logCareerInterruption,
  logShortlistStarted,
  logEligibilityRetrieved,
  logRecommendationGenerated,
  logRecommendationViewed,
  logRecommendationReasonViewed,
  logRecommendationConfidence,
  logShortlistCompleted,
  logComparisonStarted,
  logCollegesSelectedForComparison,
  logComparisonDimensionViewed,
  logComparisonCompleted,
  logFollowupQuestionAsked,
  logDecisionConfidenceCalculated,
  logPreferredCollegeIdentified,
  logConcernResolutionStarted,
  logConcernIdentified,
  logConcernCategoryDetected,
  logConcernAnswered,
  logConcernResolved,
  logConcernReopened,
  logDecisionReadinessCalculated,
  logCounselingInvitationStarted,
  logCounselingInvitationShown,
  logCounselingInvitationAccepted,
  logCounselingInvitationDeclined,
  logCounselingInvitationDeferred,
  logPhase9RecommendationStarted,
  logPhase9RecommendationSynthesized,
  logPhase9RecommendationPresented,
  logPhase9RecommendationContinued,
  logPhase10VisionStarted,
  logPhase10VisionPresented,
  logPhase10VisionContinued,
  logPhase11HesitationStarted,
  logPhase11HesitationDetected,
  logPhase11HesitationIdentified,
  logPhase11HesitationResponded,
  logPhase11HesitationResolved,
  logPhase11HesitationContinued,
  logPhase11EscalationRecommended,
  logOneOnOneRecommended,
  logOneOnOneLinkClicked,
  logOneOnOneFormSubmitted,
  logNiatInterestDetected,
  logNiatOneOnOneRecommended,
  logNiatOneOnOneLinkClicked,
  logPhase12Started,
  logPhase12ServiceSelected,
  logPhase12Presented,
  logPhase12Continue,
  logPhase12Declined,
  logPhase12Skipped,
  logPhase13Started,
  logBookingServiceSelected,
  logBookingCtaPresented,
  logBookingContinue,
  logBookingUrlShared,
  logBookingResume,
  logBookingDeferred,
  logBookingAbandoned,
  logBookingCompleted,
  logJourneyCompleted,
  logJourneyOutcome,
  logJourneyDuration,
  logJourneyInteractions,
  logPlatformHandoffCreated,
  logBookingStatusFinal,
};
