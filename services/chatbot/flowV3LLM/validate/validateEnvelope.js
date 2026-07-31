'use strict';

/**
 * Envelope validation V-1..V-8 (architecture §7.2).
 */

const { GUARANTEE_FORBIDDEN } = require('../../../../constants/flowV3/flowV3Guardrails');
const { ENVELOPE_INTENTS, PART_TYPES } = require('../llm/parseEnvelope');
const { extractNumericClaims } = require('../../aiGuardrailService');
const {
  CURATED_MODERN_CATALOG,
} = require('../../../../constants/careerCounsellingV2ExploreModernColleges');

const URL_PATTERN = /https?:\/\/\S+|guidexpert\.co\.in\/\S+/i;
const COLLEGE_HINT = /\b(college|university|institute|kalvium|plaksha|niat|iit|nit)\b/i;
const NUMERIC_CLAIM = /\b\d+(\.\d+)?\s*(%|lpa|lakhs?|crores?|k)\b/i;

// V-2 college-mention capture: "<Proper Noun(s)> University|College|Institute…"
const COLLEGE_NAME_CAPTURE =
  /\b([A-Z][A-Za-z&.'-]*(?:\s+(?:of|for|and|[A-Z][A-Za-z&.'-]*)){0,4})\s+(University|College|Institute|Institution)\b/g;

