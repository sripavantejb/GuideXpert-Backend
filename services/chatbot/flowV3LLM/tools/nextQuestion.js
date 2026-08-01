'use strict';

const { nextFlowV3Slot } = require('../profile/flowV3NextSlot');

/**
 * M-1 wrapper — next profile slot for LLM routing (no copy invention).
 *
 * The profile is taken from the SERVER-side tool context, never from
 * model-supplied args: live models called this with empty/partial profiles,
 * which reset the walk to B1 and re-asked answered questions forever
 * (conformance finding G-1). Model args may only tune beats/academicYear;
 * they cannot substitute the profile truth.
 *
 * @param {{ profile?: object, slotMeta?: object, beats?: string[], academicYear?: number|null, now?: Date }} args
 * @param {{ profile?: object, slotMeta?: object, deps?: { nextFlowV3Slot?: Function } }} [_ctx]
 * @returns {{slot,beat,askable,isStale,reason}|{done:true}}
 */
function run(args = {}, _ctx = {}) {
  const nextSlotFn = (_ctx.deps && _ctx.deps.nextFlowV3Slot) || nextFlowV3Slot;
  const hasServerProfile = _ctx.profile && typeof _ctx.profile === 'object';
  const profile = hasServerProfile ? _ctx.profile : args.profile || {};
  const slotMeta = hasServerProfile ? _ctx.slotMeta || {} : args.slotMeta || {};
  const options = {
    slotMeta,
    beats: args.beats,
    academicYear: args.academicYear,
    now: args.now,
  };
  return nextSlotFn(profile, options);
}

module.exports = { run };
