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
 * No prompt content is authored here: `prompts/system_prompt.v1.md` is
 * student-facing copy and is owned by product. A missing file is a loud error,
 * never a silently invented default.
 *
 * Admin edits overwrite v1 in place via MongoDB (source of truth on Vercel) and
 * an in-memory override so the running instance applies immediately. The .md
 * file remains the seed/fallback when no DB override exists.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROMPT_DIR = path.join(__dirname, '..', '..', '..', '..', 'prompts');
const PROMPT_FILE_PATTERN = /^system_prompt\.v(\d+)\.md$/;
const DEFAULT_VERSION = 'v1';
const DEFAULT_REFRESH_MAX_AGE_MS = 60_000;

const cache = new Map();

/** In-memory override from Mongo / admin save. When set, loadPrompt prefers this. */
let promptOverride = null; // { text, hash, bytes, version, setAt }
let lastDbRefreshAt = 0;
let refreshInFlight = null;

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
  } catch {
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

function buildOverrideRecord(text, version = DEFAULT_VERSION) {
  return Object.freeze({
    version,
    hash: hashPrompt(text),
    text,
    path: 'override:db',
    bytes: Buffer.byteLength(text, 'utf8'),
    source: 'override',
  });
}

/**
 * Apply an in-memory override (admin save or DB refresh). Pass null/empty to clear.
 * @param {string|null} text
 */
function setPromptOverride(text) {
  if (typeof text === 'string' && text.trim()) {
    promptOverride = {
      text,
      hash: hashPrompt(text),
      bytes: Buffer.byteLength(text, 'utf8'),
      version: DEFAULT_VERSION,
      setAt: Date.now(),
    };
    // Drop file cache so subsequent loads without override still re-read disk.
    clearPromptCache();
  } else {
    promptOverride = null;
  }
}

function getPromptOverride() {
  return promptOverride;
}

/**
 * Refresh the in-memory override from MongoDB (TTL-gated).
 * Failures fall back silently to the file-based prompt.
 * @param {{ maxAgeMs?: number }} [options]
 */
async function refreshPromptOverrideFromDb(options = {}) {
  const maxAgeMs =
    typeof options.maxAgeMs === 'number' && options.maxAgeMs >= 0
      ? options.maxAgeMs
      : DEFAULT_REFRESH_MAX_AGE_MS;

  const now = Date.now();
  if (now - lastDbRefreshAt < maxAgeMs && promptOverride) {
    return { refreshed: false, reason: 'ttl' };
  }
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const { getSystemPromptSetting } = require('../../../../utils/systemPromptSettings');
      const setting = await getSystemPromptSetting();
      lastDbRefreshAt = Date.now();
      if (setting && typeof setting.text === 'string' && setting.text.trim()) {
        setPromptOverride(setting.text);
        return { refreshed: true, source: 'db', hash: promptOverride.hash };
      }
      // No DB record — keep existing override if any; otherwise file fallback.
      return { refreshed: true, source: 'none' };
    } catch (err) {
      lastDbRefreshAt = Date.now();
      console.warn('[flowV3] prompt DB refresh failed — using file/override', {
        error: err && err.message ? err.message : String(err),
      });
      return { refreshed: false, reason: 'error' };
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * @param {string} [version] defaults to the conversation pin, else latest on disk
 * @param {{ dir?: string, noCache?: boolean }} [options]
 * @returns {{ version: string, hash: string, text: string, path: string, bytes: number }}
 */
function loadPrompt(version = null, options = {}) {
  const dir = options.dir || PROMPT_DIR;
  const resolved = version || latestVersion(dir) || DEFAULT_VERSION;

  // Prefer in-memory override for v1 (admin-edited prompt applies immediately).
  if (
    promptOverride &&
    promptOverride.text &&
    (resolved === DEFAULT_VERSION || resolved === promptOverride.version)
  ) {
    return buildOverrideRecord(promptOverride.text, resolved);
  }

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
  setPromptOverride,
  getPromptOverride,
  refreshPromptOverrideFromDb,
};
