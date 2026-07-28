'use strict';

/**
 * Centralized intent detection for GuideXpert website chat.
 * High-priority intents always outrank "waiting for college name" slot capture.
 */

const INTENT = Object.freeze({
  MENU: 'menu',
  CANCEL: 'cancel',
  HELP: 'help',
  RESTART: 'restart',
  COMPARE_COLLEGES: 'compare_colleges',
  PREDICT_COLLEGES: 'predict_colleges',
  PREDICT_RANK: 'predict_rank',
  GUIDEXPERT_FAQ: 'guidexpert_faq',
  GENERAL_QUESTION: 'general_question',
  COLLEGE_PAIR: 'college_pair',
  COLLEGE_NAME: 'college_name',
  UNKNOWN: 'unknown',
});

/** Intents that must interrupt any active tool flow. */
const HIGH_PRIORITY_INTENTS = new Set([
  INTENT.MENU,
  INTENT.CANCEL,
  INTENT.HELP,
  INTENT.RESTART,
  INTENT.COMPARE_COLLEGES,
  INTENT.PREDICT_COLLEGES,
  INTENT.PREDICT_RANK,
  INTENT.GUIDEXPERT_FAQ,
]);

const COMMAND_PHRASES = [
  'compare colleges',
  'compare college',
  'college comparison',
  'college compare',
  'predict colleges',
  'predict college',
  'college predictor',
  'shortlist colleges',
  'predict rank',
  'rank predictor',
  'menu',
  'help',
  'options',
  'start',
  'cancel',
  'stop',
  'exit',
  'quit',
  'back',
  'reset',
  'restart',
  'hi',
  'hello',
  'hey',
];

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function parseCollegePair(text) {
  const raw = normalizeText(text);
  const vsMatch = raw.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i);
  if (!vsMatch) return null;
  const a = vsMatch[1].trim();
  const b = vsMatch[2].trim();
  if (!a || !b) return null;
  return { collegeAName: a, collegeBName: b };
}

function isExactCommand(text) {
  const t = normalizeKey(text);
  return COMMAND_PHRASES.includes(t);
}

function isCompareEntryPhrase(text) {
  const t = normalizeKey(text);
  if (!t) return false;
  if (isExactCommand(t) && /compare|comparison/.test(t)) return true;
  return /^(compare(\s+colleges?)?|college\s+compar(e|ison)?|start\s+compar(e|ison)?)[!?.]*$/i.test(
    t
  );
}

function isPredictCollegesPhrase(text) {
  const t = normalizeKey(text);
  return (
    /college predict|predict college|shortlist college|which college|colleges for my rank|college predictor/.test(
      t
    ) || /^(predict(\s+colleges?)?|college\s+shortlist)[!?.]*$/.test(t)
  );
}

function isPredictRankPhrase(text) {
  const t = normalizeKey(text);
  return (
    /rank predict|predict rank|my rank|marks to rank|percentile to rank|rank from/.test(t) ||
    /^(predict\s+rank|rank\s+predictor)[!?.]*$/.test(t)
  );
}

function isMenuPhrase(text) {
  const t = normalizeKey(text);
  return /^(menu|options|start|main\s*menu)[!?.]*$/.test(t);
}

function isHelpPhrase(text) {
  const t = normalizeKey(text);
  return /^(help|how\s+can\s+you\s+help|what\s+can\s+you\s+do|commands?)[!?.]*$/.test(t);
}

function isCancelPhrase(text) {
  const t = normalizeKey(text);
  return /^(cancel|stop|exit|quit|back|never\s*mind|forget\s*it)[!?.]*$/.test(t);
}

function isRestartPhrase(text) {
  const t = normalizeKey(text);
  return /^(reset|restart|start\s+over|begin\s+again)[!?.]*$/.test(t);
}

function isGreeting(text) {
  const t = normalizeKey(text);
  return /^(hi|hello|hey|hola|namaste)[!?.]*$/.test(t);
}

function isGuideXpertFaqPhrase(text) {
  const t = normalizeKey(text);
  // Brand lowercases to "guidexpert" (Guide + Xpert)
  return /what is guidexpert|about guidexpert|who is guidexpert|what can you do|how can you help|what do you do|guidexpert (fees|services|counsell)/i.test(
    t
  );
}

function looksLikeGeneralQuestion(text) {
  const t = normalizeText(text);
  if (!t) return false;
  if (/\?$/.test(t)) return true;
  return /^(what|how|why|who|when|where|tell|explain|is|are|can|does|do|should)\b/i.test(t);
}

/**
 * Soft check: is this plausible as a college / institute name?
 * Rejects commands, questions, and tiny/noisy strings.
 */
