'use strict';

function cleanText(value) {
  return String(value || '').trim();
}

/** Short definition / brand questions should retrieve on their own (not blended with prior turns). */
const SELF_CONTAINED_QUERY_RE =
  /\b(niat|nat|guidexpert|new[- ]?age)\b|\b(what|tell me|know about|means?|meaning|define|explain)\b/i;

function getLastUserTurn(history = []) {
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message?.role !== 'user') continue;
    const content = cleanText(message.content);
    if (content) return content;
  }

  return null;
}

/**
 * Expand vague brand phrasings so keyword search hits the primary FAQ.
 * e.g. "tell me about niat" → includes "What exactly is NIAT?"
 */
function expandKnowledgeQuery(query) {
  const raw = cleanText(query);
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return raw;

  const expansions = {
    niat: 'What exactly is NIAT? What does NIAT mean? NIAT means',
    'what about niat': 'What exactly is NIAT? What does NIAT mean?',
    'tell me about niat': 'What exactly is NIAT? What does NIAT mean?',
    'know about niat': 'What exactly is NIAT? What does NIAT mean?',
    'i want to know about niat': 'What exactly is NIAT? What does NIAT mean?',
    'about niat': 'What exactly is NIAT? What does NIAT mean?',
    'niat means': 'What exactly is NIAT? What does NIAT mean? NIAT means',
    'meaning of niat': 'What exactly is NIAT? What does NIAT mean?',
    'what is niat': 'What exactly is NIAT?',
    'what exactly is niat': 'What exactly is NIAT?',
    'new age college': 'What is a new age college? What does new-age college mean?',
    'new age college means': 'What is a new age college? What does new-age college mean?',
    'new-age college': 'What is a new age college? What does new-age college mean?',
    'what is new age college': 'What is a new age college? What does new-age college mean?',
    'tell me about new age college': 'What is a new age college? What does new-age college mean?',
    'tell me about josaa': 'What is JoSAA?',
    'tell me about josaa counselling': 'What is JoSAA?',
    'about josaa': 'What is JoSAA?',
    'about josaa counselling': 'What is JoSAA?',
    'what is josaa': 'What is JoSAA?',
    'josaa counselling': 'What is JoSAA?',
    'tell me about csab': 'What is CSAB?',
    'what is csab': 'What is CSAB?',
  };

  const expanded = expansions[normalized];
  if (expanded) return `${raw} ${expanded}`;

  if (/\bniat\b/i.test(normalized) && /\b(about|tell|know|mean)/i.test(normalized)) {
    return `${raw} What exactly is NIAT? What does NIAT mean?`;
  }
  if (/\bnew[- ]?age\b/i.test(normalized)) {
    return `${raw} What is a new age college? What does new-age college mean?`;
  }
  if (/\bjos+a+a?\b/i.test(normalized)) {
    return `${raw} What is JoSAA?`;
  }
  if (/\bcsab\b/i.test(normalized) && /\b(about|tell|know|what|mean)/i.test(normalized)) {
    return `${raw} What is CSAB?`;
  }

  return raw;
}

function buildRetrievalQuery({ currentMessage, history } = {}) {
  const current = expandKnowledgeQuery(cleanText(currentMessage));
  const lastUserTurn = getLastUserTurn(history);

  if (!current) {
    return lastUserTurn || '';
  }

  // Definition / brand questions: do not blend with previous turns (hurts ranking + slows LLM).
  if (SELF_CONTAINED_QUERY_RE.test(currentMessage || '') || !lastUserTurn || lastUserTurn === current) {
    return current;
  }

  return `${lastUserTurn}\n${current}`;
}

module.exports = {
  buildRetrievalQuery,
  expandKnowledgeQuery,
  getLastUserTurn,
};
