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
  AWAITING,
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
const { getMessage } = require('../constants/careerCounsellingJourney');

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

  test('rank + branch query stays on college predictor', () => {
    const text = 'Can I get CSE with rank 20000';
    assert.equal(isCareerCounsellingJourneyEntryQuery(text), false);
    const result = classifyIntent(text, null, 'unknown', text);
    assert.equal(result.intent, 'college_predictor');
  });

  test('breakout during journey for rank predictor phrase', () => {
    assert.equal(isCareerCounsellingJourneyBreakout('predict my rank for JEE Main 85'), true);
  });
});

describe('careerCounsellingJourneyService Phase 1', () => {
  test('full journey through permission yes stays in journey at phase 2 ready', () => {
    let ctx = {};
    let r = handleCareerCounsellingMessage('I need counselling', ctx, { isNewEntry: true });
    assert.match(r.reply, /important decisions/i);
    assert.match(r.reply, /does it help to look at college choice this way/i);
    assert.equal(r.context.phase, 1);
    assert.equal(r.context.step, 'welcome');
    assert.equal(r.context.awaiting, AWAITING.ACK);
    assert.equal(r.clearState, false);
    assert.doesNotMatch(r.reply, /NIAT|Scaler|Newton|admission test|scholarship/i);

    r = handleCareerCounsellingMessage('ok', r.context);
    assert.match(r.reply, /friends are joining/i);
    assert.match(r.reply, /Have you noticed any of these patterns/i);
    assert.equal(r.context.step, 'common_mistakes');

    r = handleCareerCounsellingMessage('understood', r.context);
    assert.match(r.reply, /Curriculum relevance/i);
    assert.equal(r.context.step, 'evaluation');

    r = handleCareerCounsellingMessage('continue', r.context);
    assert.match(r.reply, /new-age/i);
    assert.equal(r.context.step, 'modern_colleges');

    r = handleCareerCounsellingMessage('go on', r.context);
    assert.match(r.reply, /Would you like me to suggest them/i);
    assert.equal(r.context.step, 'phase1_permission');
    assert.equal(r.context.awaiting, AWAITING.PERMISSION);

    r = handleCareerCounsellingMessage('yes', r.context);
    assert.match(r.reply, /let's explore some colleges that match these qualities/i);
    assert.equal(r.context.phase, 2);
    assert.equal(r.context.step, 'phase2_ready');
    assert.deepEqual(r.context.phasesCompleted, [1]);
    assert.equal(r.clearState, false);
    assert.doesNotMatch(r.reply, /Top Matches|college_name|predicted colleges/i);
  });

  test('permission no stays in journey at phase1_declined', () => {
    let ctx = {};
    let r = handleCareerCounsellingMessage('Career guidance', ctx, { isNewEntry: true });
    r = handleCareerCounsellingMessage('ok', r.context);
    r = handleCareerCounsellingMessage('ok', r.context);
    r = handleCareerCounsellingMessage('ok', r.context);
    r = handleCareerCounsellingMessage('ok', r.context);
    r = handleCareerCounsellingMessage('no', r.context);
    assert.match(r.reply, /No problem/i);
    assert.equal(r.context.step, 'phase1_declined');
    assert.equal(r.context.phase, 1);
    assert.equal(r.clearState, false);
  });

  test('counselling question does not advance step', () => {
    let r = handleCareerCounsellingMessage('Help me choose a college', {}, { isNewEntry: true });
    r = handleCareerCounsellingMessage('What about placements?', r.context);
    assert.match(r.reply, /Placements depend on many factors/i);
    assert.match(r.reply, /Coming back to where we were/i);
    assert.equal(r.context.step, 'welcome');
    assert.equal(r.context.awaiting, AWAITING.ACK);
  });

  test('non-ack non-question nudges without advancing', () => {
    let r = handleCareerCounsellingMessage('I am confused', {}, { isNewEntry: true });
    r = handleCareerCounsellingMessage('hmm let me think', r.context);
    assert.match(r.reply, /Take your time/i);
    assert.equal(r.context.step, 'welcome');
  });

  test('breakout request deflects without advancing', () => {
    let r = handleCareerCounsellingMessage('I am confused', {}, { isNewEntry: true });
    r = handleCareerCounsellingMessage('predict my rank for JEE Main 85', r.context);
    assert.match(r.reply, /help with that separately/i);
    assert.equal(r.context.step, 'welcome');
  });

  test('messages are configurable via constants', () => {
    assert.match(getMessage('welcome'), /important decisions/i);
    assert.match(getMessage('permission'), /Would you like me to suggest them/i);
    assert.match(getMessage('phase1_transition'), /let's explore some colleges/i);
  });
});

describe('career counselling analytics', () => {
  test('emits structured lifecycle event names', () => {
    const events = [];
    const logPath = require.resolve('../services/chatbot/chatbotStructuredLog');
    const analyticsPath = require.resolve('../services/chatbot/careerCounselling/careerCounsellingAnalytics');
    delete require.cache[analyticsPath];

    const restore = mock.method(require(logPath), 'logChatbotEvent', (event, fields) => {
      events.push({ event, fields });
    });

    const {
      logCareerPhaseStarted,
      logCareerStepCompleted,
      logCareerPhaseCompleted,
      logCareerResume,
      logCareerDropoff,
      logCareerInterruption,
    } = require('../services/chatbot/careerCounselling/careerCounsellingAnalytics');

    logCareerPhaseStarted({ phase: 1 });
    logCareerStepCompleted({ phase: 1, step: 'welcome' });
    logCareerPhaseCompleted({ phase: 1 });
    logCareerResume({ phase: 1, step: 'welcome', reason: 'after_question' });
    logCareerDropoff({ phase: 1, step: 'welcome', reason: 'menu' });
    logCareerInterruption({ phase: 1, step: 'welcome', kind: 'agent' });

    restore.mock.restore();
    delete require.cache[analyticsPath];

    assert.deepEqual(
      events.map((e) => e.event),
      [
        'career_phase_started',
        'career_step_completed',
        'career_phase_completed',
        'career_resume',
        'career_dropoff',
        'career_interruption',
      ]
    );
    assert.equal(events[0].fields.pipeline, 'career_counselling_journey');
    assert.equal(events[1].fields.careerStep, 'welcome');
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
        state: 'career_counselling_journey',
        context: {
          careerCounselling: {
            flow: 'career_counselling_journey',
            phase: 1,
            step: 'welcome',
            awaiting: AWAITING.ACK,
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

  test('registry keeps journey active after phase completion', () => {
    const flow = getGuidedFlowByBotState('career_counselling_journey');
    assert.equal(flow.id, 'career_counselling_journey');
    assert.equal(flow.completeBotState, 'career_counselling_journey');
    assert.equal(getGuidedFlowByIntent('career_counselling_journey_continue')?.id, flow.id);
    assert.equal(shouldBypassScopeFirewall({ state: 'career_counselling_journey' }, 'unknown'), true);
  });

  test('active journey continues past scope firewall', async () => {
    await processInbound({
      conversation: { _id: CONVERSATION_ID, phone: PHONE, productLine: 'unknown' },
      inbound: { _id: new mongoose.Types.ObjectId(), messageType: 'text', text: 'ok' },
      leadLinks: { phone10: PHONE },
    });

    assert.equal(outboundCalls.length, 1);
    assert.match(outboundCalls[0].text || '', /friends are joining/i);
    assert.ok(transitionLog.every((t) => t.state === 'career_counselling_journey'));
    assert.doesNotMatch(outboundCalls[0].text || '', /I'm here to help only with GuideXpert services/i);
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

  test('new entry starts journey from intent routing', async () => {
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

    assert.equal(outboundCalls.length, 1);
    assert.match(outboundCalls[0].text || '', /important decisions/i);
    assert.ok(transitionLog.some((t) => t.state === 'career_counselling_journey'));
  });
});
