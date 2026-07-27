'use strict';

const {
  INTENT,
  detectIntent,
  isCompareEntryPhrase,
  isPredictCollegesPhrase,
  isPredictRankPhrase,
} = require('./webChatIntent');

const WELCOME_REPLY = `Hi! I'm GuideXpert Assistant.

I can help you with:
1. College predictor — shortlist colleges from your rank
2. Rank predictor — estimate rank from marks/percentile
3. College comparison — compare two colleges side-by-side
4. GuideXpert services & counselling FAQs

Type what you need, or tap a quick option below.`;

const MENU_REPLY = `Choose what you want to do:
• "Predict colleges" — college shortlist from rank
• "Predict rank" — rank from marks (JEE, EAMCET, KCET, etc.)
• "Compare colleges" — e.g. IIIT Hyderabad vs NIT Trichy
• Ask any GuideXpert question — fees, counselling, tools

Say "menu" anytime to return here. Say "cancel" to leave a tool mid-way.`;

const QUICK_REPLIES_DEFAULT = [
  'Predict colleges',
  'Predict rank',
  'Compare colleges',
  'What is GuideXpert?',
];

function buildWelcomeResponse(extra = {}) {
  return {
    reply: WELCOME_REPLY,
    flow: 'idle',
    context: {},
    clearFlow: true,
    quickReplies: QUICK_REPLIES_DEFAULT,
    ...extra,
  };
}

function buildMenuResponse(extra = {}) {
  return {
    reply: MENU_REPLY,
    flow: 'idle',
    context: {},
    clearFlow: true,
    quickReplies: QUICK_REPLIES_DEFAULT,
    ...extra,
  };
}

function isMenuCommand(text) {
  const intent = detectIntent(text);
  return intent.type === INTENT.MENU || intent.type === INTENT.HELP;
}

function isResetCommand(text) {
  const intent = detectIntent(text);
  return intent.type === INTENT.CANCEL || intent.type === INTENT.RESTART;
}

function detectFlowStart(text) {
  if (isPredictCollegesPhrase(text)) return 'college_predictor';
  if (isPredictRankPhrase(text)) return 'rank_predictor';
  if (isCompareEntryPhrase(text)) return 'college_comparison';
  const intent = detectIntent(text);
  if (intent.type === INTENT.COLLEGE_PAIR) return 'college_comparison';
  return null;
}

module.exports = {
  WELCOME_REPLY,
  MENU_REPLY,
  QUICK_REPLIES_DEFAULT,
  buildWelcomeResponse,
  buildMenuResponse,
  isMenuCommand,
  isResetCommand,
  detectFlowStart,
};
