/**
 * whatsaapBotTej — system prompt storage for the simple WhatsApp AI bot.
 *
 * Own AppSettings key (separate from Flow V3's flowV3SystemPrompt, whose prompt
 * targets a structured-envelope engine and must not be shared with this bot).
 * Resolution order: MongoDB AppSettings override -> bundled systemPrompt.md.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AppSettings = require('../models/AppSettings');

const SIMPLE_CHATBOT_PROMPT_KEY = 'simpleChatbotSystemPrompt';
const MAX_PROMPT_BYTES = 100 * 1024;
const PROMPT_FILE = path.join(__dirname, 'systemPrompt.md');

const LAST_RESORT_PROMPT =
  'You are a helpful assistant for GuideXpert answering questions over WhatsApp. ' +
  'Keep replies short, friendly and plain-text (no markdown).';

function hashPrompt(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function readPromptFileSync() {
  try {
    const text = fs.readFileSync(PROMPT_FILE, 'utf8');
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** @returns {Promise<null|{ text: string, updatedAt: string|null, updatedByEmail: string|null }>} */
async function getPromptSetting() {
  try {
    const doc = await AppSettings.findOne({ key: SIMPLE_CHATBOT_PROMPT_KEY }).lean();
    if (!doc || !doc.value || typeof doc.value !== 'object') return null;
    const text = typeof doc.value.text === 'string' ? doc.value.text : null;
    if (!text || !text.trim()) return null;
    return {
      text,
      updatedAt: doc.value.updatedAt || (doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null),
      updatedByEmail: doc.value.updatedByEmail || null,
    };
  } catch (err) {
    console.error('[whatsaapBotTej] getPromptSetting error:', err.message);
    return null;
  }
}

/** Active prompt for the bot: DB override -> bundled file -> last-resort default. */
async function getActiveSystemPrompt() {
  const fromDb = await getPromptSetting();
  if (fromDb) return fromDb.text;
  return readPromptFileSync() || LAST_RESORT_PROMPT;
}

/** Persist an admin override to Mongo. */
async function setPromptSetting(rawText, admin = null) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('Prompt text must be a non-empty string');
  }
  const bytes = Buffer.byteLength(rawText, 'utf8');
  if (bytes > MAX_PROMPT_BYTES) {
    throw new Error(`Prompt text exceeds ${MAX_PROMPT_BYTES} bytes (got ${bytes})`);
  }

  const value = {
    text: rawText,
    updatedAt: new Date().toISOString(),
    updatedByEmail: (admin && (admin.email || admin.username)) || null,
  };
  await AppSettings.findOneAndUpdate(
    { key: SIMPLE_CHATBOT_PROMPT_KEY },
    { key: SIMPLE_CHATBOT_PROMPT_KEY, value },
    { upsert: true, new: true }
  );

  return {
    text: rawText,
    bytes,
    hash: hashPrompt(rawText),
    updatedAt: value.updatedAt,
    updatedByEmail: value.updatedByEmail,
    source: 'db',
  };
}

/** Resolve for admin GET: DB override, else bundled file default. */
async function resolvePromptForAdmin() {
  const fromDb = await getPromptSetting();
  if (fromDb) {
    return {
      text: fromDb.text,
      bytes: Buffer.byteLength(fromDb.text, 'utf8'),
      hash: hashPrompt(fromDb.text),
      updatedAt: fromDb.updatedAt,
      updatedByEmail: fromDb.updatedByEmail,
      source: 'db',
    };
  }
  const fileText = readPromptFileSync() || LAST_RESORT_PROMPT;
  return {
    text: fileText,
    bytes: Buffer.byteLength(fileText, 'utf8'),
    hash: hashPrompt(fileText),
    updatedAt: null,
    updatedByEmail: null,
    source: readPromptFileSync() ? 'file' : 'default',
  };
}

module.exports = {
  SIMPLE_CHATBOT_PROMPT_KEY,
  getActiveSystemPrompt,
  getPromptSetting,
  setPromptSetting,
  resolvePromptForAdmin,
};
