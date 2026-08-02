'use strict';

/**
 * Flow V3 system prompt — MongoDB source of truth (Vercel-safe) with optional
 * best-effort mirror to prompts/system_prompt.v1.md for local/dev.
 * Every successful save is also appended to SystemPromptHistory.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const AppSettings = require('../models/AppSettings');
const SystemPromptHistory = require('../models/SystemPromptHistory');

const SYSTEM_PROMPT_KEY = 'flowV3SystemPrompt';
const MAX_PROMPT_BYTES = 100 * 1024; // ~100 KB
const HISTORY_LIST_LIMIT = 50;
const PREVIEW_CHARS = 120;
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

function previewText(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= PREVIEW_CHARS) return flat;
  return `${flat.slice(0, PREVIEW_CHARS)}…`;
}

async function insertHistorySnapshot({ text, bytes, hash, updatedAt, updatedByEmail }) {
  const at = updatedAt ? new Date(updatedAt) : new Date();
  await SystemPromptHistory.create({
    text,
    hash: hash || hashPrompt(text),
    bytes: bytes != null ? bytes : Buffer.byteLength(text, 'utf8'),
    updatedAt: Number.isNaN(at.getTime()) ? new Date() : at,
    updatedByEmail: updatedByEmail || null,
  });
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
 * Persist prompt to Mongo, snapshot history, and best-effort mirror to .md.
 * @param {string} rawText
 * @param {{ email?: string, username?: string }|null} admin
 */
async function setSystemPromptSetting(rawText, admin = null) {
  const { text, bytes } = validatePromptText(rawText);
  const updatedAt = new Date().toISOString();
  const updatedByEmail =
    (admin && (admin.email || admin.username)) || null;
  const hash = hashPrompt(text);

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

  try {
    await insertHistorySnapshot({ text, bytes, hash, updatedAt, updatedByEmail });
  } catch (err) {
    console.error('[SystemPrompt] history snapshot failed:', err.message);
  }

  const mirror = mirrorPromptToFile(text);

  return {
    text,
    bytes,
    hash,
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

async function seedHistoryFromCurrentIfEmpty() {
  const count = await SystemPromptHistory.countDocuments();
  if (count > 0) return;
  const current = await getSystemPromptSetting();
  if (!current || !current.text) return;
  await insertHistorySnapshot({
    text: current.text,
    bytes: Buffer.byteLength(current.text, 'utf8'),
    hash: hashPrompt(current.text),
    updatedAt: current.updatedAt || new Date().toISOString(),
    updatedByEmail: current.updatedByEmail,
  });
}

/**
 * List recent prompt versions (preview only — no full text).
 * @param {{ limit?: number }} [opts]
 */
async function listSystemPromptHistory(opts = {}) {
  const limitRaw = Number(opts.limit);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), HISTORY_LIST_LIMIT)
      : HISTORY_LIST_LIMIT;

  await seedHistoryFromCurrentIfEmpty();

  const rows = await SystemPromptHistory.find({})
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select('hash bytes updatedAt updatedByEmail text')
    .lean();

  return rows.map((row) => ({
    id: String(row._id),
    hash: row.hash,
    bytes: row.bytes,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    updatedByEmail: row.updatedByEmail || null,
    textPreview: previewText(row.text),
  }));
}

/**
 * Full history item for modal / copy.
 * @param {string} id
 */
async function getSystemPromptHistoryById(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
    return null;
  }
  const row = await SystemPromptHistory.findById(id).lean();
  if (!row) return null;
  return {
    id: String(row._id),
    text: row.text,
    hash: row.hash,
    bytes: row.bytes,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    updatedByEmail: row.updatedByEmail || null,
  };
}

module.exports = {
  SYSTEM_PROMPT_KEY,
  MAX_PROMPT_BYTES,
  HISTORY_LIST_LIMIT,
  PROMPT_FILE,
  hashPrompt,
  validatePromptText,
  getSystemPromptSetting,
  setSystemPromptSetting,
  resolveSystemPromptForAdmin,
  listSystemPromptHistory,
  getSystemPromptHistoryById,
  readPromptFileSync,
  mirrorPromptToFile,
};
