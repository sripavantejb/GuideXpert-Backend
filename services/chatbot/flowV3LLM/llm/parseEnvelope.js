'use strict';

/**
 * Parse the LLM's final JSON reply envelope (architecture §7.1).
 */

const ENVELOPE_INTENTS = Object.freeze([
  'ask_slot',
  'show_shortlist',
  'answer_question',
  'book',
  'escalate',
  'honest_exit',
]);

const PART_TYPES = Object.freeze(['text', 'buttons', 'list', 'image']);

function extractJsonObject(text) {
  let raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'empty', envelope: null };
  // Models routinely wrap the envelope in ```json fences despite instructions;
  // a fence is a formatting tic, not a malformed envelope.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
  if (fenced) raw = fenced[1].trim();
  try {
    return { ok: true, envelope: JSON.parse(raw), error: null };
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return { ok: true, envelope: JSON.parse(raw.slice(start, end + 1)), error: null };
      } catch (err) {
        return { ok: false, error: err.message, envelope: null };
      }
    }
    return { ok: false, error: 'not_json', envelope: null };
  }
}

/**
 * @param {string} text
 * @returns {{ ok: boolean, envelope: object|null, error: string|null, issues: string[] }}
 */
function parseEnvelope(text) {
  const extracted = extractJsonObject(text);
  if (!extracted.ok) {
    return { ok: false, envelope: null, error: extracted.error, issues: ['V-1_PARSE'] };
  }
  const envelope = extracted.envelope;
  const issues = [];
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, envelope: null, error: 'not_object', issues: ['V-1_SCHEMA'] };
  }
  if (!ENVELOPE_INTENTS.includes(envelope.intent)) {
    issues.push('V-1_INTENT');
  }
  if (!Array.isArray(envelope.parts) || envelope.parts.length === 0) {
    issues.push('V-1_PARTS');
  } else {
    for (const part of envelope.parts) {
      if (!part || !PART_TYPES.includes(part.type)) issues.push('V-1_PART_TYPE');
    }
  }
  if (!Array.isArray(envelope.grounding)) {
    envelope.grounding = [];
  }
  if (envelope.profile_patch == null) envelope.profile_patch = {};
  if (!Object.prototype.hasOwnProperty.call(envelope, 'booking_url_slot')) {
    envelope.booking_url_slot = null;
  }
  return {
    ok: issues.length === 0,
    envelope,
    error: issues.length ? issues.join(',') : null,
    issues,
  };
}

module.exports = {
  ENVELOPE_INTENTS,
  PART_TYPES,
  extractJsonObject,
  parseEnvelope,
};
