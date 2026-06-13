const { formatGuidanceBookingDate } = require('./guidanceBookingWhatsApp');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const GUIDANCE_SLOT_BOOKING_CUTOFF_MINUTES = 15;

/**
 * Parse a single time token like "1:00 PM", "11AM", "6 PM".
 * @param {string} token
 * @returns {{ hour: number, minute: number }|null}
 */
function parseTimeToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;

  const ampmMatch = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)$/i);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const minute = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const isPm = ampmMatch[3].toUpperCase() === 'PM';
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    return { hour, minute };
  }

  const colonMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (colonMatch) {
    return {
      hour: parseInt(colonMatch[1], 10),
      minute: parseInt(colonMatch[2], 10),
    };
  }

  return null;
}

/**
 * Split slotTime into start/end tokens.
 * @param {string} slotTime
 * @returns {[string, string]|null}
 */
function splitSlotTimeRange(slotTime) {
  const raw = String(slotTime || '').trim();
  if (!raw) return null;

  const separators = [/\s+to\s+/i, /\s*-\s*/, /\s+–\s+/];
  for (const sep of separators) {
    if (sep.test(raw)) {
      const parts = raw.split(sep).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return [parts[0], parts[1]];
      }
    }
  }

  return [raw, ''];
}

function istDateTimeToUtc(slotDate, hour, minute) {
  const iso = String(slotDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const h = Math.min(23, Math.max(0, hour));
  const m = Math.min(59, Math.max(0, minute));
  const d = new Date(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {{ slotDate?: string, slotTime?: string }} slot
 * @returns {{ startUtc: Date, endUtc: Date, startLabel: string, endLabel: string, slotDateLabel: string }|null}
 */
function parseGuidanceSlotTimeWindow(slot) {
  const slotDate = String(slot?.slotDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) return null;

  const range = splitSlotTimeRange(slot?.slotTime);
  if (!range) return null;

  const [startToken, endToken] = range;
  const startParsed = parseTimeToken(startToken);
  if (!startParsed) return null;

  const startUtc = istDateTimeToUtc(slotDate, startParsed.hour, startParsed.minute);
  if (!startUtc) return null;

  let endUtc = null;
  let endLabel = '';

  if (endToken) {
    const endParsed = parseTimeToken(endToken);
    if (endParsed) {
      endUtc = istDateTimeToUtc(slotDate, endParsed.hour, endParsed.minute);
      endLabel = endToken.trim();
    }
  }

  if (!endUtc || endUtc.getTime() <= startUtc.getTime()) {
    endUtc = new Date(startUtc.getTime() + 60 * 60 * 1000);
    endLabel = endLabel || '1 hour after start';
  }

  return {
    startUtc,
    endUtc,
    startLabel: startToken.trim(),
    endLabel,
    slotDateLabel: formatGuidanceBookingDate(slotDate),
  };
}

/**
 * @param {{ slotDate?: string, slotTime?: string }} slot
 * @param {Date} [now]
 * @param {{ earlyJoinMinutes?: number }} [options]
 * @returns {{ allowed: boolean, window: ReturnType<typeof parseGuidanceSlotTimeWindow>|null, reason?: string }}
 */
function isWithinGuidanceSlotWindow(slot, now = new Date(), options = {}) {
  const earlyJoinMinutes = options.earlyJoinMinutes ?? 5;
  const window = parseGuidanceSlotTimeWindow(slot);
  if (!window) {
    return { allowed: false, window: null, reason: 'Could not parse your session time.' };
  }

  const joinOpensAt = new Date(window.startUtc.getTime() - earlyJoinMinutes * 60 * 1000);
  const nowMs = now.getTime();

  if (nowMs < joinOpensAt.getTime()) {
    return {
      allowed: false,
      window,
      reason: `Your session is on ${window.slotDateLabel}, ${window.startLabel} – ${window.endLabel} IST. You can join during that time.`,
    };
  }

  if (nowMs > window.endUtc.getTime()) {
    return {
      allowed: false,
      window,
      reason: `Your session window (${window.startLabel} – ${window.endLabel} IST on ${window.slotDateLabel}) has ended.`,
    };
  }

  return { allowed: true, window };
}

/**
 * Booking form status: bookable, frozen (within cutoff before start), or ended.
 * @param {{ slotDate?: string, slotTime?: string }} slot
 * @param {Date} [now]
 * @param {{ bookingCutoffMinutes?: number }} [options]
 * @returns {{ status: 'bookable'|'frozen'|'ended', window: ReturnType<typeof parseGuidanceSlotTimeWindow>|null }}
 */
function getGuidanceSlotBookingStatus(slot, now = new Date(), options = {}) {
  const bookingCutoffMinutes = options.bookingCutoffMinutes ?? GUIDANCE_SLOT_BOOKING_CUTOFF_MINUTES;
  const window = parseGuidanceSlotTimeWindow(slot);
  if (!window) {
    return { status: 'bookable', window: null };
  }

  const nowMs = now.getTime();
  if (nowMs > window.endUtc.getTime()) {
    return { status: 'ended', window };
  }

  const bookingClosesAt = new Date(window.startUtc.getTime() - bookingCutoffMinutes * 60 * 1000);
  if (nowMs >= bookingClosesAt.getTime()) {
    return { status: 'frozen', window };
  }

  return { status: 'bookable', window };
}

function isGuidanceSlotBookable(slot, now = new Date(), options = {}) {
  return getGuidanceSlotBookingStatus(slot, now, options).status === 'bookable';
}

module.exports = {
  parseTimeToken,
  splitSlotTimeRange,
  parseGuidanceSlotTimeWindow,
  isWithinGuidanceSlotWindow,
  getGuidanceSlotBookingStatus,
  isGuidanceSlotBookable,
  IST_OFFSET_MS,
  GUIDANCE_SLOT_BOOKING_CUTOFF_MINUTES,
};
