'use strict';

const { nextFlowV3Slot } = require('../profile/flowV3NextSlot');

/**
 * M-1 wrapper — next profile slot for LLM routing (no copy invention).
 * @param {{ profile?: object, slotMeta?: object, beats?: string[], academicYear?: number|null, now?: Date }} args
 * @param {{ deps?: { nextFlowV3Slot?: Function } }} [_ctx]
 * @returns {{slot,beat,askable,isStale,reason}|{done:true}}
 */
function run(args = {}, _ctx = {}) {
  const nextSlotFn = (_ctx.deps && _ctx.deps.nextFlowV3Slot) || nextFlowV3Slot;
  const profile = args.profile || {};
  const options = {
    slotMeta: args.slotMeta || {},
    beats: args.beats,
    academicYear: args.academicYear,
    now: args.now,
  };
  return nextSlotFn(profile, options);
}

module.exports = { run };
