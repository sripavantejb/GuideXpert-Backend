'use strict';

/**
 * Website chatbot (student panel web chat) system prompt — MongoDB source of
 * truth with a hardcoded default fallback. Mirrors the Flow V3 WhatsApp
 * system prompt pipeline (utils/systemPromptSettings.js).
 */

const crypto = require('crypto');
const AppSettings = require('../models/AppSettings');

const WEB_CHAT_PROMPT_KEY = 'webChatSystemPrompt';
const MAX_PROMPT_BYTES = 100 * 1024; // ~100 KB

const DEFAULT_WEB_CHAT_SYSTEM_PROMPT = `You are GuideXpert's website assistant. Answer briefly using ONLY the provided knowledge snippets.
If the snippets do not contain the answer, say you are not sure and suggest opening the relevant tool on GuideXpert or booking a counselling session.
Do not invent fees, cutoffs, placements, or guarantees. Keep answers under 80 words.`;

const CACHE_TTL_MS = 60 * 1000;
let cachedText = null;
let cachedAt = 0;

function hashPrompt(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function validatePromptText(raw) {
  if (typeof raw !== 'string') {
    throw new Error('Prompt text must be a string');
  }
  const text = raw; // preserve trailing newlines; only reject empty after trim
  if (!text.trim()) {
    throw new Error('Prompt text must be non-empty');
  }
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_PROMPT_BYTES) {
    throw new Error(`Prompt text exceeds ${MAX_PROMPT_BYTES} bytes (got ${bytes})`);
  }
  return { text, bytes };
}

/**
 * @returns {Promise<null|{ text: string, updatedAt: string|null, updatedByEmail: string|null }>}
 */
async function getWebChatPromptSetting() {
  try {
    const doc = await AppSettings.findOne({ key: WEB_CHAT_PROMPT_KEY }).lean();
    if (!doc || !doc.value || typeof doc.value !== 'object') return null;
    const text = typeof doc.value.text === 'string' ? doc.value.text : null;
    if (!text) return null;
    return {
      text,
      updatedAt: doc.value.updatedAt || (doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null),
      updatedByEmail: doc.value.updatedByEmail || null,
    };
  } catch (err) {
    console.error('[WebChatPrompt] getWebChatPromptSetting error:', err.message);
    return null;
  }
}

/**
 * Persist prompt to Mongo and update the in-memory runtime cache immediately.
 * @param {string} rawText
 * @param {{ email?: string, username?: string }|null} admin
 */
async function setWebChatPromptSetting(rawText, admin = null) {
  const { text, bytes } = validatePromptText(rawText);
  const updatedAt = new Date().toISOString();
  const updatedByEmail = (admin && (admin.email || admin.username)) || null;

  const value = { text, updatedAt, updatedByEmail };

  await AppSettings.findOneAndUpdate(
    { key: WEB_CHAT_PROMPT_KEY },
    { key: WEB_CHAT_PROMPT_KEY, value },
    { upsert: true, new: true }
  );

  cachedText = text;
  cachedAt = Date.now();

  return {
    text,
    bytes,
    hash: hashPrompt(text),
    updatedAt,
    updatedByEmail,
    source: 'db',
  };
}

/**
 * Resolve the prompt for the admin GET endpoint: prefer DB, else default.
 */
async function resolveWebChatPromptForAdmin() {
  const fromDb = await getWebChatPromptSetting();
  if (fromDb && fromDb.text) {
    return {
      text: fromDb.text,
      bytes: Buffer.byteLength(fromDb.text, 'utf8'),
      hash: hashPrompt(fromDb.text),
      updatedAt: fromDb.updatedAt,
      updatedByEmail: fromDb.updatedByEmail,
      source: 'db',
    };
  }

  return {
    text: DEFAULT_WEB_CHAT_SYSTEM_PROMPT,
    bytes: Buffer.byteLength(DEFAULT_WEB_CHAT_SYSTEM_PROMPT, 'utf8'),
    hash: hashPrompt(DEFAULT_WEB_CHAT_SYSTEM_PROMPT),
    updatedAt: null,
    updatedByEmail: null,
    source: 'default',
  };
}

/**
 * Runtime getter used by the web chat LLM call. DB-backed with a 60s TTL
 * in-memory cache; falls back to the default prompt if nothing is stored or
 * the DB read fails.
 * @returns {Promise<string>}
 */
async function getActiveWebChatSystemPrompt() {
  const now = Date.now();
  if (cachedText && now - cachedAt < CACHE_TTL_MS) {
    return cachedText;
  }

  const setting = await getWebChatPromptSetting();
  cachedAt = now;
  cachedText = setting && setting.text ? setting.text : DEFAULT_WEB_CHAT_SYSTEM_PROMPT;
  return cachedText;
}

function clearWebChatPromptCache() {
  cachedText = null;
  cachedAt = 0;
}

module.exports = {
  WEB_CHAT_PROMPT_KEY,
  MAX_PROMPT_BYTES,
  DEFAULT_WEB_CHAT_SYSTEM_PROMPT,
  hashPrompt,
  validatePromptText,
  getWebChatPromptSetting,
  setWebChatPromptSetting,
  resolveWebChatPromptForAdmin,
  getActiveWebChatSystemPrompt,
  clearWebChatPromptCache,
};
