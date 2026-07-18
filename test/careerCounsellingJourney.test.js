'use strict';

const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  classifyIntent,
  isCareerCounsellingJourneyEntryQuery,
} = require('../services/chatbot/intentClassifierService');
const {
  handleCareerCounsellingMessage,
  STAGES,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  isCareerCounsellingJourneyBreakout,
} = require('../services/chatbot/careerCounselling/careerCounsellingIntentService');
const { isGuidedFlowInterrupt } = require('../services/chatbot/guidedFlows/guidedFlowInterruptPolicy');
const {
  getGuidedFlowByBotState,
  getGuidedFlowByIntent,
  shouldBypassScopeFirewall,
} = require('../services/chatbot/guidedFlows/guidedFlowRegistry');
const {
  processInbound,
  setChatbotOrchestratorTestHooks,
} = require('../services/chatbot/chatbotOrchestratorService');
const { getMessage } = require('../constants/careerCounsellingV2Discovery');

const CONVERSATION_ID = new mongoose.Types.ObjectId();
const PHONE = '9876543210';

describe('careerCounsellingIntentService', () => {
  const entries = [
    'I need counselling',
    'Help me choose a college',
    'Suggest a college',
    'Which college should I join?',
    'I am confused after Intermediate',
    'Career guidance',
    'Admission guidance',
    'Help me choose my future',
    'I need career guidance',
    'I am confused',
    'Please help',
    "I don't know which college to choose",
  ];

  for (const text of entries) {
    test(`entry: "${text}"`, () => {
      assert.equal(isCareerCounsellingJourneyEntryQuery(text), true);
      const result = classifyIntent(text, null, 'unknown', text);
      assert.equal(result.intent, 'career_counselling_journey');
    });
  }

  test('rank + branch query stays on college predictor', async () => {
    const text = 'Can I get CSE with rank 20000';
    assert.equal(isCareerCounsellingJourneyEntryQuery(text), false);
    const result = classifyIntent(text, null, 'unknown', text);
    assert.equal(result.intent, 'college_predictor');
  });

  test('breakout during journey for rank predictor phrase', async () => {
    assert.equal(isCareerCounsellingJourneyBreakout('predict my rank for JEE Main 85'), true);
  });
});

