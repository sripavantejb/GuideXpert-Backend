#!/usr/bin/env node
'use strict';

/**
 * Conversation-level orchestration certification.
 * Verifies counselor-led replies, phase advance, Phase 5 explore, and CP bridge seeding.
 *
 *   node scripts/counselingOrchestrationCertification.js
 */

const assert = require('assert');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  handleCareerCounsellingMessage,
} = require('../services/chatbot/careerCounselling/careerCounsellingJourneyService');
const {
  selectCuratedInstitutions,
  startExploreModernColleges,
  processExploreModernCollegesTurn,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2ExploreModernCollegesEngine');
const {
  nonEmptyLines,
  MAX_LINES_NORMAL,
  MAX_LINES_EDUCATIONAL,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2ResponseOptimizer');
const {
  mapStageToRoadmapPhase,
  extractAdvanceQuestion,
  isEducationalContentReply,
} = require('../services/chatbot/careerCounselling/careerCounsellingV2PhaseOrchestrator');
const {
  isCounselingBridgeIntent,
  seedCareerContextFromPredictor,
  appendCounselingAdvance,
} = require('../services/chatbot/collegePredictorChatService');
const { mapStageToPhase } = require('../services/conversationRecovery/conversationRecoveryCore');

const GENERIC_NEXT = /What would you like to know next/i;
const TERMINAL_STAGES = new Set([
  'journey_completed',
  'conversation_complete',
]);

function countLines(reply) {
  return nonEmptyLines(reply).length;
}

function assertOrchestration(result, label) {
  assert.ok(result.orchestration, `${label}: missing orchestration metadata`);
  assert.ok(
    Number.isFinite(result.orchestration.currentPhase),
    `${label}: currentPhase missing`
  );
}

function assertAdvanceOrTerminal(result, label) {
  const stage = result.context?.stage;
  const step = result.context?.step;
  if (
    result.allowSkipAdvance ||
    result.context?.profile?.journeyCompleted ||
    TERMINAL_STAGES.has(stage) ||
    step === 'journey_completed' ||
    result.allowExtendedPrediction
  ) {
    return;
  }
  const q = extractAdvanceQuestion(result.reply);
  assert.ok(q, `${label}: reply must end with an advancing question`);
  assert.doesNotMatch(result.reply, GENERIC_NEXT, `${label}: generic next prompt`);
}

function assertLineCap(result, label) {
  if (result.allowExtendedPrediction || result.skipLineCap) return;
  const n = countLines(result.reply);
  const educational =
    result.educationalContent === true || isEducationalContentReply(result);
  const max = educational ? MAX_LINES_EDUCATIONAL : MAX_LINES_NORMAL;
  assert.ok(
    n <= max,
    `${label}: expected ≤${max} lines, got ${n}: ${result.reply}`
  );
}

async function run() {
  const failures = [];
  const pass = (name) => console.log(`PASS  ${name}`);
  const fail = (name, err) => {
    failures.push({ name, err: err.message || String(err) });
    console.log(`FAIL  ${name}: ${err.message || err}`);
  };

  // 1) Entry envelope + metadata
  try {
    let r = await handleCareerCounsellingMessage('I need career counselling', {}, { isNewEntry: true });
    assertOrchestration(r, 'entry');
    assertLineCap(r, 'entry');
    assertAdvanceOrTerminal(r, 'entry');
    assert.equal(r.context.stage, 'discovery');
    pass('entry orchestration + line cap');
  } catch (e) {
    fail('entry orchestration + line cap', e);
  }

  // 2) Phase 5 explore curated path
  try {
    const curated = selectCuratedInstitutions(
      { preferredCourse: 'B.Tech CSE', learningStyle: 'hands_on', careerGoal: 'software engineer' },
      10
    );
    assert.ok(curated.length >= 8, 'curated empty');
    assert.ok(
      curated.some((c) => /NIAT/i.test(c.name)),
      'NIAT must appear in new-age showcase'
    );
    assert.ok(
      curated.some((c) => /Plaksha|IIIT|Scaler|Shiv Nadar|Krea|Ahmedabad|UPES/i.test(c.name)),
      'expected diverse modern catalog hit'
    );
    assert.doesNotMatch(
      curated.map((c) => c.name).join(' '),
      /\bCBIT\b|\bVasavi\b|\bJNTUH\b|\bGRIET\b/i
    );
    assert.doesNotMatch(String(curated[0]?.name || ''), /\bNIAT\b/i);

    let ctx = {
      flow: 'career_counselling_v2',
      version: 2,
      stage: 'personalized_discovery',
      step: 'pers_ask_permission',
      profile: {
        preferredCourse: 'B.Tech CSE',
        careerGoal: 'software',
        learningStyle: 'hands_on',
      },
    };
    let r = await processExploreModernCollegesTurn('yes', ctx, {
      startExploreModernColleges: true,
      fromPersonalization: true,
      presentImmediately: true,
    });
    assert.equal(r.context.stage, 'explore_modern_colleges');
    assert.ok(
      r.context.profile?.exploreModernInstitutions?.length >= 1,
      'explore institutions missing'
    );
    assert.equal(mapStageToRoadmapPhase(r.context.stage), 5);
    assert.equal(mapStageToPhase('explore_modern_colleges'), 5);
    pass('phase 5 explore curated + recovery map');
  } catch (e) {
    fail('phase 5 explore curated + recovery map', e);
  }

  // 3) Soft-advance explore decline → shortlisting
  try {
    const started = startExploreModernColleges({
      flow: 'career_counselling_v2',
      version: 2,
      profile: { preferredCourse: 'engineering' },
    });
    const r = await processExploreModernCollegesTurn('no', started.context, {});
    assert.ok(
      r.skippedPhaseReason === 'user_declined_optional_gate' ||
        r.context?.stage === 'ai_shortlisting' ||
        String(r.context?.step || '').startsWith('shortlist_'),
      `expected soft-advance, got stage=${r.context?.stage} step=${r.context?.step}`
    );
    pass('explore soft-advance on decline');
  } catch (e) {
    fail('explore soft-advance on decline', e);
  }

  // 4) Personalization yes → explore (not direct shortlist)
  try {
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
        profile: {
          careerPriority: 'skills',
          locationPreference: 'Hyderabad',
          budgetPreference: 'under 5 lakhs',
          familyPreference: 'supportive',
          preferredCourse: 'CSE',
        },
      },
      {}
    );
    assert.ok(
      r.context.stage === 'ai_shortlisting' ||
        String(r.context.step || '').startsWith('shortlist_'),
      `expected shortlisting after personalization, got ${r.context.stage}`
    );
    pass('personalization → shortlisting handoff');
  } catch (e) {
    fail('personalization → shortlisting handoff', e);
  }

  // 5) College Predictor bridge seed
  try {
    assert.equal(isCounselingBridgeIntent('compare'), true);
    assert.equal(isCounselingBridgeIntent('SHOW MORE'), false);
    const seed = seedCareerContextFromPredictor({
      exam: 'TS_EAMCET',
      rank: 5200,
      gender: 'female',
      resultCache: [
        { college_name: 'College A', branches: [{ branch_name: 'CSE' }] },
        { college_name: 'College B', branches: [{ branch_name: 'IT' }] },
      ],
    });
    assert.equal(seed.stage, 'smart_comparison');
    assert.equal(seed.profile.recommendedColleges.length, 2);
    assert.equal(seed.profile.bridgedFromCollegePredictor, true);
    const advanced = appendCounselingAdvance('Top colleges listed.');
    assert.match(advanced, /what matters most/i);
    pass('college predictor bridge seed');
  } catch (e) {
    fail('college predictor bridge seed', e);
  }

  // 6) Full handleCareerCounsellingMessage through explore from personalization context via journey service
  try {
    let r = await handleCareerCounsellingMessage(
      'yes',
      {
        flow: 'career_counselling_v2',
        version: 2,
        stage: 'explore_modern_colleges',
        step: 'explore_ask_continue',
        profile: {
          preferredCourse: 'CSE',
          exploreModernInstitutions: [{ name: 'NIAT', why: 'projects' }],
          exploreModernSource: 'curated',
        },
      },
      {}
    );
    assertOrchestration(r, 'explore continue');
    // Interactive framework: explore continue → personalized discovery
    assert.ok(
      r.context.stage === 'personalized_discovery' ||
        String(r.context.step || '').startsWith('pers_') ||
        r.context.stage === 'ai_shortlisting' ||
        String(r.context.step || '').startsWith('shortlist_'),
      `unexpected stage ${r.context.stage}`
    );
    pass('journey service explore continue');
  } catch (e) {
    fail('journey service explore continue', e);
  }

  console.log('\n────────────────────────────────────');
  console.log(`Result: ${failures.length ? 'FAIL' : 'PASS'} (${failures.length} failures)`);
  if (failures.length) {
    for (const f of failures) console.log(` - ${f.name}: ${f.err}`);
    process.exit(1);
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
