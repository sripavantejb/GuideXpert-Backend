'use strict';

/**
 * Flow V3 next-slot wrapper over frozen nextSlot / isEmptyForGating.
 * Masks inferred-only and stale-volatile as empty for gating without flipping
 * frozen `askable` flags. Synthesizes {slot,beat,askable,isStale,reason}|{done:true}.
 */

const { nextSlot, isEmptyForGating } = require('../../flowV2/nextSlot');
const { LEAD_PROFILE_SCHEMA, BEAT_ORDER, getSlotsForBeat } =
  require('../../../../constants/careerCounsellingFlowV2Profile');
const { isEmptyForV3Gating, isStale } = require('./flowV3Staleness');

/**
 * Build a gating profile where inferred / stale-volatile slots look empty.
 */
function maskProfileForGating(profile = {}, slotMeta = {}, opts = {}) {
  const masked = { ...(profile || {}) };
  for (const key of Object.keys(LEAD_PROFILE_SCHEMA)) {
    const meta = slotMeta[key];
    if (isEmptyForV3Gating(masked[key], meta, { ...opts, path: key })) {
      const def = LEAD_PROFILE_SCHEMA[key];
      if (def.type === 'array') masked[key] = [];
      else masked[key] = null;
    }
  }
  return masked;
}

function beatForSlot(slotKey) {
  const def = LEAD_PROFILE_SCHEMA[slotKey];
  if (!def) return null;
  if (Array.isArray(def.writeBeats) && def.writeBeats.length) return def.writeBeats[0];
  if (Array.isArray(def.readBeats) && def.readBeats.length) return def.readBeats[0];
  for (const beat of BEAT_ORDER) {
    if (getSlotsForBeat(beat).includes(slotKey)) return beat;
  }
  return null;
}

/**
 * @param {object} profile
 * @param {{ slotMeta?: object, beats?: string[], academicYear?: number|null, now?: Date }} [options]
 * @returns {{slot:string,beat:string|null,askable:boolean,isStale:boolean,reason:string}|{done:true}}
 */
function nextFlowV3Slot(profile = {}, options = {}) {
  const slotMeta = options.slotMeta || {};
  const masked = maskProfileForGating(profile, slotMeta, options);
  const key = nextSlot(masked, { beats: options.beats });
  if (!key) return { done: true };

  const meta = slotMeta[key];
  const stale = Boolean(meta && isStale(meta, { ...options, path: key }));
  let reason = 'empty';
  if (meta && meta.source === 'inferred') reason = 'inferred_non_authoritative';
  else if (stale) reason = 'stale_volatile';

  const def = LEAD_PROFILE_SCHEMA[key];
  return {
    slot: key,
    beat: beatForSlot(key),
    askable: def ? def.askable === true : false,
    isStale: stale,
    reason,
    // Schema guidance so the LLM can SAVE the answer correctly: without the
    // value type/description the model guessed field names ("topics") and
    // free-form values for enum-ish slots, so update_lead_profile writes were
    // denied and the walk never advanced past free-text slots.
    valueType: def ? def.type || 'string' : 'string',
    valueHint: def ? def.description || null : null,
  };
}

module.exports = {
  nextFlowV3Slot,
  maskProfileForGating,
  beatForSlot,
  // re-export frozen helpers for tests / tools
  nextSlot,
  isEmptyForGating,
};