describe('careerCounsellingV2 discovery engine', () => {
  test('new entry starts discovery with greeting, intro, and qualification question', async () => {
    const r = await handleCareerCounsellingMessage('I need counselling', {}, { isNewEntry: true });
    assert.match(r.reply, /Hello!/i);
    assert.match(r.reply, /admissions counsellor/i);
    assert.match(r.reply, /current qualification/i);
    assert.equal(r.context.flow, 'career_counselling_v2');
    assert.equal(r.context.version, 2);
    assert.equal(r.context.stage, STAGES.DISCOVERY);
    assert.equal(r.context.step, 'awaiting_qualification');
    assert.equal(r.context.profile.profileCompletionPct, 0);
    assert.equal(r.clearState, false);
  });

  test('full discovery flow builds profile and starts evaluation masterclass', async () => {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });

    r = await handleCareerCounsellingMessage('Class 12 MPC', r.context);
    assert.match(r.reply, /Got it|Perfect|Nice|Noted/i);
    assert.match(r.reply, /course or field/i);
    assert.equal(r.context.step, 'awaiting_course');
    assert.equal(r.context.profile.currentQualification, 'Intermediate (+2)');

    r = await handleCareerCounsellingMessage('B.Tech engineering', r.context);
    assert.equal(r.context.step, 'awaiting_career_goal');
    assert.equal(r.context.profile.preferredCourse, 'B.Tech / Engineering');

    r = await handleCareerCounsellingMessage('Software engineer at a product company', r.context);
    assert.equal(r.context.step, 'awaiting_shortlist');
    assert.match(r.context.profile.careerGoal, /Software engineer/i);

    r = await handleCareerCounsellingMessage('JNTUK Kakinada, AU Vizag', r.context);
    assert.equal(r.context.step, 'awaiting_language');
    assert.equal(r.context.profile.preferredColleges.length, 2);

    r = await handleCareerCounsellingMessage('Telugu', r.context);
    assert.equal(r.context.stage, STAGES.EVALUATION_FRAMEWORK);
    assert.equal(r.context.step, 'eval_transition');
    assert.match(r.reply, /solid picture of your profile/i);
    assert.match(r.reply, /evaluate/i);
    assert.match(r.reply, /B\.Tech|Software engineer|colleges you already mentioned/i);
    assert.equal(r.context.profile.preferredLanguage, 'Telugu');
    assert.equal(r.context.profile.profileCompletionPct, 100);
    assert.equal(r.context.profile.evaluationCompleted, false);
    assert.equal(r.clearState, false);
  });

  test('skip shortlist and language still completes discovery', async () => {
    let r = await handleCareerCounsellingMessage('Help me choose a college', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('12th standard', r.context);
    r = await handleCareerCounsellingMessage('Engineering', r.context);
    r = await handleCareerCounsellingMessage('AI and data science roles', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    assert.equal(r.context.step, 'awaiting_language');
    r = await handleCareerCounsellingMessage('skip', r.context);
    assert.equal(r.context.stage, STAGES.EVALUATION_FRAMEWORK);
    assert.equal(r.context.step, 'eval_transition');
  });

  test('mid-journey greeting repeats current question', async () => {
    let r = await handleCareerCounsellingMessage('I am confused', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('hello', r.context);
    assert.match(r.reply, /continue from where we left off/i);
    assert.match(r.reply, /current qualification/i);
    assert.equal(r.context.step, 'awaiting_qualification');
  });

  test('breakout request deflects without advancing', async () => {
    let r = await handleCareerCounsellingMessage('I am confused', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('predict my rank for JEE Main 85', r.context);
    assert.match(r.reply, /help with that separately/i);
    assert.equal(r.context.step, 'awaiting_qualification');
  });

  test('invalid answer nudges with clarify without advancing', async () => {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('??', r.context);
    assert.match(r.reply, /current class or qualification/i);
    assert.equal(r.context.step, 'awaiting_qualification');
  });

  test('messages are configurable via V2 constants', async () => {
    assert.match(getMessage('greeting'), /Hello!/i);
    assert.match(getMessage('ask_qualification'), /current qualification/i);
  });
});

describe('careerCounsellingV2 evaluation masterclass', () => {
  async function completeDiscovery() {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage('B.Tech', r.context);
    r = await handleCareerCounsellingMessage('Software engineer', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    r = await handleCareerCounsellingMessage('English', r.context);
    return r;
  }

  test('full evaluation flow persists priorities and starts modern education phase', async () => {
    let r = await completeDiscovery();
    assert.equal(r.context.step, 'eval_transition');

    r = await handleCareerCounsellingMessage('ok', r.context);
    assert.equal(r.context.step, 'eval_common_mistakes');
    assert.match(r.reply, /friends are going/i);

    r = await handleCareerCounsellingMessage('yes familiar', r.context);
    assert.equal(r.context.step, 'eval_framework');
    assert.match(r.reply, /Curriculum relevance/i);

    r = await handleCareerCounsellingMessage('continue', r.context);
    assert.equal(r.context.step, 'eval_comparison');
    assert.match(r.reply, /College A/i);
    assert.match(r.reply, /College B/i);
    assert.doesNotMatch(r.reply, /\bNIAT\b|\bScaler\b|\bNewton\b/i);

    r = await handleCareerCounsellingMessage('makes sense', r.context);
    assert.equal(r.context.step, 'eval_ask_priorities');
    assert.match(r.reply, /matter most/i);

    r = await handleCareerCounsellingMessage('projects, internships and mentoring', r.context);
    assert.equal(r.context.step, 'eval_knowledge_confirm');
    assert.deepEqual(r.context.profile.evaluationPriorities.sort(), [
      'industry',
      'mentoring',
      'projects',
    ].sort());
    assert.equal(r.context.profile.evaluationConfidence, 'high');

    r = await handleCareerCounsellingMessage('yes clearer now', r.context);
    assert.equal(r.context.step, 'eval_ask_permission');
    assert.equal(r.context.profile.evaluationCompleted, true);
    assert.equal(r.context.profile.mindsetShiftCompleted, true);
    assert.match(r.reply, /Would you like to continue/i);

    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.stage, STAGES.MODERN_COLLEGES);
    assert.equal(r.context.step, 'modern_transition');
    assert.match(r.reply, /learning|modern|evaluate/i);
    assert.doesNotMatch(r.reply, /\bNIAT\b|\bScaler\b|\bNewton\b/i);
    assert.equal(r.clearState, false);
  });

  test('evaluation question does not skip teaching step', async () => {
    let r = await completeDiscovery();
    r = await handleCareerCounsellingMessage('ok', r.context);
    assert.equal(r.context.step, 'eval_common_mistakes');
    r = await handleCareerCounsellingMessage('Why do rankings matter?', r.context);
    assert.match(r.reply, /Rankings and brand/i);
    assert.match(r.reply, /Coming back to where we were/i);
    assert.equal(r.context.step, 'eval_common_mistakes');
  });

  test('permission no holds without entering phase 3', async () => {
    let r = await completeDiscovery();
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('projects and curriculum', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('no', r.context);
    assert.equal(r.context.step, 'eval_permission_declined');
    assert.match(r.reply, /No problem/i);
    assert.notEqual(r.context.stage, STAGES.MODERN_COLLEGES);
  });
});

describe('careerCounsellingV2 modern education discovery', () => {
  async function completeThroughEvaluationPermissionYes() {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage('B.Tech', r.context);
    r = await handleCareerCounsellingMessage('Software engineer', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    r = await handleCareerCounsellingMessage('English', r.context);
    for (const msg of ['ok', 'ok', 'ok', 'ok', 'projects and mentoring', 'yes', 'yes']) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    return r;
  }

  test('full modern education flow persists learning prefs and starts personalization', async () => {
    let r = await completeThroughEvaluationPermissionYes();
    assert.equal(r.context.step, 'modern_transition');

    r = await handleCareerCounsellingMessage('ok', r.context);
    assert.equal(r.context.step, 'modern_what_is');
    assert.match(r.reply, /future-ready|modern/i);
    assert.match(r.reply, /not.*mean traditional/i);

    r = await handleCareerCounsellingMessage('makes sense', r.context);
    assert.equal(r.context.step, 'modern_traditional_vs');
    assert.match(r.reply, /traditional focus/i);

    r = await handleCareerCounsellingMessage('continue', r.context);
    assert.equal(r.context.step, 'modern_industry_learning');
    assert.match(r.reply, /Internships/i);

    r = await handleCareerCounsellingMessage('go on', r.context);
    assert.equal(r.context.step, 'modern_student_story');
    assert.match(r.reply, /fictional/i);
    assert.doesNotMatch(r.reply, /\bNIAT\b|\bScaler\b|\bNewton\b/i);

    r = await handleCareerCounsellingMessage('yes resonates', r.context);
    assert.equal(r.context.step, 'modern_ask_learning_style');

    r = await handleCareerCounsellingMessage(
      'hands-on projects with internships and portfolio building',
      r.context
    );
    assert.equal(r.context.step, 'modern_ask_permission');
    assert.equal(r.context.profile.preferredLearningStyle, 'hands_on');
    assert.equal(r.context.profile.projectInterest, true);
    assert.equal(r.context.profile.internshipInterest, true);
    assert.equal(r.context.profile.portfolioInterest, true);
    assert.equal(r.context.profile.modernEducationCompleted, true);
    assert.match(r.reply, /Would you like to continue/i);

    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.stage, STAGES.PERSONALIZED_DISCOVERY);
    assert.equal(r.context.step, 'pers_transition');
    assert.match(r.reply, /practical preferences|career priorities|budget|location/i);
    assert.equal(r.clearState, false);
  });

  test('modern education question does not skip teaching step', async () => {
    let r = await completeThroughEvaluationPermissionYes();
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('Is modern always better?', r.context);
    assert.match(r.reply, /Not automatically/i);
    assert.match(r.reply, /Coming back to where we were/i);
    assert.equal(r.context.step, 'modern_what_is');
  });

  test('permission no on modern phase holds without phase 4', async () => {
    let r = await completeThroughEvaluationPermissionYes();
    for (const msg of ['ok', 'ok', 'ok', 'ok', 'ok', 'mentored learning', 'no']) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    assert.equal(r.context.step, 'modern_permission_declined');
    assert.notEqual(r.context.stage, STAGES.PERSONALIZED_DISCOVERY);
  });
});

describe('careerCounsellingV2 personalized discovery', () => {
  async function completeThroughModernPermissionYes() {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage('B.Tech', r.context);
    r = await handleCareerCounsellingMessage('Software engineer', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    r = await handleCareerCounsellingMessage('English', r.context);
    for (const msg of ['ok', 'ok', 'ok', 'ok', 'projects and mentoring', 'yes', 'yes']) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    for (const msg of [
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'hands-on projects with internships',
      'yes',
    ]) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    return r;
  }

  test('full personalization flow scores confidence and enters AI shortlisting', async () => {
    let r = await completeThroughModernPermissionYes();
    assert.equal(r.context.step, 'pers_transition');

    r = await handleCareerCounsellingMessage('ready', r.context);
    assert.equal(r.context.step, 'pers_career_priority');
    assert.match(r.reply, /Why I ask/i);

    r = await handleCareerCounsellingMessage('strong placements and skill building', r.context);
    assert.equal(r.context.step, 'pers_location');
    assert.equal(r.context.profile.careerPriority, 'placements');

    r = await handleCareerCounsellingMessage('Hyderabad, open to relocating, hostel ok', r.context);
    assert.equal(r.context.step, 'pers_budget');
    assert.match(String(r.context.profile.preferredLocation), /Hyderabad/i);

    r = await handleCareerCounsellingMessage('around 2-3 lakhs, education loan fine', r.context);
    assert.equal(r.context.step, 'pers_family');
    assert.ok(r.context.profile.budgetPreference);

    r = await handleCareerCounsellingMessage('parents supportive but prefer a good brand nearby', r.context);
    assert.equal(r.context.step, 'pers_concern');
    assert.ok(r.context.profile.parentPreferences);

    r = await handleCareerCounsellingMessage('worried about fees and wrong branch', r.context);
    assert.ok(r.context.profile.biggestConcerns.includes('fees'));
    assert.ok(r.context.profile.counselingConfidenceScore >= 60);
    assert.match(r.reply, /counseling profile|Counseling confidence/i);
    assert.doesNotMatch(r.reply, /\bNIAT\b|\bScaler\b|\bNewton\b/i);

    // High confidence path offers continue; medium may ask clarify first
    if (r.context.step === 'pers_clarify') {
      r = await handleCareerCounsellingMessage('placements are my top priority', r.context);
    }
    assert.equal(r.context.step, 'pers_ask_permission');

    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.stage, STAGES.AI_SHORTLISTING);
    assert.equal(r.context.step, 'shortlist_ask_exam');
    assert.match(r.reply, /personalized shortlist|entrance exam/i);
    assert.equal(r.clearState, false);
  });

  test('phase 5 shortlisting stays sticky while collecting eligibility', async () => {
    let r = await completeThroughModernPermissionYes();
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('placements', r.context);
    r = await handleCareerCounsellingMessage('Bangalore, can relocate', r.context);
    r = await handleCareerCounsellingMessage('3 lakh with scholarship', r.context);
    r = await handleCareerCounsellingMessage('family supports my choice', r.context);
    r = await handleCareerCounsellingMessage('confusion about branch', r.context);
    if (r.context.step === 'pers_clarify') {
      r = await handleCareerCounsellingMessage('skill building', r.context);
    }
    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.step, 'shortlist_ask_exam');
    r = await handleCareerCounsellingMessage('hello', r.context);
    assert.match(r.reply, /continue your personalized shortlist|entrance exam/i);
    assert.equal(r.context.stage, STAGES.AI_SHORTLISTING);
    assert.equal(r.context.step, 'shortlist_ask_exam');
  });

  test('explains why questions without advancing', async () => {
    let r = await completeThroughModernPermissionYes();
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('Why do you ask this?', r.context);
    assert.match(r.reply, /counseling profile/i);
    assert.match(r.reply, /Coming back to where we were/i);
    assert.equal(r.context.step, 'pers_career_priority');
  });
});

describe('careerCounsellingV2 AI shortlisting', () => {
  const {
    setShortlistingEligibilityDeps,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');
  const {
    RECOMMENDATION_MATRIX_VERSION,
  } = require('../constants/careerCounsellingV2Shortlisting');

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
          fee: 210000,
          cutoff: 50000,
          reservation_categories: [{ cutoff_rank: 50000 }],
        },
      ],
    },
    {
      college_name: 'Godavari College of Engineering',
      college_address: 'Rajahmundry',
      district_enum: 'EAST GODAVARI',
      branches: [
        {
          branch_name: 'Information Technology',
          branch_code: 'INF',
          fee: 140000,
          cutoff: 55000,
          reservation_categories: [{ cutoff_rank: 55000 }],
        },
      ],
    },
    {
      college_name: 'Nellore Institute of Technology',
      college_address: 'Nellore',
      district_enum: 'NELLORE',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 175000,
          cutoff: 60000,
          reservation_categories: [{ cutoff_rank: 60000 }],
        },
      ],
    },
  ];

  async function reachShortlistExamAsk() {
    let r = await completeThroughModernPermissionYesHelper();
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('placements and skill building', r.context);
    r = await handleCareerCounsellingMessage('Hyderabad, open to relocate, hostel ok', r.context);
    r = await handleCareerCounsellingMessage('around 2-3 lakhs', r.context);
    r = await handleCareerCounsellingMessage('parents prefer good brand nearby', r.context);
    r = await handleCareerCounsellingMessage('worried about fees and wrong branch', r.context);
    if (r.context.step === 'pers_clarify') {
      r = await handleCareerCounsellingMessage('placements', r.context);
    }
    r = await handleCareerCounsellingMessage('yes', r.context);
    return r;
  }

  async function completeThroughModernPermissionYesHelper() {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage('B.Tech', r.context);
    r = await handleCareerCounsellingMessage('Software engineer', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    r = await handleCareerCounsellingMessage('English', r.context);
    for (const msg of ['ok', 'ok', 'ok', 'ok', 'projects and mentoring', 'yes', 'yes']) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    for (const msg of [
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'hands-on projects with internships',
      'yes',
    ]) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    return r;
  }

  beforeEach(() => {
    setShortlistingEligibilityDeps({
      fetchCollegeDostColleges: async () => ({
        colleges: mockColleges,
        total_no_of_colleges: mockColleges.length,
      }),
    });
  });

  afterEach(() => {
    setShortlistingEligibilityDeps({});
  });

  test('generates explainable shortlist tiers without numeric rankings', async () => {
    let r = await reachShortlistExamAsk();
    assert.equal(r.context.step, 'shortlist_ask_exam');

    r = await handleCareerCounsellingMessage('AP EAPCET', r.context);
    assert.equal(r.context.step, 'shortlist_ask_rank');
    assert.equal(r.context.profile.exam, 'AP_EAMCET');

    r = await handleCareerCounsellingMessage('28000', r.context);
    assert.equal(r.context.step, 'shortlist_ask_category');

    r = await handleCareerCounsellingMessage('OC Girls', r.context);
    // AP needs region
    if (r.context.step === 'shortlist_ask_category' || r.context.eligibilityFocus === 'region') {
      assert.match(r.reply, /AU or SVU/i);
      r = await handleCareerCounsellingMessage('AU', r.context);
    }

    assert.equal(r.context.step, 'shortlist_ask_compare');
    assert.equal(r.context.stage, STAGES.AI_SHORTLISTING);
    assert.match(r.reply, /Best Match/i);
    assert.match(r.reply, /Strong Alternatives/i);
    assert.match(r.reply, /Worth Exploring/i);
    assert.match(r.reply, /Why it matches|Why it was included/i);
    assert.match(r.reply, /Recommendation confidence/i);
    assert.doesNotMatch(r.reply, /#\d|rank\s*#|score:\s*\d/i);
    assert.ok(Array.isArray(r.context.profile.recommendedColleges));
    assert.ok(r.context.profile.recommendedColleges.length >= 1);
    assert.ok(r.context.profile.recommendationReasons);
    assert.ok(Number.isFinite(r.context.profile.recommendationConfidence));
    assert.equal(r.context.profile.recommendationMatrixVersion, RECOMMENDATION_MATRIX_VERSION);
    assert.match(r.reply, /compare these options|Want to compare/i);
  });

  test('compare permission yes enters smart comparison selection', async () => {
    let r = await reachShortlistExamAsk();
    r = await handleCareerCounsellingMessage('TS EAMCET', r.context);
    r = await handleCareerCounsellingMessage('15000', r.context);
    r = await handleCareerCounsellingMessage('OC Boys', r.context);
    assert.equal(r.context.step, 'shortlist_ask_compare');

    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.stage, STAGES.SMART_COMPARISON);
    assert.equal(r.context.step, 'compare_select');
    assert.match(r.reply, /compare|shortlist/i);
    assert.match(r.reply, /1\./);
    assert.doesNotMatch(r.reply, /\bNIAT\b|\bScaler\b|\bNewton\b/i);
  });

  test('eligibility failure does not invent colleges', async () => {
    setShortlistingEligibilityDeps({
      fetchCollegeDostColleges: async () => ({ colleges: [], total_no_of_colleges: 0 }),
    });
    let r = await reachShortlistExamAsk();
    r = await handleCareerCounsellingMessage('KCET', r.context);
    r = await handleCareerCounsellingMessage('12000', r.context);
    assert.match(r.reply, /could not retrieve eligible colleges/i);
    assert.equal((r.context.profile.recommendedColleges || []).length, 0);
  });
});

