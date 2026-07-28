'use strict';

const MENU_COMMAND_WORDS = ['menu', 'help'];

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesWordBoundary(text, word) {
  const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
  return pattern.test(text);
}

function matchesAny(text, phrases) {
  return phrases.some((p) => text.includes(p));
}

function matchesHelpMenuCommand(text) {
  return /^(help|help menu)\s*[.!?]?$/.test(String(text || '').trim());
}

function matchesMenuWord(text, word) {
  if (word === 'help') {
    return matchesHelpMenuCommand(text);
  }
  return matchesWordBoundary(text, word);
}

function matchesMenuCommands(text) {
  return MENU_COMMAND_WORDS.some((word) => matchesMenuWord(text, word));
}

/** Whole message only — avoids substring false positives (e.g. "they" vs "hey"). */
function matchesStandaloneGreeting(text) {
  return /^(hi|hello|hey|hola|namaste|start)$/.test(text);
}

/**
 * Explicit MENU / HELP only. Standalone greetings (hi/hello/start) must NOT
 * open the legacy IIT/GX main-menu — they enter Master Flow v2 instead.
 */
function matchesMainMenuTrigger(text) {
  return matchesMenuCommands(text);
}

module.exports = {
  MENU_COMMAND_WORDS,
  normalizeText,
  escapeRegExp,
  matchesWordBoundary,
  matchesAny,
  matchesHelpMenuCommand,
  matchesMenuWord,
  matchesMenuCommands,
  matchesStandaloneGreeting,
  matchesMainMenuTrigger,
};
