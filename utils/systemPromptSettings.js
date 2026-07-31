'use strict';

/**
 * Flow V3 system prompt — MongoDB source of truth (Vercel-safe) with optional
 * best-effort mirror to prompts/system_prompt.v1.md for local/dev.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AppSettings = require('../models/AppSettings');

const SYSTEM_PROMPT_KEY = 'flowV3SystemPrompt';
const MAX_PROMPT_BYTES = 100 * 1024; // ~100 KB
const PROMPT_FILE = path.join(__dirname, '..', 'prompts', 'system_prompt.v1.md');

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

function readPromptFileSync() {
  try {
    const text = fs.readFileSync(PROMPT_FILE, 'utf8');
    return {
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      hash: hashPrompt(text),
      path: PROMPT_FILE,
    };
  } catch {
    return null;
  }
}

/**
 * Best-effort write of the prompt to the .md file. On Vercel the filesystem is
 * read-only — log a warning and continue; Mongo remains the source of truth.
 */
function mirrorPromptToFile(text) {
  try {
    fs.writeFileSync(PROMPT_FILE, text, 'utf8');
    return { mirrored: true, path: PROMPT_FILE };
  } catch (err) {
    console.warn('[SystemPrompt] Failed to mirror prompt to .md (expected on serverless):', err.message);
    return { mirrored: false, path: PROMPT_FILE, error: err.message };
  }
}

/**
 * @returns {Promise<null|{ text: string, updatedAt: string|null, updatedByEmail: string|null }>}
 */
async function getSystemPromptSetting() {
  try {
    const doc = await AppSettings.findOne({ key: SYSTEM_PROMPT_KEY }).lean();
    if (!doc || !doc.value || typeof doc.value !== 'object') return null;
    const text = typeof doc.value.text === 'string' ? doc.value.text : null;
    if (!text) return null;
    return {
      text,
      updatedAt: doc.value.updatedAt || (doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null),
      updatedByEmail: doc.value.updatedByEmail || null,
    };
  } catch (err) {
    console.error('[SystemPrompt] getSystemPromptSetting error:', err.message);
    return null;
  }
}

/**
 * Persist prompt to Mongo and best-effort mirror to .md.
 * @param {string} rawText
 * @param {{ email?: string, username?: string }|null} admin
 */
async function setSystemPromptSetting(rawText, admin = null) {
  const { text, bytes } = validatePromptText(rawText);
  const updatedAt = new Date().toISOString();
  const updatedByEmail =
    (admin && (admin.email || admin.username)) || null;

  const value = {
    text,
    updatedAt,
    updatedByEmail,
  };

  await AppSettings.findOneAndUpdate(
    { key: SYSTEM_PROMPT_KEY },
    { key: SYSTEM_PROMPT_KEY, value },
    { upsert: true, new: true }
  );

  const mirror = mirrorPromptToFile(text);

  return {
    text,
    bytes,
    hash: hashPrompt(text),
    updatedAt,
    updatedByEmail,
    mirroredToFile: mirror.mirrored,
    source: 'db',
  };
}

/**
 * Resolve the prompt for the admin GET endpoint: prefer DB, else file.
 */
async function resolveSystemPromptForAdmin() {
  const fromDb = await getSystemPromptSetting();
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

  const fromFile = readPromptFileSync();
  if (fromFile) {
    return {
      text: fromFile.text,
      bytes: fromFile.bytes,
      hash: fromFile.hash,
      updatedAt: null,
      updatedByEmail: null,
      source: 'file',
    };
  }

  return {
    text: '',
    bytes: 0,
    hash: null,
    updatedAt: null,
    updatedByEmail: null,
    source: 'missing',
  };
}

module.exports = {
  SYSTEM_PROMPT_KEY,
  MAX_PROMPT_BYTES,
  PROMPT_FILE,
  hashPrompt,
  validatePromptText,
  getSystemPromptSetting,
  setSystemPromptSetting,
  resolveSystemPromptForAdmin,
  readPromptFileSync,
  mirrorPromptToFile,
};