describe('careerCounsellingV2 smart comparison', () => {
  const {
    setShortlistingEligibilityDeps,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');

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
          fee: 210000,
          cutoff: 50000,
          reservation_categories: [{ cutoff_rank: 50000 }],
        },
      ],
    },
    {
      college_name: 'Godavari College of Engineering',
      college_address: 'Rajahmundry',
      district_enum: 'EAST GODAVARI',
      branches: [
        {
          branch_name: 'Information Technology',
          branch_code: 'INF',
          fee: 140000,
          cutoff: 55000,
          reservation_categories: [{ cutoff_rank: 55000 }],
        },
      ],
    },
    {
      college_name: 'Nellore Institute of Technology',
      college_address: 'Nellore',
      district_enum: 'NELLORE',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 175000,
          cutoff: 60000,
          reservation_categories: [{ cutoff_rank: 60000 }],
        },
      ],
    },
  ];

  async function reachCompareSelect() {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage('B.Tech', r.context);
    r = await handleCareerCounsellingMessage('Software engineer', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    r = await handleCareerCounsellingMessage('English', r.context);
    for (const msg of ['ok', 'ok', 'ok', 'ok', 'projects and mentoring', 'yes', 'yes']) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    for (const msg of [
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'hands-on projects with internships',
      'yes',
    ]) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('placements and skill building', r.context);
    r = await handleCareerCounsellingMessage('Hyderabad, open to relocate, hostel ok', r.context);
    r = await handleCareerCounsellingMessage('around 2-3 lakhs', r.context);
    r = await handleCareerCounsellingMessage('parents prefer good brand nearby', r.context);
    r = await handleCareerCounsellingMessage('worried about fees and wrong branch', r.context);
    if (r.context.step === 'pers_clarify') {
      r = await handleCareerCounsellingMessage('placements', r.context);
    }
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('TS EAMCET', r.context);
    r = await handleCareerCounsellingMessage('15000', r.context);
    r = await handleCareerCounsellingMessage('OC Boys', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    return r;
  }

  beforeEach(() => {
    setShortlistingEligibilityDeps({
      fetchCollegeDostColleges: async () => ({
        colleges: mockColleges,
        total_no_of_colleges: mockColleges.length,
      }),
    });
  });

  afterEach(() => {
    setShortlistingEligibilityDeps({});
  });

  test('compares selected colleges with profile-based dimensions and verdict', async () => {
    let r = await reachCompareSelect();
    assert.equal(r.context.step, 'compare_select');

    r = await handleCareerCounsellingMessage('1 and 2', r.context);
    assert.equal(r.context.step, 'compare_invite_questions');
    assert.equal(r.context.stage, STAGES.SMART_COMPARISON);
    assert.match(r.reply, /personalized comparison/i);
    assert.match(r.reply, /Why it fits/i);
    assert.match(r.reply, /Watch-outs|Things to consider/i);
    assert.match(r.reply, /Trade-offs/i);
    assert.match(r.reply, /Personalized Verdict/i);
    assert.doesNotMatch(r.reply, /Decision Confidence:\s*\d/i);
    assert.ok(Array.isArray(r.context.profile.comparedColleges));
    assert.ok(r.context.profile.comparedColleges.length >= 2);
    assert.ok(Array.isArray(r.context.profile.comparisonDimensions));
    assert.ok(r.context.profile.comparisonDimensions.length >= 1);
    assert.ok(r.context.profile.comparisonSummary);
    assert.ok(r.context.profile.preferredCollege);
    assert.ok(Number.isFinite(r.context.profile.decisionConfidence));
    assert.ok(Array.isArray(r.context.profile.decisionReasons));
    assert.doesNotMatch(r.reply, /\bNIAT\b|\bScaler\b|\bNewton\b/i);
  });

  test('follow-up question stays in comparison then continue enters concern resolution', async () => {
    let r = await reachCompareSelect();
    r = await handleCareerCounsellingMessage('first two', r.context);
    assert.equal(r.context.step, 'compare_invite_questions');

    r = await handleCareerCounsellingMessage('Why this verdict?', r.context);
    assert.equal(r.context.stage, STAGES.SMART_COMPARISON);
    assert.match(r.reply, /comparison|profile|shortlist/i);
    assert.match(r.reply, /Continue/i);

    r = await handleCareerCounsellingMessage('continue', r.context);
    assert.equal(r.context.step, 'compare_ask_continue');

    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.stage, STAGES.CONCERN_RESOLUTION);
    assert.equal(r.context.step, 'concern_pick');
    assert.match(r.reply, /remaining worries|concern/i);
    assert.ok(Array.isArray(r.context.profile.activeConcerns));
    assert.ok(r.context.profile.activeConcerns.length >= 1);
  });

  test('invalid selection asks again without inventing colleges', async () => {
    let r = await reachCompareSelect();
    r = await handleCareerCounsellingMessage('only one', r.context);
    assert.equal(r.context.step, 'compare_select');
    assert.match(r.reply, /2 or 3/i);
    assert.equal((r.context.profile.comparedColleges || []).length, 0);
  });
});

