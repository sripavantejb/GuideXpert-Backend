'use strict';

/**
 * Flow v2 — "what do I ask next" resolver.
 *
 * `nextSlot(profile)` walks the beat order (entry -> B1 -> ... -> B7) and
 * returns the first ASKABLE slot key that is still empty for its type. Returns
 * `null` once every slot in the walked beats is filled (meaning: advance
 * past the current beat / conversation can move on).
 *
 * This function does NOT generate question copy — that is Phase 2+.
 *
 * TRI-STATE GATING (Phase 1.1 correction): `boolean`/`object` slots default
 * to `null` ("not yet determined") per `careerCounsellingFlowV2Profile.js`.
 * A `false` boolean is a real, confidently-known answer — NOT the same as
 * "not yet asked" — so gating must check `=== null`/`=== undefined`, never
 * falsiness. This lets a later beat genuinely gate on a yes/no answer
 * (e.g. "is a parent present in this chat?"). There is no carve-out for
 * boolean/object slots when a future slot explicitly declares
 * `askable: true`. Metadata, derived fields, optional flags, and node
 * outputs are never questions merely because they belong to a beat.
 *
 * DESIGN NOTE — `beats` option (added, not in original spec): the full
 * `LEAD_PROFILE_SCHEMA` already includes B4-B7 slots (per the schema spec),
 * but Flow v2's B4-B7 conversational requiredness isn't finalized yet. The
 * optional second argument lets callers (including this phase's own tests,
 * and Phase 2's predictor bridge) scope the walk to a subset of beats — e.g.
 * `nextSlot(profile, { beats: ['entry','B1','B2','B3'] })` to check "is
 * B1-B3 done" without needing placeholder B4-B7 data. Omit it and the full
 * `BEAT_ORDER` is walked.
 */

const { LEAD_PROFILE_SCHEMA, BEAT_ORDER, getSlotsForBeat } = require('../../../constants/careerCounsellingFlowV2Profile');

function isEmptyForGating(slotDef, value) {
  if (slotDef.type === 'array') return !Array.isArray(value) || value.length === 0;
  if (slotDef.type === 'string') return value === null || value === undefined || value === '';
  // number/boolean/object: `null`/`undefined` = "not yet determined".
  // A `false` boolean (or any other falsy-but-set value) is answered, not empty.
  return value === null || value === undefined;
}

/**
 * @param {object} profile - a Flow v2 profile (typically from emptyFlowV2Profile() + merges)
 * @param {{ beats?: string[] }} [options] - optional beat subset to walk (defaults to full BEAT_ORDER)
 * @returns {string|null} next slot key to ask, or null if all walked slots are filled
 */
function nextSlot(profile = {}, options = {}) {
  const beats = Array.isArray(options.beats) && options.beats.length ? options.beats : BEAT_ORDER;
  const safeProfile = profile || {};

  for (const beat of beats) {
    for (const key of getSlotsForBeat(beat)) {
      const slotDef = LEAD_PROFILE_SCHEMA[key];
      if (slotDef.askable !== true) continue;
      if (isEmptyForGating(slotDef, safeProfile[key])) return key;
    }
  }
  return null;
}

module.exports = {
  nextSlot,
  isEmptyForGating,
};
