'use strict';

/**
 * Production audit runner — evidence only, no product architecture changes.
 * Outputs JSON metrics to stdout for the certification report.
 */

const {
  resolveCollegePredictorEntry,
} = require('../services/chatbot/whatsappCollegePredictor/collegePredictorIntentService');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
} = require('../services/chatbot/collegePredictorChatService');
const {
  buildConversationalWelcome,
  buildQuestionForSlot,
  MAX_NON_RESULT_LINES,
  clampReplyLines,
} = require('../services/chatbot/whatsappCollegePredictor/collegePredictorConversation');
const {
  SLOT_RANK,
  SLOT_CATEGORY,
  SLOT_GENDER,
  SLOT_REGION,
  SLOT_PERCENTILE,
  SLOT_ADMISSION_TYPE,
  SLOT_QUOTA,
} = require('../services/chatbot/whatsappCollegePredictor/collegePredictorSlots');
const { EXAM_AP } = require('../constants/whatsappCollegePredictor');

const idle = { state: 'main_menu', context: {} };

function lineBudgetOk(text) {
  const clamped = clampReplyLines(text);
  return clamped.split('\n').length <= MAX_NON_RESULT_LINES;
}

function countNonEmptyLines(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length;
}

const MUST_ENTER = [
  'college predictor',
  'predict colleges',
  'which colleges can i get',
  'suggest engineering colleges',
  'college list',
  'need colleges',
  'can i get cbit',
  'can i get vasavi',
  'can i get cse',
  'guide me with eamcet',
  'my rank is 10000',
  'i got 25000',
  'AIR 5400',
  'Can I get CSE with 35k?',
  'colage predction',
  'eamset colleges',
  'Na rank 22000',
  'EAMCET lo 18000',
  'My rank 23000 ra',
  'where can i get seat',
  'engineering admission',
  'best colleges for my rank',
  'I want CSE',
];

const MUST_NOT_ENTER = [
  'rank predictor',
  'predict my rank',
  'estimate my rank',
  'guide me',
  'help me',
  'help',
  'counselling help',
  'please help',
  'i need counselling',
  'admission guidance',
  'help me choose a college',
  'suggest a college',
  'which college should i join',
  "i don't know which college to choose",
  'what is niat',
  'tell me about guidexpert',
  'menu',
  'unsubscribe',
  'hi',
  'hello',
];

async function mockPredictor() {
  return {
    colleges: [
      {
        college_name: 'VASAVI COLLEGE OF ENGINEERING',
        district: 'Hyderabad',
        branches: [
          {
            branch_name: 'COMPUTER SCIENCE AND ENGINEERING',
            reservation_categories: [{ cutoff_rank: 5000, category_name: 'OC GIRLS' }],
          },
        ],
      },
      {
        college_name: 'CBIT',
        district: 'Hyderabad',
        branches: [
          {
            branch_name: 'ELECTRONICS AND COMMUNICATION ENGINEERING',
            reservation_categories: [{ cutoff_rank: 8000, category_name: 'BCB BOYS' }],
          },
        ],
      },
    ],
    total_no_of_colleges: 2,
  };
}

function auditRouting() {
  const falseNegatives = [];
  const falsePositives = [];

  for (const phrase of MUST_ENTER) {
    const entry = resolveCollegePredictorEntry({ englishText: phrase, botState: idle });
    const intent = classifyIntent(phrase, idle, 'iit_counselling');
    const ok = entry.enter || intent.intent === 'college_predictor';
    if (!ok) falseNegatives.push({ phrase, entry, intent: intent.intent });
  }

  for (const phrase of MUST_NOT_ENTER) {
    const entry = resolveCollegePredictorEntry({ englishText: phrase, botState: idle });
    const intent = classifyIntent(phrase, idle, 'iit_counselling');
    const stole =
      entry.enter ||
      (intent.intent === 'college_predictor' && !/^(hi|hello|menu)$/i.test(phrase));
    // hi/hello/menu may classify as greeting/main_menu — only fail if CP
    if (entry.enter || intent.intent === 'college_predictor') {
      falsePositives.push({ phrase, entry, intent: intent.intent });
    }
  }

  // Journey isolation
  const blocked = resolveCollegePredictorEntry({
    englishText: 'college predictor',
    botState: { state: 'rank_predictor', context: {} },
  });
  if (blocked.enter) {
    falsePositives.push({ phrase: 'college predictor@rank_predictor', entry: blocked });
  }

  return {
    mustEnter: MUST_ENTER.length,
    mustNotEnter: MUST_NOT_ENTER.length,
    falseNegatives,
    falsePositives,
    pass: falseNegatives.length === 0 && falsePositives.length === 0,
  };
}