describe('careerCounsellingV2 concern resolution', () => {
  const {
    setShortlistingEligibilityDeps,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');

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
          fee: 210000,
          cutoff: 50000,
          reservation_categories: [{ cutoff_rank: 50000 }],
        },
      ],
    },
    {
      college_name: 'Godavari College of Engineering',
      college_address: 'Rajahmundry',
      district_enum: 'EAST GODAVARI',
      branches: [
        {
          branch_name: 'Information Technology',
          branch_code: 'INF',
          fee: 140000,
          cutoff: 55000,
          reservation_categories: [{ cutoff_rank: 55000 }],
        },
      ],
    },
    {
      college_name: 'Nellore Institute of Technology',
      college_address: 'Nellore',
      district_enum: 'NELLORE',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 175000,
          cutoff: 60000,
          reservation_categories: [{ cutoff_rank: 60000 }],
        },
      ],
    },
  ];

  async function reachConcernPick() {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage('B.Tech', r.context);
    r = await handleCareerCounsellingMessage('Software engineer', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    r = await handleCareerCounsellingMessage('English', r.context);
    for (const msg of ['ok', 'ok', 'ok', 'ok', 'projects and mentoring', 'yes', 'yes']) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    for (const msg of [
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'hands-on projects with internships',
      'yes',
    ]) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('placements and skill building', r.context);
    r = await handleCareerCounsellingMessage('Hyderabad, open to relocate, hostel ok', r.context);
    r = await handleCareerCounsellingMessage('around 2-3 lakhs', r.context);
    r = await handleCareerCounsellingMessage('parents prefer good brand nearby', r.context);
    r = await handleCareerCounsellingMessage('worried about fees and wrong branch', r.context);
    if (r.context.step === 'pers_clarify') {
      r = await handleCareerCounsellingMessage('placements', r.context);
    }
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('TS EAMCET', r.context);
    r = await handleCareerCounsellingMessage('15000', r.context);
    r = await handleCareerCounsellingMessage('OC Boys', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('1 and 2', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    return r;
  }

  beforeEach(() => {
    setShortlistingEligibilityDeps({
      fetchCollegeDostColleges: async () => ({
        colleges: mockColleges,
        total_no_of_colleges: mockColleges.length,
      }),
    });
  });

  afterEach(() => {
    setShortlistingEligibilityDeps({});
  });

  test('answers seeded concern with profile evidence and can mark resolved', async () => {
    let r = await reachConcernPick();
    assert.equal(r.context.step, 'concern_pick');
    assert.ok(r.context.profile.activeConcerns.includes('fees'));

    r = await handleCareerCounsellingMessage('1', r.context);
    assert.equal(r.context.step, 'concern_check_resolved');
    assert.match(r.reply, /Fees|affordability|budget/i);
    assert.match(r.reply, /decision support/i);
    assert.equal(r.context.profile.lastConcernCategory, 'fees');
    assert.ok(Array.isArray(r.context.profile.objectionHistory));
    assert.ok(r.context.profile.objectionHistory.length >= 1);

    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.ok(r.context.profile.resolvedConcerns.includes('fees'));
    assert.ok(!r.context.profile.activeConcerns.includes('fees'));
    assert.ok(Number.isFinite(r.context.profile.decisionReadiness));
  });

  test('reopens concern on no then continue enters phase 9 recommendation', async () => {
    let r = await reachConcernPick();
    r = await handleCareerCounsellingMessage('fees', r.context);
    r = await handleCareerCounsellingMessage('no', r.context);
    assert.ok(r.context.profile.activeConcerns.includes('fees'));
    assert.equal(r.context.step, 'concern_pick');

    // Resolve remaining quickly via continue
    r = await handleCareerCounsellingMessage('continue', r.context);
    assert.equal(r.context.step, 'concern_ask_continue');
    assert.ok(Number.isFinite(r.context.profile.decisionReadiness));

    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.stage, STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION);
    assert.equal(r.context.step, 'phase9_followup');
    assert.match(r.reply, /personalized recommendation|Best Match|Strong Alternative|Good Backup/i);
    assert.equal(r.context.profile.phase9Presented, true);
    assert.doesNotMatch(r.reply, /\bNIAT\b|\bScaler\b|\bNewton\b/i);
  });

  test('new concern text is classified and answered', async () => {
    let r = await reachConcernPick();
    r = await handleCareerCounsellingMessage('I am worried about location and hostel', r.context);
    assert.equal(r.context.step, 'concern_check_resolved');
    assert.equal(r.context.profile.lastConcernCategory, 'location');
    assert.match(r.reply, /Location|relocation|hostel/i);
    assert.ok(r.context.profile.activeConcerns.includes('location'));
  });
});