function looksLikeCollegeName(text) {
  const raw = normalizeText(text);
  if (!raw) return false;
  if (raw.length < 2 || raw.length > 160) return false;

  const intent = detectIntent(raw, { mode: 'strict_commands_only' });
  if (HIGH_PRIORITY_INTENTS.has(intent.type)) return false;
  if (intent.type === INTENT.GENERAL_QUESTION) return false;
  if (intent.type === INTENT.GUIDEXPERT_FAQ) return false;

  if (isExactCommand(raw) || isCompareEntryPhrase(raw)) return false;
  if (isGreeting(raw)) return false;
  if (looksLikeGeneralQuestion(raw)) return false;
  if (/^(thanks|thank you|ok|okay|yes|no|yep|nope|sure|cool)$/i.test(raw)) return false;
  if (/^[^a-zA-Z0-9]+$/.test(raw)) return false;

  // Reject pure tool verbs without an institution token
  if (/^(compare|predict|shortlist|rank|menu|help)$/i.test(raw)) return false;

  return true;
}

function looksLikeCollegePair(text) {
  const pair = parseCollegePair(text);
  if (!pair) return false;
  return looksLikeCollegeName(pair.collegeAName) && looksLikeCollegeName(pair.collegeBName);
}

/**
 * @param {string} message
 * @param {{ mode?: 'normal'|'strict_commands_only', awaitingCollege?: boolean }} [opts]
 */
function detectIntent(message, opts = {}) {
  const text = normalizeText(message);
  const mode = opts.mode || 'normal';
  if (!text) {
    return { type: INTENT.UNKNOWN, confidence: 0, text, meta: {} };
  }

  // --- High priority (order matters) ---
  if (isCancelPhrase(text)) {
    return { type: INTENT.CANCEL, confidence: 1, text, meta: {} };
  }
  if (isRestartPhrase(text)) {
    return { type: INTENT.RESTART, confidence: 1, text, meta: {} };
  }
  if (isMenuPhrase(text) || isGreeting(text)) {
    return { type: INTENT.MENU, confidence: 1, text, meta: {} };
  }
  if (isHelpPhrase(text)) {
    return { type: INTENT.HELP, confidence: 1, text, meta: {} };
  }
  if (isGuideXpertFaqPhrase(text)) {
    return { type: INTENT.GUIDEXPERT_FAQ, confidence: 0.95, text, meta: {} };
  }
  if (isPredictCollegesPhrase(text)) {
    return { type: INTENT.PREDICT_COLLEGES, confidence: 0.95, text, meta: {} };
  }
  if (isPredictRankPhrase(text)) {
    return { type: INTENT.PREDICT_RANK, confidence: 0.95, text, meta: {} };
  }
  if (isCompareEntryPhrase(text)) {
    return { type: INTENT.COMPARE_COLLEGES, confidence: 0.95, text, meta: {} };
  }

  if (mode === 'strict_commands_only') {
    return { type: INTENT.UNKNOWN, confidence: 0.2, text, meta: {} };
  }

  // Valid "A vs B" college pair
  if (looksLikeCollegePair(text)) {
    const pair = parseCollegePair(text);
    return {
      type: INTENT.COLLEGE_PAIR,
      confidence: 0.9,
      text,
      meta: { pair },
    };
  }

  // Compare trigger that also includes a pair: "compare VIT vs SRM"
  const compareWithPair = text.match(
    /^(?:compare(?:\s+colleges?)?|college\s+compar(?:e|ison)?)\s+(.+)$/i
  );
  if (compareWithPair) {
    const rest = compareWithPair[1].trim();
    if (looksLikeCollegePair(rest)) {
      return {
        type: INTENT.COLLEGE_PAIR,
        confidence: 0.92,
        text,
        meta: { pair: parseCollegePair(rest), fromComparePhrase: true },
      };
    }
  }

  if (looksLikeGeneralQuestion(text) || isGuideXpertFaqPhrase(text)) {
    return {
      type: INTENT.GENERAL_QUESTION,
      confidence: 0.7,
      text,
      meta: {},
    };
  }

  // While waiting for a college, prefer classifying remaining text as a name
  // only after high-priority / question checks above.
  if (opts.awaitingCollege || looksLikeCollegeName(text)) {
    if (looksLikeCollegeName(text)) {
      return {
        type: INTENT.COLLEGE_NAME,
        confidence: opts.awaitingCollege ? 0.75 : 0.55,
        text,
        meta: { collegeName: text },
      };
    }
  }

  return { type: INTENT.UNKNOWN, confidence: 0.3, text, meta: {} };
}

function isHighPriorityIntent(type) {
  return HIGH_PRIORITY_INTENTS.has(type);
}

function intentToFlow(type) {
  if (type === INTENT.COMPARE_COLLEGES || type === INTENT.COLLEGE_PAIR) {
    return 'college_comparison';
  }
  if (type === INTENT.PREDICT_COLLEGES) return 'college_predictor';
  if (type === INTENT.PREDICT_RANK) return 'rank_predictor';
  return null;
}

module.exports = {
  INTENT,
  HIGH_PRIORITY_INTENTS,
  detectIntent,
  isHighPriorityIntent,
  intentToFlow,
  looksLikeCollegeName,
  looksLikeCollegePair,
  parseCollegePair,
  isCompareEntryPhrase,
  isPredictCollegesPhrase,
  isPredictRankPhrase,
  normalizeText,
};
