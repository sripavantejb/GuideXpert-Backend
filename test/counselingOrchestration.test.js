'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  selectCuratedInstitutions,
  processExploreModernCollegesTurn,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2ExploreModernCollegesEngine');
const {
  optimizeCareerCounsellingReply,
  MAX_LINES_NORMAL,
  nonEmptyLines,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2ResponseOptimizer');
const {
  composeCounselorReply,
  mapStageToRoadmapPhase,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2PhaseOrchestrator');
const {
  isCounselingBridgeIntent,
  seedCareerContextFromPredictor,
} = require('../services/chatbot/collegePredictorChatService');
const { mapStageToPhase } = require('../services/conversationRecovery/conversationRecoveryCore');

describe('counseling orchestration redesign', () => {
  test('optimizer caps normal replies to 5 lines', () => {
    const long = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'Ready?'].join('\n');
    const out = optimizeCareerCounsellingReply(long);
    assert.ok(nonEmptyLines(out.reply).length <= MAX_LINES_NORMAL);
    assert.match(out.reply, /\?/);
  });

  test('composeCounselorReply attaches orchestration metadata', () => {
    const composed = composeCounselorReply({
      reply: 'Got it.\nWhat is your current qualification?',
      context: {
        stage: 'discovery',
        step: 'awaiting_qualification',
        profile: { careerGoal: 'software' },
      },
    });
    assert.equal(composed.orchestration.currentPhase, 1);
    assert.ok(composed.context.profile.orchestration);
  });

  test('explore stage maps to roadmap phase 5', () => {
    assert.equal(mapStageToRoadmapPhase('explore_modern_colleges'), 5);
    assert.equal(mapStageToPhase('explore_modern_colleges'), 5);
  });

  test('curated catalog matches CSE interests', () => {
    const items = selectCuratedInstitutions({
      preferredCourse: 'B.Tech CSE',
      learningStyle: 'hands_on',
    });
    assert.ok(items.length >= 1);
  });

  test('personalization permission yes enters AI shortlisting', async () => {
    const {
      processPersonalizedDiscoveryTurn,
    } = require('../services/chatbot/careerCounselling/careerCounsellingV2PersonalizationEngine');
    const r = await processPersonalizedDiscoveryTurn(
      'yes',
      {
        flow: 'career_counselling_v2',
        version: 2,
        stage: 'personalized_discovery',
        step: 'pers_ask_permission',
        profile: { preferredCourse: 'CSE', careerPriority: 'skills' },
      },
      {}
    );
    // Explore already happened earlier in the interactive framework; permission yes
    // advances into eligibility shortlisting (not a second explore pass).
    assert.equal(r.context.stage, 'ai_shortlisting');
  });

  test('journey entry returns orchestration + capped reply', async () => {
    const r = await handleCareerCounsellingMessage('help me choose a college', {}, { isNewEntry: true });
    assert.ok(r.orchestration);
    assert.ok(nonEmptyLines(r.reply).length <= MAX_LINES_NORMAL);
  });

  test('college predictor bridge intent and seed', () => {
    assert.equal(isCounselingBridgeIntent('compare'), true);
    assert.equal(isCounselingBridgeIntent('SHOW MORE'), false);
    const seed = seedCareerContextFromPredictor({
      exam: 'TS_EAMCET',
      rank: 1000,
      resultCache: [
        { college_name: 'A', branches: [{ branch_name: 'CSE' }] },
        { college_name: 'B', branches: [{ branch_name: 'ECE' }] },
      ],
    });
    assert.equal(seed.stage, 'personalized_discovery');
    assert.equal(seed.profile.bridgedFromCollegePredictor, true);
    assert.equal(seed.profile.recommendedColleges.length, 2);
    assert.equal(seed.profile.rank, 1000);
  });

  test('explore presentImmediately stores institutions', async () => {
    const r = await processExploreModernCollegesTurn(
      'yes',
      {
        flow: 'career_counselling_v2',
        version: 2,
        profile: { preferredCourse: 'engineering', learningStyle: 'projects' },
      },
      { startExploreModernColleges: true, presentImmediately: true, fromPersonalization: true }
    );
    assert.equal(r.context.profile.exploreModernInstitutions.length, 5);
    assert.equal(r.keepIntact, true);
  });
});