describe('careerCounsellingV2 phase 9 personalized recommendation', () => {
  const {
    setShortlistingEligibilityDeps,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');
  const {
    synthesizePersonalizedRecommendation,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2PersonalizedRecommendationCore');

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
          fee: 210000,
          cutoff: 50000,
          reservation_categories: [{ cutoff_rank: 50000 }],
        },
      ],
    },
    {
      college_name: 'Godavari College of Engineering',
      college_address: 'Rajahmundry',
      district_enum: 'EAST GODAVARI',
      branches: [
        {
          branch_name: 'Information Technology',
          branch_code: 'INF',
          fee: 140000,
          cutoff: 55000,
          reservation_categories: [{ cutoff_rank: 55000 }],
        },
      ],
    },
    {
      college_name: 'Nellore Institute of Technology',
      college_address: 'Nellore',
      district_enum: 'NELLORE',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 175000,
          cutoff: 60000,
          reservation_categories: [{ cutoff_rank: 60000 }],
        },
      ],
    },
  ];

  async function reachPhase9() {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage('B.Tech', r.context);
    r = await handleCareerCounsellingMessage('Software engineer', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    r = await handleCareerCounsellingMessage('English', r.context);
    for (const msg of ['ok', 'ok', 'ok', 'ok', 'projects and mentoring', 'yes', 'yes']) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    for (const msg of [
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'hands-on projects with internships',
      'yes',
    ]) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('placements and skill building', r.context);
    r = await handleCareerCounsellingMessage('Hyderabad, open to relocate, hostel ok', r.context);
    r = await handleCareerCounsellingMessage('around 2-3 lakhs', r.context);
    r = await handleCareerCounsellingMessage('parents prefer good brand nearby', r.context);
    r = await handleCareerCounsellingMessage('worried about fees and wrong branch', r.context);
    if (r.context.step === 'pers_clarify') {
      r = await handleCareerCounsellingMessage('placements', r.context);
    }
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('TS EAMCET', r.context);
    r = await handleCareerCounsellingMessage('15000', r.context);
    r = await handleCareerCounsellingMessage('OC Boys', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('1 and 2', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    return r;
  }

  beforeEach(() => {
    setShortlistingEligibilityDeps({
      fetchCollegeDostColleges: async () => ({
        colleges: mockColleges,
        total_no_of_colleges: mockColleges.length,
      }),
    });
  });

  afterEach(() => {
    setShortlistingEligibilityDeps({});
  });

  test('synthesizes ranked explainable recommendations from journey context', async () => {
    const r = await reachPhase9();
    assert.equal(r.context.stage, STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION);
    assert.equal(r.context.step, 'phase9_followup');
    assert.match(r.reply, /Best Match/i);
    assert.match(r.reply, /Excellent Match|Strong Match|Good Match/i);
    assert.match(r.reply, /How they differ|Comparison Insight|trade/i);
    assert.match(r.reply, /future could look like/i);
    assert.ok(Array.isArray(r.context.profile.phase9Recommendations));
    assert.ok(r.context.profile.phase9Recommendations.length >= 1);
    assert.ok(r.context.profile.phase9Recommendations.length <= 3);
    assert.doesNotMatch(r.reply, /\bNIAT\b|\bScaler\b|\bNewton\b/i);
    assert.doesNotMatch(r.reply, /Decision Confidence:\s*\d/i);
    assert.doesNotMatch(r.reply, /score:\s*\d/i);
  });

  test('continue from phase 9 enters future path vision', async () => {
    let r = await reachPhase9();
    r = await handleCareerCounsellingMessage('continue', r.context);
    assert.equal(r.context.stage, STAGES.PHASE_10_FUTURE_PATH_VISION);
    assert.equal(r.context.step, 'vision_followup');
    assert.match(r.reply, /path toward|learning|possibilities/i);
    assert.doesNotMatch(r.reply, /counsellor|counselor|book(ing)?|whatsapp/i);
    assert.doesNotMatch(r.reply, /guaranteed|assured|100%/i);
  });

  test('follow-up question stays in phase 9', async () => {
    let r = await reachPhase9();
    r = await handleCareerCounsellingMessage('Why is this the best match?', r.context);
    assert.equal(r.context.stage, STAGES.PHASE_9_PERSONALIZED_RECOMMENDATION);
    assert.equal(r.context.step, 'phase9_followup');
    assert.match(r.reply, /shortlist|comparison|profile|Continue/i);
  });

  test('core handles missing shortlist without inventing colleges', () => {
    const syn = synthesizePersonalizedRecommendation({
      preferredCourse: 'B.Tech',
      recommendedColleges: [],
    });
    assert.equal(syn.items.length, 0);
    assert.match(syn.reply, /enough shortlist|counsellor/i);
    assert.doesNotMatch(syn.reply, /\bNIAT\b|\bScaler\b/i);
  });

  test('core preserves Phase 5 order; comparison lean never becomes Best Match', () => {
    const syn = synthesizePersonalizedRecommendation({
      preferredCourse: 'B.Tech',
      preferredCollege: 'College B',
      decisionReasons: ['Strong practical fit and internship signals'],
      budgetPreference: '2-3 lakhs',
      recommendedColleges: [
        { collegeName: 'College A', tier: 'best_match', branchName: 'CSE' },
        { collegeName: 'College B', tier: 'strong_alternative', branchName: 'IT' },
        { collegeName: 'College C', tier: 'worth_exploring', branchName: 'ECE' },
        { collegeName: 'College D', tier: 'worth_exploring', branchName: 'ME' },
      ],
      recommendationReasons: {
        'College A': { why: ['Best overall course fit'], strengths: [], consider: [] },
        'College B': { why: ['Strong practical fit'], strengths: [], consider: ['Higher fee'] },
      },
      recommendationConfidence: 80,
    });
    assert.equal(syn.items.length, 3);
    assert.equal(syn.items[0].collegeName, 'College A');
    assert.equal(syn.items[0].rankLabel, 'Best Match');
    assert.equal(syn.items[1].collegeName, 'College B');
    assert.equal(syn.items[1].rankLabel, 'Strong Alternative');
    assert.match(syn.reply, /Comparison Insight:.*College B/i);
    assert.match(syn.reply, /Strong practical fit|internship/i);
    assert.doesNotMatch(syn.reply, /\*Best Match: College B\*/);
  });

  test('core never injects preferredCollege outside the shortlist', () => {
    const syn = synthesizePersonalizedRecommendation({
      preferredCollege: 'Outside College',
      recommendedColleges: [
        { collegeName: 'College A', tier: 'best_match' },
        { collegeName: 'College B', tier: 'strong_alternative' },
      ],
      decisionReasons: ['Earlier lean'],
    });
    assert.equal(syn.items.length, 2);
    assert.ok(syn.items.every((i) => i.collegeName !== 'Outside College'));
    assert.match(syn.reply, /Comparison Insight:.*Outside College/i);
    assert.match(syn.reply, /context only/i);
  });

  test('core ranks at most three preserving Phase 5 array order', () => {
    const syn = synthesizePersonalizedRecommendation({
      preferredCourse: 'B.Tech',
      recommendedColleges: [
        { collegeName: 'College A', tier: 'best_match', branchName: 'CSE' },
        { collegeName: 'College B', tier: 'strong_alternative', branchName: 'IT' },
        { collegeName: 'College C', tier: 'worth_exploring', branchName: 'ECE' },
        { collegeName: 'College D', tier: 'worth_exploring', branchName: 'ME' },
      ],
      recommendationReasons: {
        'College A': { why: ['Fits your course focus'], strengths: [], consider: [] },
      },
      recommendationConfidence: 80,
    });
    assert.equal(syn.items.length, 3);
    assert.deepEqual(
      syn.items.map((i) => i.collegeName),
      ['College A', 'College B', 'College C']
    );
    assert.match(syn.reply, /College A/);
    assert.match(syn.reply, /Fits your course focus/);
  });
});

describe('careerCounsellingV2 phase 10 future path vision', () => {
  const {
    setShortlistingEligibilityDeps,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');
  const {
    synthesizeFuturePathVision,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2FuturePathVisionCore');

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
          fee: 210000,
          cutoff: 50000,
          reservation_categories: [{ cutoff_rank: 50000 }],
        },
      ],
    },
    {
      college_name: 'Godavari College of Engineering',
      college_address: 'Rajahmundry',
      district_enum: 'EAST GODAVARI',
      branches: [
        {
          branch_name: 'Information Technology',
          branch_code: 'INF',
          fee: 140000,
          cutoff: 55000,
          reservation_categories: [{ cutoff_rank: 55000 }],
        },
      ],
    },
    {
      college_name: 'Nellore Institute of Technology',
      college_address: 'Nellore',
      district_enum: 'NELLORE',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 175000,
          cutoff: 60000,
          reservation_categories: [{ cutoff_rank: 60000 }],
        },
      ],
    },
  ];

  async function reachPhase10() {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage('B.Tech', r.context);
    r = await handleCareerCounsellingMessage('Software engineer', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    r = await handleCareerCounsellingMessage('English', r.context);
    for (const msg of ['ok', 'ok', 'ok', 'ok', 'projects and mentoring', 'yes', 'yes']) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    for (const msg of [
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'hands-on projects with internships',
      'yes',
    ]) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('placements and skill building', r.context);
    r = await handleCareerCounsellingMessage('Hyderabad, open to relocate, hostel ok', r.context);
    r = await handleCareerCounsellingMessage('around 2-3 lakhs', r.context);
    r = await handleCareerCounsellingMessage('parents prefer good brand nearby', r.context);
    r = await handleCareerCounsellingMessage('worried about fees and wrong branch', r.context);
    if (r.context.step === 'pers_clarify') {
      r = await handleCareerCounsellingMessage('placements', r.context);
    }
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('TS EAMCET', r.context);
    r = await handleCareerCounsellingMessage('15000', r.context);
    r = await handleCareerCounsellingMessage('OC Boys', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('1 and 2', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    return r;
  }

  beforeEach(() => {
    setShortlistingEligibilityDeps({
      fetchCollegeDostColleges: async () => ({
        colleges: mockColleges,
        total_no_of_colleges: mockColleges.length,
      }),
    });
  });

  afterEach(() => {
    setShortlistingEligibilityDeps({});
  });

  test('presents personalized future path without CTA or guarantees', async () => {
    const r = await reachPhase10();
    assert.equal(r.context.stage, STAGES.PHASE_10_FUTURE_PATH_VISION);
    assert.equal(r.context.step, 'vision_followup');
    assert.equal(r.context.profile.futurePathVisionPresented, true);
    assert.match(r.reply, /path toward|Hyderabad Tech|possibilities/i);
    assert.doesNotMatch(r.reply, /counsellor|counselor|book(ing)?|whatsapp/i);
    assert.doesNotMatch(r.reply, /guaranteed|assured|100%/i);
    assert.doesNotMatch(r.reply, /Best Match:|Strong Alternative:|Good Backup:/i);
  });

  test('continue from phase 10 enters Phase 11 hesitation', async () => {
    let r = await reachPhase10();
    r = await handleCareerCounsellingMessage('continue', r.context);
    assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
    assert.equal(r.context.step, 'hesitation_ask');
    assert.match(r.reply, /hesitation|Ready/i);
    assert.doesNotMatch(r.reply, /guidexpert\.co\.in/i);
  });

  test('booking question deflects without leaving vision', async () => {
    let r = await reachPhase10();
    r = await handleCareerCounsellingMessage('Can I book a counsellor now?', r.context);
    assert.equal(r.context.stage, STAGES.PHASE_10_FUTURE_PATH_VISION);
    assert.doesNotMatch(r.reply, /guidexpert\.co\.in/i);
    assert.match(r.reply, /Next steps come after|Continue/i);
  });

  test('core personalizes from profile without inventing guarantees', () => {
    const vision = synthesizeFuturePathVision({
      preferredCourse: 'B.Tech',
      careerGoal: 'Software engineer',
      learningStyle: 'hands-on projects',
      phase9Recommendations: [
        { collegeName: 'College A', rankLabel: 'Best Match', tier: 'best_match' },
      ],
    });
    assert.equal(vision.personalized, true);
    assert.match(vision.reply, /College A/);
    assert.match(vision.reply, /Software engineer|B\.Tech|hands-on/i);
    assert.ok(vision.bubbles.length <= 3);
    assert.doesNotMatch(vision.reply, /guaranteed|counsellor|book/i);
  });
});

describe('careerCounsellingV2 Phase 11 final decision hesitation', () => {
  const {
    setShortlistingEligibilityDeps,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');
  const {
    classifyHesitation,
    buildPersonalizedHesitationReply,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2FinalDecisionHesitationCore');

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
          fee: 210000,
          cutoff: 50000,
          reservation_categories: [{ cutoff_rank: 50000 }],
        },
      ],
    },
    {
      college_name: 'Godavari College of Engineering',
      college_address: 'Rajahmundry',
      district_enum: 'EAST GODAVARI',
      branches: [
        {
          branch_name: 'Information Technology',
          branch_code: 'INF',
          fee: 140000,
          cutoff: 55000,
          reservation_categories: [{ cutoff_rank: 55000 }],
        },
      ],
    },
    {
      college_name: 'Nellore Institute of Technology',
      college_address: 'Nellore',
      district_enum: 'NELLORE',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 175000,
          cutoff: 60000,
          reservation_categories: [{ cutoff_rank: 60000 }],
        },
      ],
    },
  ];

  async function reachPhase11() {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage('B.Tech', r.context);
    r = await handleCareerCounsellingMessage('Software engineer', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    r = await handleCareerCounsellingMessage('English', r.context);
    for (const msg of ['ok', 'ok', 'ok', 'ok', 'projects and mentoring', 'yes', 'yes']) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    for (const msg of [
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'hands-on projects with internships',
      'yes',
    ]) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('placements and skill building', r.context);
    r = await handleCareerCounsellingMessage('Hyderabad, open to relocate, hostel ok', r.context);
    r = await handleCareerCounsellingMessage('around 2-3 lakhs', r.context);
    r = await handleCareerCounsellingMessage('parents prefer good brand nearby', r.context);
    r = await handleCareerCounsellingMessage('worried about fees and wrong branch', r.context);
    if (r.context.step === 'pers_clarify') {
      r = await handleCareerCounsellingMessage('placements', r.context);
    }
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('TS EAMCET', r.context);
    r = await handleCareerCounsellingMessage('15000', r.context);
    r = await handleCareerCounsellingMessage('OC Boys', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('1 and 2', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    return r;
  }

  beforeEach(() => {
    setShortlistingEligibilityDeps({
      fetchCollegeDostColleges: async () => ({
        colleges: mockColleges,
        total_no_of_colleges: mockColleges.length,
      }),
    });
  });

  afterEach(() => {
    setShortlistingEligibilityDeps({});
  });

  test('enters from Phase 10 continue', async () => {
    const r = await reachPhase11();
    assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
    assert.equal(r.context.step, 'hesitation_ask');
    assert.equal(r.context.profile.phase11HesitationPresented, true);
  });

  test('fast path ready exits to Phase 12 service selection without booking URL', async () => {
    let r = await reachPhase11();
    const ranksBefore = JSON.stringify(r.context.profile.recommendedColleges);
    const reasonsBefore = JSON.stringify(r.context.profile.phase9Recommendations);
    r = await handleCareerCounsellingMessage('ready', r.context);
    assert.equal(r.context.stage, STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION);
    assert.equal(r.context.profile.phase11ConfidenceCheck, 'ready');
    assert.equal(r.context.profile.phase11Escalated, false);
    assert.ok(r.context.profile.phase12Service);
    assert.doesNotMatch(r.reply, /https?:\/\//i);
    assert.doesNotMatch(r.reply, /guidexpert\.co\.in/i);
    assert.equal(JSON.stringify(r.context.profile.recommendedColleges), ranksBefore);
    assert.equal(JSON.stringify(r.context.profile.phase9Recommendations), reasonsBefore);
  });

  test('taxonomy replies stay in Phase 11 until confidence yes', async () => {
    let r = await reachPhase11();
    r = await handleCareerCounsellingMessage('I am still unsure about deciding', r.context);
    assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
    assert.equal(r.context.step, 'hesitation_confirm');
    assert.match(r.reply, /Still feeling unsure|Does that help/i);
    assert.doesNotMatch(r.reply, /guaranteed|counsellor|book|guidexpert\.co\.in/i);
    assert.notEqual(r.context.stage, STAGES.CONCERN_RESOLUTION);

    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.stage, STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION);
    assert.ok(r.context.profile.phase11ResolvedHesitations.includes('decision_uncertainty'));
  });

  test('confirm no allows one second pass then escalates to One-on-One', async () => {
    let r = await reachPhase11();
    r = await handleCareerCounsellingMessage('parents may not agree', r.context);
    r = await handleCareerCounsellingMessage('no', r.context);
    assert.equal(r.context.step, 'hesitation_second');
    r = await handleCareerCounsellingMessage('fear of wrong choice', r.context);
    assert.equal(r.context.step, 'hesitation_escalation');
    assert.equal(r.context.profile.phase11Escalated, true);
    assert.match(r.reply, /one-on-one-session/i);
    assert.notEqual(r.context.stage, STAGES.CONCERN_RESOLUTION);
  });

  test('single resolved hesitation does not escalate and enters Phase 12', async () => {
    let r = await reachPhase11();
    r = await handleCareerCounsellingMessage('I am still unsure about deciding', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.profile.phase11Escalated, false);
    assert.equal(r.context.stage, STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION);
    assert.doesNotMatch(r.reply, /one-on-one-session/i);
    assert.doesNotMatch(r.reply, /https?:\/\//i);
  });

  test('explicit expert request directs to official One-on-One form', async () => {
    let r = await reachPhase11();
    const ranksBefore = JSON.stringify(r.context.profile.recommendedColleges);
    r = await handleCareerCounsellingMessage('I want to speak with an expert counselor', r.context);
    assert.equal(r.context.profile.phase11Escalated, true);
    assert.match(r.reply, /https:\/\/www\.guidexpert\.co\.in\/one-on-one-session/);
    assert.doesNotMatch(r.reply, /iit-counselling/);
    assert.equal(JSON.stringify(r.context.profile.recommendedColleges), ranksBefore);
  });

  test('deflects compare / phase7 restart without leaving hesitation', async () => {
    let r = await reachPhase11();
    r = await handleCareerCounsellingMessage('compare the colleges again', r.context);
    assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
    assert.match(r.reply, /not comparing/i);

    r = await handleCareerCounsellingMessage('start over and re-evaluate', r.context);
    assert.equal(r.context.stage, STAGES.PHASE_11_FINAL_DECISION_HESITATION);
    assert.match(r.reply, /won.?t reopen evaluation/i);
  });

  test('core classifies taxonomy and personalizes without guarantees', () => {
    assert.equal(classifyHesitation('I might choose wrong').id, 'wrong_choice_fear');
    assert.equal(classifyHesitation('too hard academically').id, 'academic_manageability');
    assert.equal(classifyHesitation('is this the right path').id, 'fit_confidence');
    const built = buildPersonalizedHesitationReply(
      {
        preferredCourse: 'B.Tech',
        careerGoal: 'Software engineer',
        phase9Recommendations: [{ collegeName: 'College A', rankLabel: 'Best Match' }],
      },
      'fit_confidence'
    );
    assert.match(built.reply, /College A/);
    assert.doesNotMatch(built.reply, /guaranteed|counsellor|book/i);
  });
});

describe('careerCounsellingV2 Phase 12 counseling experience selection', () => {
  const {
    selectCounselingService,
    shouldSkipPhase12,
    COUNSELING_SERVICES,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2CounselingExperienceSelectionCore');
  const {
    setShortlistingEligibilityDeps,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');

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
          fee: 210000,
          cutoff: 50000,
          reservation_categories: [{ cutoff_rank: 50000 }],
        },
      ],
    },
    {
      college_name: 'Godavari College of Engineering',
      college_address: 'Rajahmundry',
      district_enum: 'EAST GODAVARI',
      branches: [
        {
          branch_name: 'Information Technology',
          branch_code: 'INF',
          fee: 140000,
          cutoff: 55000,
          reservation_categories: [{ cutoff_rank: 55000 }],
        },
      ],
    },
    {
      college_name: 'Nellore Institute of Technology',
      college_address: 'Nellore',
      district_enum: 'NELLORE',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 175000,
          cutoff: 60000,
          reservation_categories: [{ cutoff_rank: 60000 }],
        },
      ],
    },
  ];

  async function reachPhase12() {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage('B.Tech', r.context);
    r = await handleCareerCounsellingMessage('Software engineer', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    r = await handleCareerCounsellingMessage('English', r.context);
    for (const msg of ['ok', 'ok', 'ok', 'ok', 'projects and mentoring', 'yes', 'yes']) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    for (const msg of [
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'hands-on projects with internships',
      'yes',
    ]) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('placements and skill building', r.context);
    r = await handleCareerCounsellingMessage('Hyderabad, open to relocate, hostel ok', r.context);
    r = await handleCareerCounsellingMessage('around 2-3 lakhs', r.context);
    r = await handleCareerCounsellingMessage('parents prefer good brand nearby', r.context);
    r = await handleCareerCounsellingMessage('worried about fees and wrong branch', r.context);
    if (r.context.step === 'pers_clarify') {
      r = await handleCareerCounsellingMessage('placements', r.context);
    }
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('TS EAMCET', r.context);
    r = await handleCareerCounsellingMessage('15000', r.context);
    r = await handleCareerCounsellingMessage('OC Boys', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('1 and 2', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('ready', r.context);
    return r;
  }

  beforeEach(() => {
    setShortlistingEligibilityDeps({
      fetchCollegeDostColleges: async () => ({
        colleges: mockColleges,
        total_no_of_colleges: mockColleges.length,
      }),
    });
  });

  afterEach(() => {
    setShortlistingEligibilityDeps({});
  });

  test('selects service and presents without booking URL', async () => {
    const r = await reachPhase12();
    assert.equal(r.context.stage, STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION);
    assert.ok(
      ['one_on_one', 'admission', 'career', 'none'].includes(r.context.profile.phase12Service)
    );
    assert.doesNotMatch(r.reply, /https?:\/\//i);
  });

  test('continue transitions to Phase 13 CTA without URL', async () => {
    let r = await reachPhase12();
    r = await handleCareerCounsellingMessage('continue', r.context);
    assert.equal(r.context.stage, STAGES.PHASE_13_BOOKING_ORCHESTRATOR);
    assert.equal(r.context.step, 'booking_intro');
    assert.doesNotMatch(r.reply, /https?:\/\//i);
  });

  test('skip gate helpers for escalation and NIAT', () => {
    assert.equal(shouldSkipPhase12({ phase11Escalated: true }).skip, true);
    assert.equal(shouldSkipPhase12({ niatOneOnOneRecommended: true }).skip, true);
    assert.equal(shouldSkipPhase12({ phase11ConfidenceCheck: 'ready' }).skip, false);
    assert.equal(
      selectCounselingService({ phase11ConfidenceCheck: 'ready' }).service,
      COUNSELING_SERVICES.NONE
    );
  });
});

describe('careerCounsellingV2 Phase 13 booking orchestrator', () => {
  const {
    BOOKING_SERVICE_REGISTRY,
    buildOfficialBookingUrl,
    shouldSkipPhase13,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2BookingOrchestratorCore');
  const {
    setShortlistingEligibilityDeps,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');

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
          fee: 210000,
          cutoff: 50000,
          reservation_categories: [{ cutoff_rank: 50000 }],
        },
      ],
    },
    {
      college_name: 'Godavari College of Engineering',
      college_address: 'Rajahmundry',
      district_enum: 'EAST GODAVARI',
      branches: [
        {
          branch_name: 'Information Technology',
          branch_code: 'INF',
          fee: 140000,
          cutoff: 55000,
          reservation_categories: [{ cutoff_rank: 55000 }],
        },
      ],
    },
    {
      college_name: 'Nellore Institute of Technology',
      college_address: 'Nellore',
      district_enum: 'NELLORE',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 175000,
          cutoff: 60000,
          reservation_categories: [{ cutoff_rank: 60000 }],
        },
      ],
    },
  ];

  async function reachPhase13() {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage('B.Tech', r.context);
    r = await handleCareerCounsellingMessage('Software engineer', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    r = await handleCareerCounsellingMessage('English', r.context);
    for (const msg of ['ok', 'ok', 'ok', 'ok', 'projects and mentoring', 'yes', 'yes']) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    for (const msg of [
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'hands-on projects with internships',
      'yes',
    ]) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('placements and skill building', r.context);
    r = await handleCareerCounsellingMessage('Hyderabad, open to relocate, hostel ok', r.context);
    r = await handleCareerCounsellingMessage('around 2-3 lakhs', r.context);
    r = await handleCareerCounsellingMessage('parents prefer good brand nearby', r.context);
    r = await handleCareerCounsellingMessage('worried about fees and wrong branch', r.context);
    if (r.context.step === 'pers_clarify') {
      r = await handleCareerCounsellingMessage('placements', r.context);
    }
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('TS EAMCET', r.context);
    r = await handleCareerCounsellingMessage('15000', r.context);
    r = await handleCareerCounsellingMessage('OC Boys', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('1 and 2', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('ready', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    return r;
  }

  beforeEach(() => {
    setShortlistingEligibilityDeps({
      fetchCollegeDostColleges: async () => ({
        colleges: mockColleges,
        total_no_of_colleges: mockColleges.length,
      }),
    });
  });

  afterEach(() => {
    setShortlistingEligibilityDeps({});
  });

  test('CTA first then Book Now shares registry URL', async () => {
    let r = await reachPhase13();
    assert.equal(r.context.stage, STAGES.PHASE_13_BOOKING_ORCHESTRATOR);
    assert.doesNotMatch(r.reply, /https?:\/\//i);
    const url = r.context.profile.phase13BookingUrl;
    r = await handleCareerCounsellingMessage('Book now', r.context);
    assert.match(r.reply, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('resume send booking link after defer', async () => {
    let r = await reachPhase13();
    r = await handleCareerCounsellingMessage('Later', r.context);
    assert.equal(r.context.profile.journeyCompleted, true);
    r = await handleCareerCounsellingMessage('Give me the booking form', r.context);
    assert.equal(r.context.step, 'booking_presented');
    assert.match(r.reply, /https?:\/\//i);
  });

  test('registry and skip helpers', () => {
    assert.ok(BOOKING_SERVICE_REGISTRY.one_on_one);
    assert.match(buildOfficialBookingUrl(BOOKING_SERVICE_REGISTRY.career), /service=career/);
    assert.equal(shouldSkipPhase13({ phase12Service: 'none' }).skip, true);
  });
});

describe('careerCounsellingV2 counseling invitation', () => {
  const {
    setShortlistingEligibilityDeps,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2EligibilityService');
  const { bookingPageUrl } = require('../services/chatbot/bookingContext/bookingContextResolver');

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
          fee: 210000,
          cutoff: 50000,
          reservation_categories: [{ cutoff_rank: 50000 }],
        },
      ],
    },
    {
      college_name: 'Godavari College of Engineering',
      college_address: 'Rajahmundry',
      district_enum: 'EAST GODAVARI',
      branches: [
        {
          branch_name: 'Information Technology',
          branch_code: 'INF',
          fee: 140000,
          cutoff: 55000,
          reservation_categories: [{ cutoff_rank: 55000 }],
        },
      ],
    },
    {
      college_name: 'Nellore Institute of Technology',
      college_address: 'Nellore',
      district_enum: 'NELLORE',
      branches: [
        {
          branch_name: 'Computer Science and Engineering',
          branch_code: 'CSE',
          fee: 175000,
          cutoff: 60000,
          reservation_categories: [{ cutoff_rank: 60000 }],
        },
      ],
    },
  ];

  async function reachInvitationOffer() {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage('B.Tech', r.context);
    r = await handleCareerCounsellingMessage('Software engineer', r.context);
    r = await handleCareerCounsellingMessage('not yet', r.context);
    r = await handleCareerCounsellingMessage('English', r.context);
    for (const msg of ['ok', 'ok', 'ok', 'ok', 'projects and mentoring', 'yes', 'yes']) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    for (const msg of [
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'hands-on projects with internships',
      'yes',
    ]) {
      r = await handleCareerCounsellingMessage(msg, r.context);
    }
    r = await handleCareerCounsellingMessage('ok', r.context);
    r = await handleCareerCounsellingMessage('placements and skill building', r.context);
    r = await handleCareerCounsellingMessage('Hyderabad, open to relocate, hostel ok', r.context);
    r = await handleCareerCounsellingMessage('around 2-3 lakhs', r.context);
    r = await handleCareerCounsellingMessage('parents prefer good brand nearby', r.context);
    r = await handleCareerCounsellingMessage('worried about fees and wrong branch', r.context);
    if (r.context.step === 'pers_clarify') {
      r = await handleCareerCounsellingMessage('placements', r.context);
    }
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('TS EAMCET', r.context);
    r = await handleCareerCounsellingMessage('15000', r.context);
    r = await handleCareerCounsellingMessage('OC Boys', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('1 and 2', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('yes', r.context);
    // Phase 9 → Phase 10 → Phase 11 hesitation (fast path) → Phase 12 → start invitation for Section E regression
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('continue', r.context);
    r = await handleCareerCounsellingMessage('ready', r.context);
    assert.equal(r.context.stage, STAGES.PHASE_12_PERSONALIZED_COUNSELING_RECOMMENDATION);
    const {
      processCounselingInvitationTurn,
    } = require('../services/chatbot/careerCounselling/careerCounsellingV2CounselingInvitationEngine');
    r = await processCounselingInvitationTurn('', r.context, {
      startCounselingInvitation: true,
    });
    return r;
  }

  beforeEach(() => {
    setShortlistingEligibilityDeps({
      fetchCollegeDostColleges: async () => ({
        colleges: mockColleges,
        total_no_of_colleges: mockColleges.length,
      }),
    });
  });

  afterEach(() => {
    setShortlistingEligibilityDeps({});
  });

  test('accept uses Section E website CTA and completes conversation', async () => {
    let r = await reachInvitationOffer();
    assert.equal(r.context.step, 'invite_offer');
    assert.match(r.reply, new RegExp(bookingPageUrl().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    r = await handleCareerCounsellingMessage('yes', r.context);
    assert.equal(r.context.stage, STAGES.CONVERSATION_COMPLETE);
    assert.equal(r.context.step, 'conversation_complete');
    assert.equal(r.context.profile.counselingInvitationAccepted, true);
    assert.equal(r.context.profile.handoffReason, 'accepted_website_cta');
    assert.match(r.reply, /cannot create a booking inside WhatsApp/i);
    assert.match(r.reply, new RegExp(bookingPageUrl().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('later defers invitation; decline completes without pressure', async () => {
    let r = await reachInvitationOffer();
    r = await handleCareerCounsellingMessage('later', r.context);
    assert.equal(r.context.stage, STAGES.CONVERSATION_COMPLETE);
    assert.equal(r.context.profile.counselingInvitationDeferred, true);
    assert.equal(r.context.profile.handoffReason, 'deferred');
    assert.match(r.reply, /No pressure/i);

    // sticky complete
    r = await handleCareerCounsellingMessage('hello', r.context);
    assert.equal(r.context.step, 'conversation_complete');
    assert.match(r.reply, /conversation is complete/i);
  });

  test('continue asking stays on invitation without completing', async () => {
    let r = await reachInvitationOffer();
    r = await handleCareerCounsellingMessage('Why meet a human counsellor?', r.context);
    assert.equal(r.context.stage, STAGES.COUNSELING_INVITATION);
    assert.equal(r.context.step, 'invite_questions');
    assert.match(r.reply, /institution-specific|admissions|scholarships/i);
    assert.equal(r.context.profile.counselingInvitationAccepted, false);
  });
});

describe('careerCounsellingV2 NIAT interest → One-on-One', () => {
  const {
    detectNiatInterest,
  } = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
  const {
    NIAT_INTEREST_STAGE,
    ONE_ON_ONE_SESSION_URL,
  } = require('../services/chatbot/careerCounselling/careerCounsellingV2NiatInterestService');

  test('explicit join interest recommends official One-on-One form', async () => {
    const r = await handleCareerCounsellingMessage('I want to join NIAT.', {}, { isNewEntry: true });
    assert.equal(r.context.stage, NIAT_INTEREST_STAGE);
    assert.equal(r.context.profile.niatInterestFunnel, 'niat_interest');
    assert.match(r.reply, new RegExp(ONE_ON_ONE_SESSION_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(r.reply, /guaranteed|mandatory|must book/i);
    assert.doesNotMatch(r.reply, /iit-counselling/);
  });

  test('informational NIAT question does not trigger One-on-One', () => {
    assert.equal(detectNiatInterest('What is NIAT?').matched, false);
    assert.equal(detectNiatInterest('Compare NIAT vs other colleges').matched, false);
  });

  test('mid-journey NIAT interest interrupts immediately', async () => {
    let r = await handleCareerCounsellingMessage('Career guidance', {}, { isNewEntry: true });
    r = await handleCareerCounsellingMessage('Class 12', r.context);
    r = await handleCareerCounsellingMessage("I'm interested in NIAT", r.context);
    assert.equal(r.context.stage, NIAT_INTEREST_STAGE);
    assert.match(r.reply, /interested in NIAT/i);
  });

  test('analytics funnel is not Phase 11 escalation', async () => {
    const r = await handleCareerCounsellingMessage('How do I take admission in NIAT?', {}, {
      isNewEntry: true,
    });
    assert.ok(r.analytics.some((a) => a.type === 'niat_interest_detected'));
    assert.ok(
      r.analytics.some((a) => a.type === 'one_on_one_recommended' && a.source === 'niat_interest')
    );
    assert.ok(!r.analytics.some((a) => a.source === 'phase11_hesitation'));
  });
});

describe('career counselling V2 analytics', () => {
  test('emits structured discovery lifecycle event names', async () => {
    const events = [];
    const logPath = require.resolve('../services/chatbot/chatbotStructuredLog');
    const analyticsPath = require.resolve(
      '../services/chatbot/careerCounselling/careerCounsellingV2Analytics'
    );
    delete require.cache[analyticsPath];

    const restore = mock.method(require(logPath), 'logChatbotEvent', (event, fields) => {
      events.push({ event, fields });
    });

    const {
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
      logLearningPreferenceSelected,
      logLearningStyleIdentified,
      logModernEducationCompleted,
      logPersonalizationStarted,
      logCareerPriorityCaptured,
      logLocationPreferenceCaptured,
      logBudgetPreferenceCaptured,
      logParentPreferencesCaptured,
      logConcernCaptured,
      logCounselingConfidenceCalculated,
      logCounselingProfileCompleted,
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
    } = require('../services/chatbot/careerCounselling/careerCounsellingV2Analytics');

    logDiscoveryStarted({ stage: 'discovery', step: 'awaiting_qualification' });
    logDiscoveryQuestionAnswered({ step: 'awaiting_qualification', profileCompletionPct: 15 });
    logProfileUpdated({ profileCompletionPct: 35 });
    logDiscoveryCompleted({ profileCompletionPct: 100 });
    logEvaluationStarted({ stage: 'evaluation_framework', step: 'eval_transition' });
    logEvaluationTopicViewed({ step: 'eval_framework', topic: 'framework' });
    logEvaluationPrioritySelected({ evaluationPriorities: ['projects', 'mentoring'] });
    logEvaluationCompleted({ evaluationConfidence: 'high' });
    logMindsetShiftCompleted({ evaluationPriorities: ['projects'] });
    logModernEducationStarted({ stage: 'modern_colleges', step: 'modern_transition' });
    logLearningPreferenceSelected({ preferredLearningStyle: 'hands_on' });
    logLearningStyleIdentified({ preferredLearningStyle: 'hands_on' });
    logModernEducationCompleted({ preferredLearningStyle: 'hands_on' });
    logPersonalizationStarted({ stage: 'personalized_discovery' });
    logCareerPriorityCaptured({ careerPriority: 'placements' });
    logLocationPreferenceCaptured({ preferredLocation: 'Hyderabad' });
    logBudgetPreferenceCaptured({ budgetPreference: '2-3L' });
    logParentPreferencesCaptured({});
    logConcernCaptured({ biggestConcerns: ['fees'] });
    logCounselingConfidenceCalculated({ counselingConfidenceScore: 85 });
    logCounselingProfileCompleted({ counselingConfidenceScore: 85 });
    logCareerDropoff({ step: 'awaiting_course', reason: 'menu' });
    logCareerInterruption({ step: 'awaiting_course', kind: 'agent' });
    logShortlistStarted({ stage: 'ai_shortlisting' });
    logEligibilityRetrieved({ eligibleCount: 12 });
    logRecommendationGenerated({ recommendedCount: 7 });
    logRecommendationViewed({ recommendedCount: 7 });
    logRecommendationReasonViewed({ reasonCount: 7 });
    logRecommendationConfidence({ recommendationConfidence: 82 });
    logShortlistCompleted({ recommendationConfidence: 82 });
    logComparisonStarted({ stage: 'smart_comparison' });
    logCollegesSelectedForComparison({ colleges: ['A', 'B'], count: 2 });
    logComparisonDimensionViewed({ dimension: 'budget' });
    logComparisonCompleted({ preferredCollege: 'A' });
    logFollowupQuestionAsked({ questionPreview: 'why fees' });
    logDecisionConfidenceCalculated({ decisionConfidence: 78 });
    logPreferredCollegeIdentified({ preferredCollege: 'A' });
    logConcernResolutionStarted({ stage: 'concern_resolution' });
    logConcernIdentified({ category: 'fees' });
    logConcernCategoryDetected({ category: 'fees' });
    logConcernAnswered({ category: 'fees' });
    logConcernResolved({ category: 'fees' });
    logConcernReopened({ category: 'fees' });
    logDecisionReadinessCalculated({ decisionReadiness: 72 });
    logPhase9RecommendationStarted({ stage: 'phase_9_personalized_recommendation' });
    logPhase9RecommendationSynthesized({ overallConfidenceLabel: 'Excellent Match' });
    logPhase9RecommendationPresented({ itemCount: 3 });
    logPhase9RecommendationContinued({});
    logCounselingInvitationStarted({ stage: 'counseling_invitation' });
    logCounselingInvitationShown({ stage: 'counseling_invitation' });
    logCounselingInvitationAccepted({ bookingPageUrl: 'https://www.guidexpert.co.in/iit-counselling' });
    logCounselingInvitationDeclined({});
    logCounselingInvitationDeferred({});

    restore.mock.restore();
    delete require.cache[analyticsPath];

    assert.deepEqual(
      events.map((e) => e.event),
      [
        'discovery_started',
        'discovery_question_answered',
        'profile_updated',
        'discovery_completed',
        'evaluation_started',
        'evaluation_topic_viewed',
        'evaluation_priority_selected',
        'evaluation_completed',
        'mindset_shift_completed',
        'modern_education_started',
        'learning_preference_selected',
        'learning_style_identified',
        'modern_education_completed',
        'personalization_started',
        'career_priority_captured',
        'location_preference_captured',
        'budget_preference_captured',
        'parent_preferences_captured',
        'concern_captured',
        'counseling_confidence_calculated',
        'counseling_profile_completed',
        'career_dropoff',
        'career_interruption',
        'shortlist_started',
        'eligibility_retrieved',
        'recommendation_generated',
        'recommendation_viewed',
        'recommendation_reason_viewed',
        'recommendation_confidence',
        'shortlist_completed',
        'comparison_started',
        'colleges_selected_for_comparison',
        'comparison_dimension_viewed',
        'comparison_completed',
        'followup_question_asked',
        'decision_confidence_calculated',
        'preferred_college_identified',
        'concern_resolution_started',
        'concern_identified',
        'concern_category_detected',
        'concern_answered',
        'concern_resolved',
        'concern_reopened',
        'decision_readiness_calculated',
        'phase9_recommendation_started',
        'phase9_recommendation_synthesized',
        'phase9_recommendation_presented',
        'phase9_recommendation_continued',
        'counseling_invitation_started',
        'counseling_invitation_shown',
        'counseling_invitation_accepted',
        'counseling_invitation_declined',
        'counseling_invitation_deferred',
      ]
    );
    assert.equal(events[0].fields.pipeline, 'career_counselling_v2');
    assert.equal(events[1].fields.discoveryStep, 'awaiting_qualification');
  });
});

describe('career counselling guided flow orchestration', () => {
  let prevScopeFirewall;
  let outboundCalls;
  let transitionLog;

  function makeHooks(overrides = {}) {
    return {
      buildLeadContext: async () => ({
        phone: PHONE,
        productLine: 'unknown',
      }),
      retrieveFacts: async (_links, leadContext) => ({ lead: leadContext, links: {} }),
      getBotState: async () => ({
        state: 'career_counselling_v2',
        context: {
          careerCounselling: {
            flow: 'career_counselling_v2',
            version: 2,
            stage: STAGES.DISCOVERY,
            step: 'awaiting_qualification',
            profile: {
              currentQualification: null,
              currentClass: null,
              preferredCourse: null,
              careerGoal: null,
              preferredColleges: [],
              preferredLanguage: null,
              conversationContext: [],
              profileCompletionPct: 0,
            },
          },
        },
      }),
      transitionState: async (_cid, _phone, state, context) => {
        transitionLog.push({ state, context });
        return { state, context };
      },
      resetToMainMenu: async () => ({ state: 'main_menu', context: {} }),
      isBotPausedForConversation: async () => false,
      cancelActiveHandoffForUser: async () => ({ cancelled: false }),
      createHandoff: async () => ({ _id: new mongoose.Types.ObjectId() }),
      updateConversationIntent: async () => {},
      outbound: {
        sendBotTextReply: async (args) => {
          outboundCalls.push(args);
          return { success: true };
        },
        sendBotButtonReply: async () => ({ success: true }),
        sendBotListReply: async () => ({ success: true }),
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    prevScopeFirewall = process.env.CHATBOT_SCOPE_FIREWALL_ENABLED;
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = '1';
    outboundCalls = [];
    transitionLog = [];
    setChatbotOrchestratorTestHooks(makeHooks());
  });

  afterEach(() => {
    process.env.CHATBOT_SCOPE_FIREWALL_ENABLED = prevScopeFirewall;
    setChatbotOrchestratorTestHooks(null);
  });

  test('registry keeps V2 journey active after discovery completion', async () => {
    const flow = getGuidedFlowByBotState('career_counselling_v2');
    assert.equal(flow.id, 'career_counselling_v2');
    assert.equal(flow.completeBotState, 'career_counselling_v2');
    assert.equal(getGuidedFlowByIntent('career_counselling_journey_continue')?.id, flow.id);
    assert.equal(shouldBypassScopeFirewall({ state: 'career_counselling_v2' }, 'unknown'), true);
  });

  test('active journey continues past scope firewall', async () => {
    await processInbound({
      conversation: { _id: CONVERSATION_ID, phone: PHONE, productLine: 'unknown' },
      inbound: { _id: new mongoose.Types.ObjectId(), messageType: 'text', text: 'Class 12' },
      leadLinks: { phone10: PHONE },
    });

    assert.ok(outboundCalls.length >= 1);
    const combined = outboundCalls.map((c) => c.text || '').join('\n');
    assert.match(combined, /course or field/i);
    assert.ok(transitionLog.every((t) => t.state === 'career_counselling_v2'));
    assert.doesNotMatch(combined, /I'm here to help only with GuideXpert services/i);
  });

  test('MENU interrupt exits guided flow', async () => {
    await processInbound({
      conversation: { _id: CONVERSATION_ID, phone: PHONE, productLine: 'unknown' },
      inbound: { _id: new mongoose.Types.ObjectId(), messageType: 'text', text: 'menu' },
      leadLinks: { phone10: PHONE },
    });

    assert.equal(outboundCalls.length, 1);
    assert.ok(transitionLog.some((t) => t.state === 'main_menu'));
    assert.equal(isGuidedFlowInterrupt('menu'), true);
  });

  test('new entry starts V2 discovery from intent routing', async () => {
    setChatbotOrchestratorTestHooks(
      makeHooks({
        getBotState: async () => ({ state: 'main_menu', context: {} }),
      })
    );

    await processInbound({
      conversation: { _id: CONVERSATION_ID, phone: PHONE, productLine: 'unknown' },
      inbound: {
        _id: new mongoose.Types.ObjectId(),
        messageType: 'text',
        text: 'I need career guidance',
      },
      leadLinks: { phone10: PHONE },
    });

    assert.ok(outboundCalls.length >= 1);
    const combined = outboundCalls.map((c) => c.text || '').join('\n');
    assert.match(combined, /admissions counsellor/i);
    assert.ok(transitionLog.some((t) => t.state === 'career_counselling_v2'));
  });
});
