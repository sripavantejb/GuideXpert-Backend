'use strict';

/**
 * P0: every permission gate must advance on the FIRST valid affirmative.
 * Never require a second "yes" / "continue".
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  isPermissionAffirmative,
  isShortPermissionAckUtterance,
  stripInvisibleChars,
} = require('../services/chatbot/permissionAffirmative');
const {
  isExplorePermissionYes,
} = require('../constants/careerCounsellingV2ExploreModernColleges');
const {
  isPermissionYes: isEvalYes,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2EvaluationParser');
const {
  isPermissionYes: isPersYes,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2PersonalizationParser');
const {
  isPermissionYes: isShortlistYes,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2ShortlistingParser');
const {
  isComparePermissionYes,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2ComparisonParser');
const {
  isPhase9Continue,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2PersonalizedRecommendationParser');
const {
  isVisionContinue,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2FuturePathVisionParser');
const {
  isPhase12Continue,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2CounselingExperienceSelectionParser');
const {
  isPhase13BookNow,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2BookingOrchestratorParser');
const {
  STAGES,
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  setShortlistingEligibilityDeps,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');

const AFFIRM_VARIANTS = [
  'yes',
  'Yes',
  'yeah',
  'y',
  'sure',
  'ok',
  'okay',
  'continue',
  'proceed',
  "let's do it",
  'yes please',
  'yes\u200b',
  ' Yes ',
];

describe('permission affirmative shared detector', () => {
  test('accepts all required variants including zero-width chars', () => {
    for (const v of AFFIRM_VARIANTS) {
      assert.equal(isPermissionAffirmative(v), true, `should accept: ${JSON.stringify(v)}`);
      assert.equal(isExplorePermissionYes(v), true, `explore should accept: ${JSON.stringify(v)}`);
      assert.equal(isEvalYes(v), true);
      assert.equal(isPersYes(v), true);
      assert.equal(isShortlistYes(v), true);
      assert.equal(isComparePermissionYes(v), true);
      assert.equal(isPhase9Continue(v), true, `phase9 should accept bare yes: ${JSON.stringify(v)}`);
      assert.equal(isVisionContinue(v), true);
      assert.equal(isPhase12Continue(v), true);
    }
  });

  test('short acks are excluded from cross-turn utterance dedupe', () => {
    assert.equal(isShortPermissionAckUtterance('yes'), true);
    assert.equal(isShortPermissionAckUtterance('ok'), true);
    assert.equal(isShortPermissionAckUtterance('continue'), true);
    assert.equal(isShortPermissionAckUtterance('yes please'), true);
    assert.equal(isShortPermissionAckUtterance('tell me about NIAT placements in detail'), false);
  });

  test('stripInvisibleChars removes ZWSP', () => {
    assert.equal(stripInvisibleChars('yes\u200b'), 'yes');
  });

  test('book now matches booking permission', () => {
    assert.equal(isPhase13BookNow('book now'), true);
    assert.equal(isPhase13BookNow('Book'), true);
  });
});

describe('permission gates advance on ONE inbound', () => {
  const mockColleges = [
    {
      college_name: 'Hyderabad Tech University',
      college_address: 'Hyderabad',
      district_enum: 'HYDERABAD',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 180000,
          cutoff: 25000,
          reservation_categories: [{ cutoff_rank: 25000 }],
        },
      ],
    },
    {
      college_name: 'Andhra Engineering College',
      college_address: 'Visakhapatnam',
      district_enum: 'VISAKHAPATNAM',
      branches: [
        {
          branch_name: 'Information Technology',
          branch_code: 'INF',
          fee: 220000,
          cutoff: 32000,
          reservation_categories: [{ cutoff_rank: 32000 }],
        },
      ],
    },
    {
      college_name: 'Coastal Institute of Technology',
      college_address: 'Kakinada',
      district_enum: 'EAST GODAVARI',
      branches: [
        {
          branch_name: 'Electronics and Communication Engineering',
          branch_code: 'ECE',
          fee: 150000,
          cutoff: 40000,
          reservation_categories: [{ cutoff_rank: 40000 }],
        },
      ],
    },
    {
      college_name: 'Rayalaseema University College',
      college_address: 'Tirupati',
      district_enum: 'CHITTOOR',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 160000,
          cutoff: 45000,
          reservation_categories: [{ cutoff_rank: 45000 }],
        },
      ],
    },
    {
      college_name: 'Deccan Institute of Engineering',
      college_address: 'Hyderabad',
      district_enum: 'RANGAREDDY',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 170000,
          cutoff: 28000,
          reservation_categories: [{ cutoff_rank: 28000 }],
        },
      ],
    },
  ];

  test('Stage 3 evaluation: ONE yes leaves permission wait', async () => {
    let r = await handleCareerCounsellingMessage('yes', {
      flow: 'career_counselling_v2',
      version: 2,
      stage: 'evaluation_framework',
      step: 'eval_ask_permission',
      profile: {
        preferredCourse: 'B.Tech',
        careerGoal: 'Software engineer',
        evaluationPriorities: ['placements', 'coding culture'],
      },
    });
    assert.notEqual(r.context.step, 'eval_ask_permission');
  });

  test('Stage 5 explore: ONE yes advances to personalization', async () => {
    let r = await handleCareerCounsellingMessage('yes', {
      flow: 'career_counselling_v2',
      version: 2,
      stage: 'explore_modern_colleges',
      step: 'explore_ask_continue',
      profile: {
        preferredCourse: 'B.Tech',
        careerGoal: 'Software engineer',
        evaluationCompleted: true,
        explorePresented: true,
      },
    });
    assert.equal(r.context.stage, 'personalized_discovery');
    assert.notEqual(r.context.step, 'explore_ask_continue');
  });

  test('Stage 5 explore: yes\\u200b and yes please advance on first try', async () => {
    const baseCtx = {
      flow: 'career_counselling_v2',
      version: 2,
      stage: 'explore_modern_colleges',
      step: 'explore_ask_continue',
      profile: {
        preferredCourse: 'B.Tech',
        careerGoal: 'Software engineer',
        evaluationCompleted: true,
        explorePresented: true,
      },
    };
    let r = await handleCareerCounsellingMessage('yes\u200b', baseCtx);
    assert.equal(r.context.stage, 'personalized_discovery');

    r = await handleCareerCounsellingMessage('yes please', {
      ...baseCtx,
      step: 'explore_ask_continue',
    });
    assert.equal(r.context.stage, 'personalized_discovery');
  });

  test('Stage 7 shortlist: ONE yes enters comparison', async () => {
    setShortlistingEligibilityDeps({
      fetchCollegeDostColleges: async () => ({
        colleges: mockColleges,
        total_no_of_colleges: mockColleges.length,
      }),
    });
    let r = await handleCareerCounsellingMessage(
      'yes',
      {
        flow: 'career_counselling_v2',
        version: 2,
        stage: 'ai_shortlisting',
        step: 'shortlist_ask_compare',
        profile: {
          preferredCourse: 'B.Tech',
          careerGoal: 'Software engineer',
          careerPriority: 'placements',
          preferredLocation: 'Hyderabad',
          budgetPreference: 'ok',
          parentPreferences: 'supportive',
          counselingConfidenceScore: 80,
          evaluationCompleted: true,
          recommendedColleges: [
            { collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)', tier: 'best_match' },
            { collegeName: 'Scaler School of Technology', tier: 'strong_alternative' },
            { collegeName: 'Newton School of Technology', tier: 'strong_alternative' },
          ],
        },
      }
    );
    assert.equal(r.context.stage, STAGES.SMART_COMPARISON || 'smart_comparison');
    assert.equal(r.context.step, 'compare_ask_recommendation');
    setShortlistingEligibilityDeps({});
  });

  test('Stage 8 compare: ONE yes enters phase 9 recommendation', async () => {
    let r = await handleCareerCounsellingMessage('yes', {
      flow: 'career_counselling_v2',
      version: 2,
      stage: 'smart_comparison',
      step: 'compare_ask_recommendation',
      profile: {
        preferredCourse: 'B.Tech',
        careerGoal: 'Software engineer',
        preferredCollege: 'NIAT (NxtWave Institute of Advanced Technologies)',
        recommendedColleges: [
          {
            collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)',
            tier: 'best_match',
            _curatedTags: ['ai', 'projects'],
            _curatedWhy: 'AI-first curriculum',
          },
          { collegeName: 'Scaler School of Technology', tier: 'strong_alternative' },
        ],
        comparisonSummary: 'done',
        decisionConfidence: 80,
      },
    });
    assert.equal(r.context.stage, STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION);
  });

  test('Stage 9: ONE continue/yes enters vision', async () => {
    const ctx = {
      flow: 'career_counselling_v2',
      version: 2,
      stage: 'phase_9_personalized_recommendation',
      step: 'phase9_followup',
      profile: {
        preferredCourse: 'B.Tech',
        careerGoal: 'Software engineer',
        phase9Presented: true,
        phase9Recommendations: [
          {
            collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)',
            rankLabel: 'Best Match',
          },
        ],
        recommendedColleges: [
          { collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)', tier: 'best_match' },
        ],
      },
    };
    let r = await handleCareerCounsellingMessage('continue', ctx);
    assert.equal(r.context.stage, STAGES.PHASE_10_FUTURE_PATH_VISION);

    r = await handleCareerCounsellingMessage('yes', ctx);
    assert.equal(r.context.stage, STAGES.PHASE_10_FUTURE_PATH_VISION);
  });

  test('Stage 10: ONE continue enters hesitation', async () => {
    let r = await handleCareerCounsellingMessage('continue', {
      flow: 'career_counselling_v2',
      version: 2,
      stage: 'phase_10_future_path_vision',
      step: 'vision_followup',
      profile: {
        preferredCourse: 'B.Tech',
        careerGoal: 'Software engineer',
        phase10Presented: true,
        phase9Recommendations: [
          {
            collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)',
            rankLabel: 'Best Match',
          },
        ],
        recommendedColleges: [
          { collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)', tier: 'best_match' },
        ],
      },
    });
    assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
  });

  test('Counseling Phase 12: ONE continue enters booking with URL', async () => {
    let r = await handleCareerCounsellingMessage('continue', {
      flow: 'career_counselling_v2',
      version: 2,
      stage: 'phase_12_personalized_counseling_recommendation',
      step: 'counsel_rec_followup',
      profile: {
        preferredCourse: 'B.Tech',
        careerGoal: 'Software engineer',
        phase12Presented: true,
        phase12Service: 'one_on_one',
        recommendedColleges: [
          { collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)', tier: 'best_match' },
        ],
        phase9Recommendations: [
          {
            collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)',
            rankLabel: 'Best Match',
          },
        ],
      },
    });
    assert.equal(r.context.stage, STAGES.PHASE_13_BOOKING_ORCHESTRATOR);
    assert.equal(r.context.step, 'booking_presented');
    assert.match(r.reply, /https:\/\/www\.guidexpert\.co\.in\/one-on-one-session/);
  });

  test('Phase 12 ready immediately shares booking URL (no second confirm)', async () => {
    let r = await handleCareerCounsellingMessage('ready', {
      flow: 'career_counselling_v2',
      version: 2,
      stage: 'phase_12_personalized_counseling_recommendation',
      step: 'counsel_rec_followup',
      profile: {
        phase12Presented: true,
        phase12Service: 'one_on_one',
        recommendedColleges: [
          { collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)', tier: 'best_match' },
        ],
      },
    });
    assert.equal(r.context.step, 'booking_presented');
    assert.match(r.reply, /https:\/\/www\.guidexpert\.co\.in\/one-on-one-session/);
    assert.doesNotMatch(r.reply, /Wonderful\.|Booking happens on the GuideXpert website|Reply \*Book now\*/i);
  });

  test('Phase 13: ONE Book now shares URL', async () => {
    let r = await handleCareerCounsellingMessage('Book now', {
      flow: 'career_counselling_v2',
      version: 2,
      stage: 'phase_13_booking_orchestrator',
      step: 'booking_intro',
      profile: {
        phase12Service: 'one_on_one',
        phase13Service: 'one_on_one',
        phase13CtaPresented: true,
        phase13BookingUrl: 'https://www.guidexpert.co.in/one-on-one-session',
        recommendedColleges: [
          { collegeName: 'NIAT (NxtWave Institute of Advanced Technologies)', tier: 'best_match' },
        ],
      },
    });
    assert.equal(r.context.step, 'booking_presented');
    assert.match(r.reply, /one-on-one-session/i);
  });
});
