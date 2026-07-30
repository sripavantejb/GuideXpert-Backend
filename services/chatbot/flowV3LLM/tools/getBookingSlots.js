'use strict';

const defaultGuidanceBookingService = require('../../../guidanceBookingService');

/**
 * M-1 guidance booking slots — verbatim slotDate / slotTime from guidanceBookingService.
 * @param {object} [_args]
 * @param {{ deps?: { getAvailableActiveSlots?: Function } }} [_ctx]
 */
async function run(_args = {}, _ctx = {}) {
  const getSlots =
    (_ctx.deps && _ctx.deps.getAvailableActiveSlots) ||
    defaultGuidanceBookingService.getAvailableActiveSlots;

  const slots = await getSlots();
  const rows = (Array.isArray(slots) ? slots : []).map((slot) => ({
    id: slot.id,
    sessionTitle: slot.sessionTitle,
    slotDate: slot.slotDate,
    slotTime: slot.slotTime,
    maxBookings: slot.maxBookings,
    currentBookings: slot.currentBookings,
    spotsLeft: slot.spotsLeft,
    counselorName: slot.counselorName,
    collegeName: slot.collegeName,
    designation: slot.designation,
    bookingClosed: slot.bookingClosed,
  }));

  return { ok: true, count: rows.length, slots: rows };
}

module.exports = { run };
