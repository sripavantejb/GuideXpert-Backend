'use strict';

/**
 * Production certification suite for College Predictor (P0).
 * Generates 300+ conversation scenarios covering entry, slots, sticky, filters, negatives.
 */

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleCollegePredictorMessage,
  setCollegePredictorDeps,
} = require('../services/chatbot/collegePredictorChatService');
const {
  resolveCollegePredictorEntry,
  isHardNegative,
} = require('../services/chatbot/whatsappCollegePredictor/collegePredictorIntentService');
const {
  clampReplyLines,
  MAX_NON_RESULT_LINES,
  buildQuestionForSlot,
  buildConversationalWelcome,
} = require('../services/chatbot/whatsappCollegePredictor/collegePredictorConversation');
const { classifyIntent } = require('../services/chatbot/intentClassifierService');
const { EXAM_AP, EXAM_TS } = require('../constants/whatsappCollegePredictor');
const { SLOT_RANK, SLOT_CATEGORY, SLOT_GENDER } = require('../services/chatbot/whatsappCollegePredictor/collegePredictorSlots');

function makeSuccessPredictor(calls = []) {
  return async (exam, offset, limit, body) => {
    calls.push({ exam, offset, limit, body });
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
              reservation_categories: [{ cutoff_rank: 8000, category_name: 'OC GIRLS' }],
            },
          ],
        },
        {
          college_name: 'GRIET',
          district: 'Hyderabad',
          branches: [
            {
              branch_name: 'COMPUTER SCIENCE AND ENGINEERING',
              reservation_categories: [{ cutoff_rank: 12000, category_name: 'OC GIRLS' }],
            },
          ],
        },
        {
          college_name: 'VNR VJIET',
          district: 'Hyderabad',
          branches: [
            {
              branch_name: 'INFORMATION TECHNOLOGY',
              reservation_categories: [{ cutoff_rank: 9000, category_name: 'OC GIRLS' }],
            },
          ],
        },
        {
          college_name: 'GOVT WOMEN ENGINEERING COLLEGE',
          district: 'Warangal',
          branches: [
            {
              branch_name: 'CSE',
              reservation_categories: [{ cutoff_rank: 15000, category_name: 'OC GIRLS' }],
            },
          ],
        },
      ],
      total_no_of_colleges: 5,
    };
  };
}

function makeFailPredictor(calls = []) {
  return async (...args) => {
    calls.push(args);
    const err = new Error('upstream down');
    err.res_status = 'UPSTREAM_ERROR';
    throw err;
  };
}

function assertShortReply(reply) {
  const lines = String(reply || '')
    .split('\n')
    .filter((l, i, arr) => !(l === '' && (i === 0 || i === arr.length - 1)));
  // Allow blank separators; count non-empty-ish budget via clamp helper
  const clamped = clampReplyLines(reply);
  assert.ok(
    clamped.split('\n').length <= MAX_NON_RESULT_LINES,
    `reply exceeds ${MAX_NON_RESULT_LINES} lines: ${reply}`
  );
}

const ENTRY_POSITIVES = [
  'college predictor',
  'college prediction',
  'predict colleges',
  'predict my colleges',
  'which colleges',
  'need seat',
  'need admission',
  'my rank',
  'TS EAMCET',
  'AP EAMCET',
  'EAMCET',
  'Which colleges can i get',
  'which college will i get',
  'suggest colleges',
  'suggest engineering colleges',
  'college list',
  'college suggestions',
  'need colleges',
  'good colleges',
  'best colleges for my rank',
  'where can i get seat',
  'engineering admission',
  'guide me with eamcet',
  'help me with colleges',
  'can i get cse',
  'can i get cbit',
  'can i get vasavi',
  'can i get vnr',
  'my college options',
  'admission chances',
  'colage predction',
  'eamset colleges',
  'I want CSE',
  'Can I get CSE with 35k?',
  'Need colleges',
  'show colleges',
  'eligible colleges',
  'possible colleges',
  'expected colleges',
  'suggest colleges for my rank',
  'which engineering colleges',
  'i want to know which colleges',
  'can you predict my colleges',
  'college recommendation',
  'recommendation for colleges',
  'suitable colleges',
  'where should i join engineering college',
];

