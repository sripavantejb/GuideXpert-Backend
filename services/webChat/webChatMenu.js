'use strict';

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

Say "menu" anytime to return here.`;

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
    quickReplies: QUICK_REPLIES_DEFAULT,
    ...extra,
  };
}

function buildMenuResponse(extra = {}) {
  return {
    reply: MENU_REPLY,
    flow: 'idle',
    context: {},
    quickReplies: QUICK_REPLIES_DEFAULT,
    ...extra,
  };
}

function isMenuCommand(text) {
  const t = String(text || '').trim().toLowerCase();
  return /^(menu|help|options|start|hi|hello|hey)$/.test(t);
}

function isResetCommand(text) {
  const t = String(text || '').trim().toLowerCase();
  return /^(reset|cancel|stop|exit|quit|back)$/.test(t);
}

function detectFlowStart(text) {
  const t = String(text || '').trim().toLowerCase();
  if (
    /college predict|predict college|shortlist college|which college|colleges for my rank|college predictor/.test(
      t
    )
  ) {
    return 'college_predictor';
  }
  if (/rank predict|predict rank|my rank|marks to rank|percentile to rank|rank from/.test(t)) {
    return 'rank_predictor';
  }
  if (/compare college|college compar|vs | versus /.test(t)) {
    return 'college_comparison';
  }
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
