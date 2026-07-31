'use strict';

/**
 * System prompt loader — version pin + content hash.
 *
 * Provider-agnostic by construction: it returns the prompt TEXT and its
 * identity, never provider-shaped messages. How that text is framed for a
 * specific vendor belongs to llmLoop, which is blocked on D-1/D-2.
 *
 * The prompt version is pinned at turn 1 and reused for every later turn in the
 * conversation, so a mid-conversation deploy cannot change the counsellor's
 * voice halfway through, and every turn log replays against the exact text used.
 *
 * Prompt files are NEVER edited in place — a change means a new version file.
 * No prompt content is authored here: `prompts/system_prompt.v1.md` is
 * student-facing copy and is owned by product. A missing file is a loud error,
 * never a silently invented default.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROMPT_DIR = path.join(__dirname, '..', '..', '..', '..', 'prompts');
const PROMPT_FILE_PATTERN = /^system_prompt\.v(\d+)\.md$/;
const DEFAULT_VERSION = 'v1';

const cache = new Map();

class PromptNotFoundError extends Error {
  constructor(version, dir) {
    super(
      `system_prompt.${version}.md not found in ${dir} — author it in prompts/ (student-facing copy, not generated)`
    );
    this.name = 'PromptNotFoundError';
    this.code = 'PROMPT_NOT_FOUND';
    this.version = version;
  }
}

function promptPath(version, dir = PROMPT_DIR) {
  return path.join(dir, `system_prompt.${version}.md`);
}

function listAvailableVersions(dir = PROMPT_DIR) {
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch (err) {
    // F-9: a deploy that drops prompts/ must be VISIBLE — an empty version
    // list silently degrades every turn to the fallback prompt path.
    console.error('[flowV3] PROMPT_DIR_UNREADABLE', {
      dir,
      error: err && err.message ? err.message : String(err),
    });
    return [];
  }
  return files
    .map((file) => PROMPT_FILE_PATTERN.exec(file))
    .filter(Boolean)
    .map((match) => ({ version: `v${match[1]}`, number: Number(match[1]) }))
    .sort((a, b) => a.number - b.number)
    .map((entry) => entry.version);
}

function latestVersion(dir = PROMPT_DIR) {
  const versions = listAvailableVersions(dir);
  return versions.length ? versions[versions.length - 1] : null;
}

function hashPrompt(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * @param {string} [version] defaults to the conversation pin, else latest on disk
 * @param {{ dir?: string, noCache?: boolean }} [options]
 * @returns {{ version: string, hash: string, text: string, path: string, bytes: number }}
 */
function loadPrompt(version = null, options = {}) {
  const dir = options.dir || PROMPT_DIR;
  const resolved = version || latestVersion(dir) || DEFAULT_VERSION;
  const cacheKey = `${dir}::${resolved}`;

  if (!options.noCache && cache.has(cacheKey)) return cache.get(cacheKey);

  const file = promptPath(resolved, dir);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new PromptNotFoundError(resolved, dir);
  }

  const record = Object.freeze({
    version: resolved,
    hash: hashPrompt(text),
    text,
    path: file,
    bytes: Buffer.byteLength(text, 'utf8'),
  });
  cache.set(cacheKey, record);
  return record;
}

/**
 * Turn-1 pin. Later turns pass the stored pin straight back so the whole
 * conversation runs on one prompt version.
 */
function resolvePinnedVersion(conversationPin = null, options = {}) {
  if (conversationPin) return conversationPin;
  return latestVersion(options.dir || PROMPT_DIR) || DEFAULT_VERSION;
}

function clearPromptCache() {
  cache.clear();
}

module.exports = {
  PROMPT_DIR,
  PromptNotFoundError,
  loadPrompt,
  listAvailableVersions,
  latestVersion,
  resolvePinnedVersion,
  hashPrompt,
  clearPromptCache,
};
