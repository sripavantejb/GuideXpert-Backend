'use strict';

const assert = require('assert');
const { INTENT, detectIntent, looksLikeCollegeName } = require('../services/webChat/webChatIntent');
const { processConversationTurn } = require('../services/webChat/webChatStateMachine');

function session(flow = 'idle', context = {}) {
  return { flow, context, phone: '', fullName: '' };
}

async function run() {
  // Intent: commands must not be college names
  for (const msg of ['Compare colleges', 'Menu', 'What is GuideXpert?', 'Help', 'Predict rank']) {
    assert.strictEqual(looksLikeCollegeName(msg), false, `${msg} should not look like college`);
    const intent = detectIntent(msg, { awaitingCollege: true });
    assert.notStrictEqual(intent.type, INTENT.COLLEGE_NAME, `${msg} must not be COLLEGE_NAME`);
  }

  assert.strictEqual(looksLikeCollegeName('NIT Trichy'), true);
  assert.strictEqual(looksLikeCollegeName('IIIT Hyderabad'), true);

  // Waiting for college A: "Compare colleges" should restart, not capture
  const started = await processConversationTurn({
    session: session('college_comparison', { step: 'collegeA', collegeAName: '', collegeBName: '' }),
    message: 'Compare colleges',
    identity: {},
  });
  assert.strictEqual(started.flow, 'college_comparison');
  assert.strictEqual(started.context.collegeAName || '', '');
  assert.match(started.reply, /first college/i);

  // Waiting: Menu clears
  const menu = await processConversationTurn({
    session: session('college_comparison', { step: 'collegeA' }),
    message: 'Menu',
    identity: {},
  });
  assert.strictEqual(menu.clearFlow, true);
  assert.strictEqual(menu.flow, 'idle');

  // Waiting: FAQ overrides
  const faq = await processConversationTurn({
    session: session('college_comparison', { step: 'collegeB', collegeAName: 'VIT' }),
    message: 'What is GuideXpert?',
    identity: {},
  });
  assert.strictEqual(faq.flow, 'idle');
  assert.ok(faq.clearFlow || faq.flow === 'idle');
  assert.doesNotMatch(String(faq.context?.collegeAName || ''), /What is GuideXpert/i);

  // Waiting: real college accepted
  const nameTurn = await processConversationTurn({
    session: session('college_comparison', { step: 'collegeA', collegeAName: '', collegeBName: '' }),
    message: 'NIT Trichy',
    identity: {},
  });
  assert.strictEqual(nameTurn.context.collegeAName, 'NIT Trichy');
  assert.strictEqual(nameTurn.context.step, 'collegeB');

  // Waiting: junk rejected
  const junk = await processConversationTurn({
    session: session('college_comparison', { step: 'collegeA' }),
    message: 'asdf??',
    identity: {},
  });
  assert.ok(!junk.context?.collegeAName || junk.context.step === 'collegeA');

  // Idle entry: Compare colleges asks for A, does not store phrase
  const entry = await processConversationTurn({
    session: session('idle'),
    message: 'Compare colleges',
    identity: {},
  });
  assert.strictEqual(entry.flow, 'college_comparison');
  assert.strictEqual(entry.context.collegeAName || '', '');

  console.log('webChat state machine checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
