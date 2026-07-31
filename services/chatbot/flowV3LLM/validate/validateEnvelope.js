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
// V-2a guards hard rule 1 ("never invent a college NAME"): known institution
// names need tool grounding. The generic words college/university/institute
// alone blocked ordinary counselling copy (including the greeting "choose a
// college that truly fits") on every turn; proper-noun college mentions are
// covered by V-2d's COLLEGE_NAME_CAPTURE against the cited corpus.
const COLLEGE_HINT = /\b(kalvium|plaksha|niat|iit|nit)\b/i;
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

// V-8 — which named slot is a reply asking about? Patterns are anchored to
// the distinctive vocabulary of each askable slot's V2 question so a generic
// coaching line never false-positives.
const SLOT_ASK_PATTERNS = Object.freeze({
  qualification: /\b(current qualification|which (class|grade|year) are you|studying in (class|which))\b/i,
  goalPriority: /\bwhat matters (to you )?(the )?most\b/i,
  goal: /\bwhat are you looking for\b/i,
  interests: /\b(which )?topics (excite|interest) you\b/i,
  budgetBand: /\b(budget|comfortable for your family|fee range|afford per year)\b/i,
  cityPref: /\b(which city|near home,? or open to moving|preferred (city|location))\b/i,
});

/** @returns {string[]} slots whose ask-vocabulary appears in the text */
function detectAskedSlots(text) {
  const found = [];
  for (const [slotKey, pattern] of Object.entries(SLOT_ASK_PATTERNS)) {
    if (pattern.test(text)) found.push(slotKey);
  }
  return found;
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
      // Models cite by display name as often as by id ("curated:Krea
      // University"); the row is real server data either way.
      if (row?.name) {
        ids.add(String(row.name));
        if (row.catalog) ids.add(`${row.catalog}:${row.name}`);
      }
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
  const c = String(cited).toLowerCase();
  for (const id of knownIds) {
    const k = String(id).toLowerCase();
    if (c === k) return true;
    if (k.endsWith(`:${c}`) || c.endsWith(`:${k}`)) return true;
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
  // The separator must break \s+ adjacency: joined with plain whitespace,
  // consecutive title-case button titles ("Career Scope" + "College Fit")
  // formed phantom college names for COLLEGE_NAME_CAPTURE and blocked benign
  // option lists as ungrounded college mentions.
  const joined = bodies.join('\n|\n');
  const grounding = new Set((envelope.grounding || []).map(String));
  const knownIds = toolResultIds(toolTrace);

  // Full-turn tool corpus: everything ANY successful tool returned this turn.
  // The anti-fabrication property (F-2) is about the model inventing facts;
  // a name/number that appears verbatim in a server tool result this turn is
  // server truth even when the model forgot the grounding-id bookkeeping.
  const fullToolCorpus = normalizeClaimText(
    JSON.stringify((toolTrace || []).filter((t) => t.ok !== false).map((t) => t.result))
  );

  // Values the student supplied themselves (their own rank, budget…) are not
  // fabrications — mirrors aiGuardrailService's user-provided-numbers carve-out.
  const userCorpus = normalizeClaimText(
    `${inboundText || ''} ${profile ? JSON.stringify(profile) : ''}`
  );

  // V-2 grounding — the anti-fabrication property (F-2).
  // V-2a: claims require citations at all. Numbers the student stated
  // themselves don't (echoing "your budget is 2-3 lakhs" back is not a claim
  // the model invented — blocking it pushed benign acks into fallback).
  const numericNeedsGrounding =
    NUMERIC_CLAIM.test(joined) &&
    extractNumericClaims(joined).some((claim) => !userCorpus.includes(normalizeClaimText(claim)));
  if ((COLLEGE_HINT.test(joined) || numericNeedsGrounding) && grounding.size === 0) {
    // Missing citations are only a violation when the content can't be traced
    // to this turn's tool results — V-2c/V-2d below auto-ground traceable
    // mentions, so blocking here would discard a reply built from real data.
    const allTraceable =
      extractCollegeMentions(joined).every((m) =>
        fullToolCorpus.includes(normalizeClaimText(m))
      ) &&
      extractNumericClaims(joined).every(
        (c) =>
          userCorpus.includes(normalizeClaimText(c)) ||
          fullToolCorpus.includes(normalizeClaimText(c))
      );
    if (!allTraceable) {
      violations.push({ code: 'V-2', detail: 'grounding_required' });
    }
  }

  // V-2b: a cited grounding id that resolves to an ACTUAL tool result from
  // this turn stays; anything else is stripped as citation noise. Models cite
  // eagerly and in odd shapes ("curated: Name1, Name2, …", "knowledge:
  // placements") — the anti-fabrication property lives on the CLAIMS in the
  // reply (V-2c numeric, V-2d college), which must trace to server tool
  // results regardless of what the citation strings say. Blocking on citation
  // shape discarded replies whose every fact was real (observed: a shortlist
  // of 10 genuine catalog rows fell to Tier B over a comma-joined citation).
  for (const g of grounding) {
    if (!groundingIdResolves(g, knownIds)) {
      grounding.delete(g);
      console.warn('[flowV3] V2_UNRESOLVED_GROUNDING_STRIPPED', { id: g });
    }
  }
  if (Array.isArray(envelope.grounding)) {
    envelope.grounding = envelope.grounding.filter((g) => grounding.has(String(g)));
  }

  // Corpus of results the envelope actually cited — claims must trace HERE,
  // not to any result that merely happened to be fetched this turn.
  const citedEntries = (toolTrace || []).filter((t) => {
    const ids = entryResultIds(t);
    return [...grounding].some((g) => groundingIdResolves(g, ids));
  });
  const citedCorpus = normalizeClaimText(JSON.stringify(citedEntries.map((t) => t.result)));

  // Auto-grounding: instead of discarding an otherwise correct reply
  // (observed: a shortlist built FROM get_curated_catalog rows blocked as
  // "ungrounded" because envelope.grounding was empty), attach the ids of the
  // tool-result rows the mention actually traces to.
  const autoGrounded = new Set();
  const autoGroundIdsFor = (needle) => {
    for (const t of toolTrace || []) {
      if (t.ok === false || !t.result) continue;
      if (!normalizeClaimText(JSON.stringify(t.result)).includes(needle)) continue;
      const rows = Array.isArray(t.result.rows) ? t.result.rows : [];
      let added = false;
      for (const row of rows) {
        if (row?.id && normalizeClaimText(JSON.stringify(row)).includes(needle)) {
          autoGrounded.add(String(row.id));
          added = true;
        }
      }
      if (!added && t.callId) autoGrounded.add(String(t.callId));
    }
  };

  // V-2c: every numeric / price / placement claim must trace to a tool result
  // from this turn (cited or auto-grounded) or to the student's own words.
  for (const claim of extractNumericClaims(joined)) {
    const normalized = normalizeClaimText(claim);
    if (citedCorpus.includes(normalized) || userCorpus.includes(normalized)) continue;
    if (fullToolCorpus.includes(normalized)) {
      autoGroundIdsFor(normalized);
      continue;
    }
    violations.push({ code: 'V-2', detail: `ungrounded_numeric:${claim}` });
  }

  // V-2d: every college mention must trace to a tool result from this turn.
  for (const mention of extractCollegeMentions(joined)) {
    const normalized = normalizeClaimText(mention);
    if (citedCorpus.includes(normalized)) continue;
    if (fullToolCorpus.includes(normalized)) {
      autoGroundIdsFor(normalized);
      continue;
    }
    violations.push({ code: 'V-2', detail: `ungrounded_college:${mention}` });
  }

  if (autoGrounded.size) {
    console.warn('[flowV3] V2_AUTO_GROUNDED', { ids: [...autoGrounded] });
    envelope.grounding = [...new Set([...(envelope.grounding || []), ...autoGrounded])];
  }

  // V-3 guardrails. The mandated V-6 disclosure line contains "guaranteed"
  // ("…not a guaranteed admission list"), so a compliant shortlist envelope
  // tripped V-3 — the validator forbade the exact line the system requires
  // (conformance finding 8). Strip the disclosure before scanning; every
  // OTHER occurrence of guarantee language still blocks.
  for (const body of bodies) {
    const scannable = body.split(SHORTLIST_DISCLOSURE).join(' ');
    for (const re of GUARANTEE_FORBIDDEN) {
      if (re.test(scannable)) {
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

  // V-6 disclosure — mandatory on shortlist replies. Appending it is a
  // deterministic server-side fix, so a compliant-but-forgetful envelope gets
  // corrected rather than thrown away for a Tier B holding reply.
  if (envelope.intent === 'show_shortlist') {
    const hasDisclosure = bodies.some((b) => /editorial|not a guaranteed admission/i.test(b));
    if (!hasDisclosure && Array.isArray(envelope.parts)) {
      const lastText = [...envelope.parts].reverse().find((p) => p && p.type === 'text');
      if (lastText) {
        lastText.body = `${lastText.body || ''}\n\n${SHORTLIST_DISCLOSURE}`.trim();
      } else {
        envelope.parts.push({ type: 'text', body: SHORTLIST_DISCLOSURE });
      }
      console.warn('[flowV3] V6_DISCLOSURE_APPENDED');
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

  // V-8 beat discipline (F-8): an ask_slot envelope must ask the slot the
  // deterministic walk selected — one beat ahead, never a different one.
  // Conservative on purpose: blocks only when the reply UNAMBIGUOUSLY asks a
  // different named slot (exactly one foreign slot pattern matches and the
  // expected slot's pattern does not).
  if (envelope.intent === 'ask_slot' && nextSlotHint && nextSlotHint.slot) {
    const asked = detectAskedSlots(joined);
    const expected = nextSlotHint.slot;
    if (asked.length === 1 && asked[0] !== expected) {
      violations.push({
        code: 'V-8',
        detail: `beat_discipline:asked=${asked[0]},expected=${expected}`,
      });
    }
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
  detectAskedSlots,
};
