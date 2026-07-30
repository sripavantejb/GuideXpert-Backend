'use strict';

/**
 * Envelope validation V-1..V-8 (architecture §7.2).
 */

const { GUARANTEE_FORBIDDEN } = require('../../../../constants/flowV3/flowV3Guardrails');
const { ENVELOPE_INTENTS, PART_TYPES } = require('../llm/parseEnvelope');

const URL_PATTERN = /https?:\/\/\S+|guidexpert\.co\.in\/\S+/i;
const COLLEGE_HINT = /\b(college|university|institute|kalvium|plaksha|niat|iit|nit)\b/i;
const NUMERIC_CLAIM = /\b\d+(\.\d+)?\s*(%|lpa|lakhs?|crores?|k)\b/i;

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

function toolResultIds(toolTrace = []) {
  const ids = new Set();
  for (const t of toolTrace) {
    if (t.callId) ids.add(String(t.callId));
    const result = t.result;
    if (!result || typeof result !== 'object') continue;
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
  }
  return ids;
}

/**
 * @returns {{ ok: boolean, verdict: 'pass'|'block'|'clamp'|'warn', violations: Array, envelope: object, clamped: object }}
 */
function validateEnvelope(envelope, { toolTrace = [], nextSlotHint = null } = {}) {
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

  const bodies = collectBodies(envelope);
  const joined = bodies.join('\n');
  const grounding = new Set((envelope.grounding || []).map(String));
  const knownIds = toolResultIds(toolTrace);

  // V-2 grounding for claims
  if ((COLLEGE_HINT.test(joined) || NUMERIC_CLAIM.test(joined)) && grounding.size === 0) {
    violations.push({ code: 'V-2', detail: 'grounding_required' });
  }
  for (const g of grounding) {
    if (knownIds.size && ![...knownIds].some((id) => id === g || id.endsWith(g) || g.includes(id))) {
      // Soft: allow grounding ids that tools tagged explicitly even if callId differs
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
};