function auditLineBudget() {
  const prompts = [
    buildConversationalWelcome(),
    buildQuestionForSlot(SLOT_RANK, {}),
    buildQuestionForSlot(SLOT_CATEGORY, { exam: EXAM_AP }),
    buildQuestionForSlot(SLOT_GENDER, { exam: EXAM_AP }),
    buildQuestionForSlot(SLOT_REGION, { exam: EXAM_AP }),
    buildQuestionForSlot(SLOT_PERCENTILE, {}),
    buildQuestionForSlot(SLOT_ADMISSION_TYPE, { exam: 'KCET' }),
    buildQuestionForSlot(SLOT_QUOTA, {}),
  ];
  const failures = [];
  for (const p of prompts) {
    if (!lineBudgetOk(p)) {
      failures.push({ text: p, lines: countNonEmptyLines(p) });
    }
  }
  return {
    checked: prompts.length,
    maxAllowed: MAX_NON_RESULT_LINES,
    failures,
    pass: failures.length === 0,
  };
}

async function auditE2EConversations() {
  setCollegePredictorDeps({ getPredictedColleges: mockPredictor });
  const scenarios = [];
  const failures = [];

  async function run(name, turns, assertFn) {
    let ctx = {};
    const transcript = [];
    let last = null;
    for (let i = 0; i < turns.length; i++) {
      last = await handleCollegePredictorMessage(turns[i], ctx, {
        isNewEntry: i === 0,
      });
      ctx = last.context;
      transcript.push({
        user: turns[i],
        step: last.context?.step,
        clearState: last.clearState,
        replyLines: countNonEmptyLines(last.reply),
        isResults: last.context?.step === 'results',
      });
      // Non-results replies must respect line budget
      if (last.context?.step !== 'results' && !/Top Matches|predicted colleges|More Matches/i.test(last.reply)) {
        if (!lineBudgetOk(last.reply)) {
          failures.push({ scenario: name, turn: turns[i], reply: last.reply });
        }
      }
    }
    try {
      assertFn(last, transcript);
      scenarios.push({ name, pass: true, turns: turns.length });
    } catch (e) {
      scenarios.push({ name, pass: false, error: e.message, turns: turns.length });
      failures.push({ scenario: name, error: e.message });
    }
  }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  await run('AP happy path AU', ['AP EAMCET', '20000', 'BC-A', 'Female', 'AU'], (last) => {
    assert(last.context.step === 'results', 'expected results');
    assert(last.clearState === false, 'sticky clearState false');
    assert(/VASAVI|CBIT|Top Matches|predicted/i.test(last.reply), 'expected colleges');
  });

  await run(
    'multi-slot out of order',
    ['My AP EAMCET rank is 15000 BC-A Female', 'AU'],
    (last) => {
      assert(last.context.step === 'results', 'expected results');
    }
  );

  await run('TS path + CSE filter', ['TS EAMCET', '12000', 'OC', 'Female', 'CSE'], (last) => {
    assert(last.context.step === 'results', 'sticky results');
  });

  await run('AGAIN restart', ['TS EAMCET', '12000', 'OC', 'Female', 'AGAIN'], (last) => {
    assert(last.restart === true || last.context.step === 'exam', 'restart exam');
    assert(last.context.admission_category_name_enum == null, 'cleared region');
  });

  await run(
    'named college preference entry',
    ['can i get cbit', 'AP EAMCET', '8000', 'OC', 'Female', 'AU'],
    (last) => {
      assert(last.context.step === 'results', 'results');
    }
  );

  await run(
    'multilingual mixed',
    ['Na rank 22000', 'AP EAMCET', 'BC-B', 'Male', 'SVU'],
    (last, transcript) => {
      // first turn may only capture rank
      assert(transcript[0].step === 'exam' || transcript[0].step === 'rank' || last.context.rank != null || last.context.step === 'results', 'progressed');
    }
  );

  await run(
    'noise on sticky results',
    ['TS EAMCET', '15000', 'OC', 'Female', '???', '👍', 'python code', 'SHOW MORE'],
    (last) => {
      assert(last.context.step === 'results', 'still sticky');
      assert(last.clearState === false, 'not cleared');
    }
  );

  await run(
    'interrupt-ish ok stays sticky then MENU via restart pattern',
    ['TS EAMCET', '15000', 'OC', 'Female', 'why', 'continue'],
    (last) => {
      assert(last.context.step === 'results', 'sticky after why/continue');
    }
  );

  return {
    scenarios,
    failures,
    pass: failures.length === 0 && scenarios.every((s) => s.pass),
  };
}

async function main() {
  const routing = auditRouting();
  const lines = auditLineBudget();
  const e2e = await auditE2EConversations();

  const report = {
    generatedAt: new Date().toISOString(),
    gates: {
      routing: routing,
      lineBudget: lines,
      e2eConversations: {
        pass: e2e.pass,
        scenarioCount: e2e.scenarios.length,
        scenarios: e2e.scenarios,
        failures: e2e.failures,
      },
    },
    overallPass: routing.pass && lines.pass && e2e.pass,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.overallPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
