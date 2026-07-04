'use strict';

/**
 * Generic entity normalization layer.
 *
 * Each entity type defines:
 *   - canonicalValues: the ordered set of valid outputs
 *   - aliases: Map<normalized_input_token → canonical_value>
 *   - patterns: Array<{ value, re }> for regex matching
 *
 * Normalizers are registered by name and resolved via `normalizeEntity(type, text)`.
 * All matching is case-insensitive, hyphen/space/underscore-tolerant, and works with
 * complete sentences (I belong to BC-B / నేను OC / My category is EWS).
 */

const NORMALIZERS = new Map();

/**
 * @typedef {{ value: string, confidence: 'high'|'medium'|'low' }|null} NormResult
 */

/**
 * Register a named entity normalizer.
 *
 * @param {string} name
 * @param {{
 *   canonicalValues: string[],
 *   aliasMap: Record<string, string>,
 *   patterns?: Array<{ value: string, re: RegExp }>,
 * }} definition
 */
function register(name, definition) {
  NORMALIZERS.set(name, {
    canonicalValues: [...definition.canonicalValues],
    aliasMap: { ...definition.aliasMap },
    patterns: definition.patterns || [],
  });
}

/**
 * Collapse whitespace, hyphens, underscores into a single compact token for lookup.
 * Keeps letters and digits only for alias map lookups.
 */
function compactToken(text) {
  return String(text || '')
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]+/g, '');
}

/**
 * Strip NL sentence prefixes that precede the actual entity value.
 * Examples:
 *   "I belong to BC-B"      → "BC-B"
 *   "My category is EWS"    → "EWS"
 *   "నేను OC"               → "OC"    (Telugu "I am")
 *   "నా category OC"        → "OC"    (Telugu "my category")
 *   "main OBC hu"           → "OBC"   (Hinglish "I am OBC")
 */
const SENTENCE_PREFIX_RE = /^(?:i(?:'m|'m|\s+am|\s+belong\s+to|\s+come\s+under|\s+fall\s+under|\s+fall\s+in|\s+fall\s+into|\s+am\s+an?\s+|\s+am\s+under)|my\s+(?:reservation\s+)?category\s+is|my\s+(?:caste|community|class)\s+is|i\s+(?:am\s+an?\s+|am\s+from\s+)?(?:open|general|oc|bc|sc|st|ews|obc)|నేను(?:\s+\S+)?|నా\s+\S+\s*(?:is|:)?|నాకు\s+|నాది\s+|main\s+|mera\s+category\s+(?:hai|he|hai)?\s*|meri\s+category\s+(?:hai|he|hai)?\s*|mujhe\s+|category\s*(?:is|:)?\s*|reservation\s+category\s*(?:is|:)?\s*)\s*/i;

function stripSentencePrefix(text) {
  return String(text || '').replace(SENTENCE_PREFIX_RE, '').trim();
}

/**
 * Normalize a free-form user input to one of the canonical entity values.
 *
 * @param {string} type - registered entity name
 * @param {string} text - raw user input
 * @returns {NormResult}
 */
function normalizeEntity(type, text) {
  const def = NORMALIZERS.get(type);
  if (!def) return null;
  const raw = String(text || '').trim();
  if (!raw) return null;

  // 1. Run each registered regex pattern (highest priority)
  for (const { value, re } of def.patterns) {
    if (re.test(raw)) {
      return { value, confidence: 'high' };
    }
  }

  // 2. Strip sentence prefix and look up the remainder
  const stripped = stripSentencePrefix(raw);

  // Try the stripped token
  const lookup = compactToken(stripped);
  if (lookup && def.aliasMap[lookup]) {
    return { value: def.aliasMap[lookup], confidence: 'high' };
  }

  // 3. Try the full raw input alias map
  const fullLookup = compactToken(raw);
  if (fullLookup && def.aliasMap[fullLookup]) {
    return { value: def.aliasMap[fullLookup], confidence: 'high' };
  }

  // 4. Exact or prefix canonical match on stripped
  const strippedUp = stripped.toUpperCase().trim();
  for (const canonical of def.canonicalValues) {
    if (canonical.toUpperCase() === strippedUp) {
      return { value: canonical, confidence: 'high' };
    }
  }

  // 5. Substring match (stripped contains the canonical)
  const strippedLower = stripped.toLowerCase();
  for (const canonical of def.canonicalValues) {
    const c = canonical.toLowerCase();
    if (strippedLower === c || strippedLower.includes(c)) {
      return { value: canonical, confidence: 'medium' };
    }
  }

  // 6. Pattern match on raw lowercased for non-digit alias tokens.
  // Digit aliases (e.g. menu "3") only match bare digit input (steps 2–3) so decimals
  // like "94.3" do not false-positive on \b3\b word boundaries.
  const rawLower = raw.toLowerCase();
  for (const [aliasKey, canonVal] of Object.entries(def.aliasMap)) {
    if (!aliasKey || /^\d+$/.test(aliasKey)) continue;
    const escapedAlias = aliasKey.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenPat = new RegExp(`\\b${escapedAlias}\\b`, 'i');
    if (tokenPat.test(rawLower)) {
      return { value: canonVal, confidence: 'medium' };
    }
  }

  return null;
}

/**
 * Convenience: return just the canonical value string, or null.
 */
function normalizeEntityValue(type, text) {
  const result = normalizeEntity(type, text);
  return result ? result.value : null;
}

/**
 * List all registered entity types.
 */
function listEntityTypes() {
  return [...NORMALIZERS.keys()];
}

module.exports = {
  register,
  normalizeEntity,
  normalizeEntityValue,
  listEntityTypes,
  compactToken,
  stripSentencePrefix,
};