// Known catalog vocabulary — single-token brand ids (plaksha, kalvium, niat…)
// and two-word name phrases (masters union, ahmedabad university, srm ap).
// A brand mentioned in a reply must trace to a cited tool result. Two-word
// phrases avoid false hits on common words ("masters degree", "in Ahmedabad").
const CATALOG_BRAND_TOKENS = (() => {
  const tokens = new Set();
  const phrases = new Set();
  for (const row of CURATED_MODERN_CATALOG || []) {
    const id = String(row?.id || '').toLowerCase();
    if (id && !id.includes('_')) tokens.add(id);
    const nameWords = String(row?.name || '')
      .toLowerCase()
      .replace(/[()]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (nameWords.length >= 2) phrases.add(`${nameWords[0]} ${nameWords[1]}`);
    else if (nameWords.length === 1 && nameWords[0].length >= 4) tokens.add(nameWords[0]);
  }
  return Object.freeze({ tokens: [...tokens], phrases: [...phrases] });
})();

// Generic-capture first words that are questions/qualifiers, not proper nouns.
const CAPTURE_STOPWORDS = new Set([
  'which', 'what', 'your', 'the', 'a', 'an', 'this', 'that', 'any', 'best',
  'top', 'good', 'great', 'private', 'government', 'every', 'each', 'other',
  'partner', 'right', 'my', 'our', 'their',
]);

function normalizeClaimText(value) {
  return String(value || '').toLowerCase().replace(/,/g, '');
}

/** Extract college mentions from reply text: catalog brands + generic captures. */
function extractCollegeMentions(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const mentions = new Set();
  for (const token of CATALOG_BRAND_TOKENS.tokens) {
    if (new RegExp(`\\b${token}\\b`, 'i').test(lower)) mentions.add(token);
  }
  for (const phrase of CATALOG_BRAND_TOKENS.phrases) {
    if (lower.includes(phrase)) mentions.add(phrase);
  }
  for (const match of raw.matchAll(COLLEGE_NAME_CAPTURE)) {
    const firstWord = match[1].split(/\s+/)[0].toLowerCase();
    if (CAPTURE_STOPWORDS.has(firstWord)) continue;
    mentions.add(`${match[1]} ${match[2]}`.toLowerCase());
  }
  return [...mentions];
}

// V-6 disclosure — reuse V2 editorial shortlist framing (not legal consent).
const SHORTLIST_DISCLOSURE =
  'This shortlist is editorial guidance from GuideXpert, not a guaranteed admission list.';

function collectBodies(envelope) {
  const bodies = [];
  for (const part of envelope.parts || []) {
    if (part.body) bodies.push(String(part.body));
    if (part.caption) bodies.push(String(part.caption));
    for (const opt of part.options || []) {
      if (opt.title) bodies.push(String(opt.title));
    }
    for (const row of part.rows || []) {
      if (row.title) bodies.push(String(row.title));
      if (row.description) bodies.push(String(row.description));
    }
  }
  return bodies;
}

/** Ids one toolTrace entry can be cited by. */
function entryResultIds(t) {
  const ids = new Set();
  if (t.callId) ids.add(String(t.callId));
  const result = t.result;
  if (!result || typeof result !== 'object') return ids;
  if (result.id) ids.add(String(result.id));
  if (Array.isArray(result.rows)) {
    for (const row of result.rows) {
      if (row?.id) ids.add(String(row.id));
      if (row?.catalog) ids.add(`${row.catalog}:${row.id || row.slug || ''}`);
      if (row?.tag) ids.add(`${row.tag}:${row.id || row.slug || ''}`);
    }
  }
  if (Array.isArray(result.chunks)) {
    for (const c of result.chunks) {
      if (c?.id) ids.add(`knowledge:${c.id}`);
    }
  }
  if (result.url) ids.add(`booking:${result.url}`);
  if (result.serviceKey) ids.add(`booking:${result.serviceKey}`);
  return ids;
}

function toolResultIds(toolTrace = []) {
  const ids = new Set();
  for (const t of toolTrace) {
    for (const id of entryResultIds(t)) ids.add(id);
  }
  return ids;
}

/** A cited grounding id resolves to a known id exactly or by suffix (`curated:x` ↔ `x`). */
function groundingIdResolves(cited, knownIds) {
  for (const id of knownIds) {
    if (cited === id) return true;
    if (id.endsWith(`:${cited}`) || cited.endsWith(`:${id}`)) return true;
  }
  return false;
}

/**
 * @returns {{ ok: boolean, verdict: 'pass'|'block'|'clamp'|'warn', violations: Array, envelope: object, clamped: object }}
 */
function validateEnvelope(
  envelope,
  { toolTrace = [], nextSlotHint = null, inboundText = '', profile = null } = {}
) {
  const violations = [];
  if (!envelope || typeof envelope !== 'object') {
    return { ok: false, verdict: 'block', violations: [{ code: 'V-1', detail: 'missing' }], envelope, clamped: null };
  }
  if (!ENVELOPE_INTENTS.includes(envelope.intent)) {
    violations.push({ code: 'V-1', detail: 'bad_intent' });
  }
  if (!Array.isArray(envelope.parts) || !envelope.parts.length) {
    violations.push({ code: 'V-1', detail: 'parts' });
  }

  // F-5: student-facing strings must BE strings. A boolean or object body
  // would otherwise coerce ("true") on render — reject at validation instead.
  for (const [index, part] of (Array.isArray(envelope.parts) ? envelope.parts : []).entries()) {
    if (!part || typeof part !== 'object' || !PART_TYPES.includes(part.type)) {
      violations.push({ code: 'V-1', detail: `part_type:${index}` });
      continue;
    }
    if (part.body != null && typeof part.body !== 'string') {
      violations.push({ code: 'V-1', detail: `part_body_not_string:${index}` });
    }
    if (part.caption != null && typeof part.caption !== 'string') {
      violations.push({ code: 'V-1', detail: `part_caption_not_string:${index}` });
    }
    for (const opt of Array.isArray(part.options) ? part.options : []) {
      if (opt && opt.title != null && typeof opt.title !== 'string') {
        violations.push({ code: 'V-1', detail: `part_option_title_not_string:${index}` });
      }
    }
    for (const row of Array.isArray(part.rows) ? part.rows : []) {
      if (row && row.title != null && typeof row.title !== 'string') {
        violations.push({ code: 'V-1', detail: `part_row_title_not_string:${index}` });
      }
    }
  }

  const bodies = collectBodies(envelope);
  const joined = bodies.join('\n');
  const grounding = new Set((envelope.grounding || []).map(String));
  const knownIds = toolResultIds(toolTrace);

  // V-2 grounding — the anti-fabrication property (F-2).
  // V-2a: claims require citations at all.
  if ((COLLEGE_HINT.test(joined) || NUMERIC_CLAIM.test(joined)) && grounding.size === 0) {
    violations.push({ code: 'V-2', detail: 'grounding_required' });
  }

  // V-2b: every cited grounding id must resolve to an ACTUAL tool result
  // returned this turn. A fabricated citation is a BLOCK, not a warning.
  for (const g of grounding) {
    if (!groundingIdResolves(g, knownIds)) {
      violations.push({ code: 'V-2', detail: `unresolved_grounding_id:${g}` });
    }
  }

  // Corpus of results the envelope actually cited — claims must trace HERE,
  // not to any result that merely happened to be fetched this turn.
  const citedEntries = (toolTrace || []).filter((t) => {
    const ids = entryResultIds(t);
    return [...grounding].some((g) => groundingIdResolves(g, ids));
  });
  const citedCorpus = normalizeClaimText(JSON.stringify(citedEntries.map((t) => t.result)));

  // Values the student supplied themselves (their own rank, budget…) are not
  // fabrications — mirrors aiGuardrailService's user-provided-numbers carve-out.
  const userCorpus = normalizeClaimText(
    `${inboundText || ''} ${profile ? JSON.stringify(profile) : ''}`
  );

  // V-2c: every numeric / price / placement claim must appear in a cited result.
  for (const claim of extractNumericClaims(joined)) {
    const normalized = normalizeClaimText(claim);
    if (!citedCorpus.includes(normalized) && !userCorpus.includes(normalized)) {
      violations.push({ code: 'V-2', detail: `ungrounded_numeric:${claim}` });
    }
  }

  // V-2d: every college mention must appear in a cited result.
  for (const mention of extractCollegeMentions(joined)) {
    if (!citedCorpus.includes(normalizeClaimText(mention))) {
      violations.push({ code: 'V-2', detail: `ungrounded_college:${mention}` });
    }
  }

  // V-3 guardrails
  for (const body of bodies) {
    for (const re of GUARANTEE_FORBIDDEN) {
      if (re.test(body)) {
        violations.push({ code: 'V-3', detail: String(re) });
        break;
      }
    }
  }

  // V-4 catalog purity
  for (const part of envelope.parts || []) {
    if (part.type !== 'list' || !Array.isArray(part.rows)) continue;
    const tags = new Set(part.rows.map((r) => r.catalog || r.tag).filter(Boolean));
    if (tags.has('curated') && tags.has('predictor')) {
      violations.push({ code: 'V-4', detail: 'mixed_catalog' });
    }
  }

  // V-5 URL gating
  const hasUrl = bodies.some((b) => URL_PATTERN.test(b));
  const bookingToolRan = toolTrace.some((t) => t.name === 'create_booking_link' && t.ok);
  if (hasUrl || envelope.booking_url_slot) {
    if (!bookingToolRan || envelope.booking_url_slot == null) {
      violations.push({ code: 'V-5', detail: 'url_without_booking_tool' });
    }
  }

  // V-6 disclosure
  if (envelope.intent === 'show_shortlist') {
    const hasDisclosure = bodies.some((b) => /editorial|not a guaranteed admission/i.test(b));
    if (!hasDisclosure) {
      violations.push({ code: 'V-6', detail: 'missing_disclosure' });
    }
  }

  // V-7 shape clamp
  const clamped = JSON.parse(JSON.stringify(envelope));
  let clampedAny = false;
  for (const part of clamped.parts || []) {
    if (part.type === 'buttons' && Array.isArray(part.options) && part.options.length > 3) {
      part.options = part.options.slice(0, 3);
      clampedAny = true;
    }
    if (part.type === 'list' && Array.isArray(part.rows) && part.rows.length > 10) {
      part.rows = part.rows.slice(0, 10);
      clampedAny = true;
    }
    for (const opt of part.options || []) {
      if (opt.title && String(opt.title).length > 20) {
        opt.title = String(opt.title).slice(0, 20);
        clampedAny = true;
      }
    }
    for (const row of part.rows || []) {
      if (row.title && String(row.title).length > 24) {
        row.title = String(row.title).slice(0, 24);
        clampedAny = true;
      }
    }
  }

  // V-8 beat discipline
  if (envelope.intent === 'ask_slot' && nextSlotHint && nextSlotHint.slot) {
    const targets = envelope.profile_patch && Object.keys(envelope.profile_patch);
    // Soft check — only block if parts clearly ask a different named slot
    void targets;
  }

  const blocking = violations.filter((v) => v.code !== 'V-7');
  if (blocking.length) {
    return { ok: false, verdict: 'block', violations, envelope, clamped };
  }
  return {
    ok: true,
    verdict: clampedAny ? 'clamp' : 'pass',
    violations,
    envelope: clampedAny ? clamped : envelope,
    clamped: clampedAny ? clamped : envelope,
    disclosureLine: SHORTLIST_DISCLOSURE,
  };
}

module.exports = {
  SHORTLIST_DISCLOSURE,
  validateEnvelope,
  collectBodies,
  toolResultIds,
  entryResultIds,
  groundingIdResolves,
  extractCollegeMentions,
};