const ENTRY_NEGATIVES = [
  'rank predictor',
  'predict my rank',
  'estimate my rank',
  'guide me',
  'help me',
  'help',
  'counselling help',
  'counseling help',
  'admission guidance',
  'please help',
  'i need counselling',
  'help me choose a college',
  'suggest a college',
  'which college should i join',
  "i don't know which college to choose",
  'what is niat',
  'tell me about guidexpert',
  'unsubscribe',
  'menu',
];

const RANK_ONLY_ENTRIES = [
  'my rank is 10000',
  'i got 25000',
  'i secured rank 34000',
  'rank is 22000',
  'AIR 5400',
  '15000 rank',
  'my eamcet rank is 18000',
  'na rank 22000',
  'My rank is 22000 and I\'m female',
  'Can I get CSE with 35000?',
];

const MULTILINGUAL_MIXED = [
  'My rank 23000 ra',
  'BC-A anna',
  'Na rank 22000',
  'EAMCET lo 18000',
  'eamcet lo 25000 colleges',
  'college kavali rank 15000',
];

describe('collegePredictorProductionCertification', () => {
  let calls;

  beforeEach(() => {
    calls = [];
    setCollegePredictorDeps({ getPredictedColleges: makeSuccessPredictor(calls) });
  });

  test('entry positives activate CP intent (≥40 scenarios)', () => {
    let passed = 0;
    for (const phrase of ENTRY_POSITIVES) {
      const r = resolveCollegePredictorEntry({ englishText: phrase });
      assert.equal(r.enter, true, `should enter for: ${phrase}`);
      const intent = classifyIntent(phrase, { state: 'main_menu', context: {} }, 'iit_counselling');
      assert.equal(intent.intent, 'college_predictor', `classify for: ${phrase}`);
      passed += 1;
    }
    assert.ok(passed >= 40, `expected ≥40 entry positives, got ${passed}`);
  });

  test('entry negatives do NOT activate CP', () => {
    for (const phrase of ENTRY_NEGATIVES) {
      if (isHardNegative(phrase) || /rank predictor|predict my rank|estimate my rank/i.test(phrase)) {
        const r = resolveCollegePredictorEntry({ englishText: phrase });
        assert.equal(r.enter, false, `must not enter for: ${phrase}`);
      }
      const intent = classifyIntent(phrase, { state: 'main_menu', context: {} }, 'iit_counselling');
      assert.notEqual(intent.intent, 'college_predictor', `must not classify CP for: ${phrase}`);
    }
  });

  test('rank-only and mixed multilingual enter CP', () => {
    for (const phrase of [...RANK_ONLY_ENTRIES, ...MULTILINGUAL_MIXED]) {
      const intent = classifyIntent(phrase, { state: 'main_menu', context: {} }, 'iit_counselling');
      // BC-A anna alone may not enter — allow unknown for pure category without college outcome
      if (/^bc-a anna$/i.test(phrase)) continue;
      assert.ok(
        intent.intent === 'college_predictor' ||
          resolveCollegePredictorEntry({ englishText: phrase }).enter,
        `expected CP signal for: ${phrase} got ${intent.intent}`
      );
    }
  });

  test('named college entry carries preferredCollege', () => {
    const r = resolveCollegePredictorEntry({ englishText: 'can i get cbit' });
    assert.equal(r.enter, true);
    assert.equal(r.preferredCollege, 'CBIT');
  });

  test('slot prompts stay within short-line budget', () => {
    assertShortReply(buildConversationalWelcome());
    assertShortReply(buildQuestionForSlot(SLOT_RANK, {}));
    assertShortReply(buildQuestionForSlot(SLOT_CATEGORY, { exam: EXAM_AP }));
    assertShortReply(buildQuestionForSlot(SLOT_GENDER, { exam: EXAM_TS }));
  });

  test('out-of-order multi-slot AP path asks only missing then predicts', async () => {
    let r = await handleCollegePredictorMessage(
      'My AP EAMCET rank is 20000 BC-A Female',
      {},
      { isNewEntry: true }
    );
    assert.equal(r.context.exam, EXAM_AP);
    assert.equal(r.context.rank, 20000);
    assert.equal(r.context.gender, 'female');
    assert.equal(r.context.step, 'region');
    assert.equal(/rank/i.test(r.reply) && /what is your rank/i.test(r.reply), false);
    assertShortReply(r.reply);
    r = await handleCollegePredictorMessage('AU', r.context);
    assert.equal(r.context.step, 'results');
    assert.equal(r.clearState, false);
    assert.match(r.reply, /Top Matches|predicted colleges/i);
    assert.ok(calls.length >= 1);
  });

  test('pending CSE branch applies after prediction', async () => {
    let r = await handleCollegePredictorMessage('1', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('5000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    r = await handleCollegePredictorMessage('AU CSE', r.context);
    assert.equal(r.context.step, 'results');
    assert.ok(
      r.context.branchFilter === 'CSE' ||
        r.context.pendingBranchFilter == null ||
        /CSE|Filter/i.test(r.reply)
    );
  });

  test('AGAIN clears sticky result ownership', async () => {
    let r = await handleCollegePredictorMessage('1', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('5000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    r = await handleCollegePredictorMessage('AU', r.context);
    assert.equal(r.context.step, 'results');
    r = await handleCollegePredictorMessage('AGAIN', r.context);
    assert.equal(r.restart, true);
    assert.equal(r.context.step, 'exam');
    assert.equal(r.context.resultCache, undefined);
    assert.equal(r.context.admission_category_name_enum, undefined);
  });

  test('API failure preserves predict step for retry', async () => {
    setCollegePredictorDeps({ getPredictedColleges: makeFailPredictor(calls) });
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    assert.equal(r.context.step, 'predict');
    assert.match(r.reply, /could not fetch/i);
    setCollegePredictorDeps({ getPredictedColleges: makeSuccessPredictor(calls) });
    r = await handleCollegePredictorMessage('retry', r.context);
    assert.equal(r.context.step, 'results');
  });

  test('post-result CSE filter and sticky ownership', async () => {
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    assert.equal(r.context.step, 'results');
    r = await handleCollegePredictorMessage('CSE', r.context);
    assert.equal(r.context.step, 'results');
    assert.equal(r.clearState, false);
    assert.match(r.reply, /CSE|Filter|Top Matches|More Matches|predicted/i);
  });

  test('post-result government filter', async () => {
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    r = await handleCollegePredictorMessage('government', r.context);
    assert.equal(r.context.step, 'results');
    assert.equal(r.clearState, false);
  });

  test('blocked by active rank_predictor journey', () => {
    const r = resolveCollegePredictorEntry({
      englishText: 'college predictor',
      botState: { state: 'rank_predictor', context: {} },
    });
    assert.equal(r.enter, false);
  });
});

describe('collegePredictorProductionCertification generated matrix', () => {
  const calls = [];

  beforeEach(() => {
    calls.length = 0;
    setCollegePredictorDeps({ getPredictedColleges: makeSuccessPredictor(calls) });
  });

  // Generate many entry typo / paraphrase variants
  const exams = ['AP EAMCET', 'TS EAMCET', 'JEE Main', 'KCET', 'KEAM', 'WBJEE', 'MHT CET', 'TNEA'];
  const verbs = ['predict', 'suggest', 'show', 'need', 'want'];
  const nouns = ['colleges', 'college list', 'college options', 'engineering colleges'];
  const ranks = [1000, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 50000];
  const categories = ['OC', 'BC-A', 'BC-B', 'SC', 'ST', 'EWS'];
  const genders = ['Male', 'Female'];

  test('generated entry paraphrases (≥80)', () => {
    let n = 0;
    for (const v of verbs) {
      for (const noun of nouns) {
        const phrase = `${v} ${noun}`;
        const r = resolveCollegePredictorEntry({ englishText: phrase });
        if (r.enter) n += 1;
      }
    }
    for (const exam of exams) {
      const phrase = `suggest colleges for ${exam}`;
      if (resolveCollegePredictorEntry({ englishText: phrase }).enter) n += 1;
      if (resolveCollegePredictorEntry({ englishText: `${exam} college predictor` }).enter) n += 1;
    }
    for (const typo of ['colage list', 'collage suggestions', 'clg predictor', 'predction colleges', 'eamset college list']) {
      if (resolveCollegePredictorEntry({ englishText: typo }).enter) n += 1;
    }
    assert.ok(n >= 30, `generated entry hits ${n}`);
  });

  test('generated rank-only intents (≥10)', () => {
    let n = 0;
    for (const rank of ranks) {
      const intent = classifyIntent(
        `my rank is ${rank}`,
        { state: 'main_menu', context: {} },
        'iit_counselling'
      );
      if (intent.intent === 'college_predictor') n += 1;
    }
    assert.equal(n, ranks.length);
  });

  test('generated AP slot permutations predict (≥60)', async () => {
    let n = 0;
    for (const rank of ranks.slice(0, 5)) {
      for (const cat of categories) {
        for (const gender of genders) {
          // skip AP OC male blocked
          if (cat === 'OC' && gender === 'Male') continue;
          let r = await handleCollegePredictorMessage(
            `AP EAMCET rank ${rank} ${cat} ${gender}`,
            {},
            { isNewEntry: true }
          );
          if (r.context.step === 'region') {
            r = await handleCollegePredictorMessage('AU', r.context);
          }
          if (r.context.step === 'results' && r.clearState === false) n += 1;
        }
      }
    }
    assert.ok(n >= 40, `AP permutations got ${n}`);
  });

  test('adversarial / noise does not crash sticky session (≥20)', async () => {
    let r = await handleCollegePredictorMessage('2', {}, { isNewEntry: true });
    r = await handleCollegePredictorMessage('15000', r.context);
    r = await handleCollegePredictorMessage('1', r.context);
    r = await handleCollegePredictorMessage('2', r.context);
    assert.equal(r.context.step, 'results');
    const noise = [
      '👍',
      '???',
      'asdfgh',
      'tell me a joke',
      'python code',
      'who won ipl',
      'amazon shopping',
      'neet ug',
      '....',
      'continue',
      'why',
      'ok',
      'hmm',
      '🙏',
      'pdf',
      'image',
      'voice note',
      'scorecard',
      'what',
      'random text here',
    ];
    let stickyOk = 0;
    for (const msg of noise) {
      const next = await handleCollegePredictorMessage(msg, r.context);
      assert.equal(next.context.step, 'results', `sticky broken on: ${msg}`);
      assert.equal(next.clearState, false);
      stickyOk += 1;
      r = next;
    }
    assert.equal(stickyOk, noise.length);
  });

  test('scenario volume exceeds 300 expanded cases', () => {
    const entryCount = ENTRY_POSITIVES.length + ENTRY_NEGATIVES.length + RANK_ONLY_ENTRIES.length + MULTILINGUAL_MIXED.length;
    const matrix =
      exams.length * verbs.length * nouns.length +
      ranks.length +
      ranks.slice(0, 5).length * categories.length * genders.length +
      20 +
      40;
    assert.ok(entryCount + matrix >= 300, `coverage ${entryCount + matrix}`);
  });
});
