'use strict';

/**
 * Flow v2 — Node 0 (booking override).
 *
 * Node 0 is a pre-empt, not a stage: `flowV2Dispatcher.processFlowV2Turn`
 * checks `detectOverrideIntent()` against every inbound message BEFORE any
 * stage-based routing, on every turn, regardless of `context.flowV2.stage`.
 * This lets a student jump straight to booking mid-Greeting (or from a
 * completely fresh conversation) without waiting for the current beat to
 * finish.
 *
 * HYBRID BOOKING (Flow V3 Phase 1 / HYBRID_BOOKING_WEBSITE_CREATE):
 * Show live GuidanceSlot options from getAvailableActiveSlots() in WhatsApp,
 * then on slot choice (or "Some other time") hand off to the official website
 * URL. WhatsApp NEVER creates OneOnOneCounselingLead or increments
 * GuidanceSlot.currentBookings — website remains the only booking-create path
 * (Section E / Phase 13 freeze).
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { extractFlowV2Slots } = require('../flowV2SlotExtractor');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const guidanceBookingService = require('../../../../services/guidanceBookingService');

/** Fail soft so a stuck Mongo buffer never stalls the WhatsApp turn. */
const LIVE_SLOT_FETCH_TIMEOUT_MS = 2500;

/**
 * Word-boundary-aware phrases (not bare substrings). E.g. "cancellation
 * policy" matches none of these phrases, and "humanities subjects" never
 * matches `human`, because `\bhuman\b` requires a word boundary immediately
 * after "human" — "humanities" has no such boundary ("n" is directly
 * followed by "i", both word characters).
 */
const OVERRIDE_PATTERNS = Object.freeze([
  /\bbook\b/i,
  /\bcall me\b/i,
  /\btalk to someone\b/i,
  /\bcounsellor\b/i,
  /\bcounselor\b/i,
  /\bsession\b/i,
  /\bhuman\b/i,
  /\bphone number\b/i,
  /\bconnect me\b/i,
  /\btalk to a person\b/i,
  /\bagent\b/i,
]);

/**
 * @param {string} text - inbound student message
 * @returns {boolean}
 */
function detectOverrideIntent(text) {
  const t = String(text || '');
  return OVERRIDE_PATTERNS.some((re) => re.test(t));
}

/** Single source of truth for the booking URL — a future URL change is a
 * one-line edit here, not a grep-and-hope across every file that mentions
 * it. */
const BOOKING_URL = 'https://www.guidexpert.co.in/one-on-one-session';

/**
 * Shared "here's the link" line, reused by B7 · Book (Phase 7 —
 * `b7Book.js`) so the URL is hand-typed in exactly this one place. Node 0's
 * and B7's surrounding copy are intentionally different strings (different
 * beats, different context) — only this atomic line is shared.
 */
function buildBookingUrlLine() {
  return `\uD83D\uDC49 ${BOOKING_URL}`;
}

const BOOKING_LINK_MESSAGE = [
  'Absolutely — here\u2019s your booking form:',
  buildBookingUrlLine(),
  'Once you submit, just reply Done here.',
].join('\n');

const SLOT_PICKER_BODY = "Absolutely — let's get you booked.\n\nWhen suits you?";
const SLOT_LIST_BUTTON_TEXT = 'Pick a time';
const SLOT_LIST_SECTION_TITLE = 'Available times';

/** WhatsApp list hard caps (titles 24 chars; max 10 rows — leave 1 for other). */
const WA_LIST_TITLE_MAX = 24;
const WA_LIST_DESC_MAX = 72;
const WA_LIST_MAX_ROWS = 10;
const MAX_LIVE_SLOT_ROWS = WA_LIST_MAX_ROWS - 1;

const OTHER_TIME_ROW_ID = 'flowv2_node0_other_time';
const OTHER_TIME_ROW = Object.freeze({
  id: OTHER_TIME_ROW_ID,
  title: 'Some other time',
  description: "I'll pick on the form",
});

const SLOT_ROW_ID_PREFIX = 'flowv2_node0_slot_';

const BACKFILL_QUESTION =
  'While you\u2019re filling it — one quick thing so your counsellor walks in already knowing you. What matters most to you?';

const BACKFILL_BUTTONS = Object.freeze([
  Object.freeze({ id: 'flowv2_backfill_placements', title: 'Placements' }),
  Object.freeze({ id: 'flowv2_backfill_ai_future_tech', title: 'AI & future tech' }),
  Object.freeze({ id: 'flowv2_backfill_affordable_safe', title: 'Affordable & safe' }),
]);

// ---------------------------------------------------------------------------
// Hybrid slot list helpers (shared with B7 · Book)
// ---------------------------------------------------------------------------

function truncateWa(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max).trim();
}

/** YYYY-MM-DD in Asia/Kolkata. */
function istYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map((n) => parseInt(n, 10));
  const utc = Date.UTC(y, m - 1, d + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(utc));
}

function weekdayShortIst(ymd) {
  const [y, m, d] = String(ymd).split('-').map((n) => parseInt(n, 10));
  // Noon UTC avoids DST edge noise; IST weekday for calendar date is stable.
  const dt = new Date(Date.UTC(y, m - 1, d, 6, 30, 0));
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(dt);
}

function isWeekendYmd(ymd) {
  const day = weekdayShortIst(ymd);
  return day === 'Sat' || day === 'Sun';
}

/**
 * Bucket label for a live slot — Today / Tomorrow / weekend when possible.
 * @param {{ slotDate?: string, slotTime?: string }} slot
 * @param {{ todayYmd?: string, tomorrowYmd?: string }} [opts]
 */
function formatSlotBucketLabel(slot, opts = {}) {
  const today = opts.todayYmd || istYmd();
  const tomorrow = opts.tomorrowYmd || addDaysYmd(today, 1);
  const date = String(slot?.slotDate || '').trim();
  const time = String(slot?.slotTime || '').trim() || 'time TBD';

  if (date === today) return truncateWa(`Today, ${time}`, WA_LIST_TITLE_MAX);
  if (date === tomorrow) return truncateWa(`Tomorrow, ${time}`, WA_LIST_TITLE_MAX);
  if (date && isWeekendYmd(date)) {
    return truncateWa(`Weekend, ${time}`, WA_LIST_TITLE_MAX);
  }
  if (date) {
    const day = weekdayShortIst(date);
    return truncateWa(`${day}, ${time}`, WA_LIST_TITLE_MAX);
  }
  return truncateWa(time, WA_LIST_TITLE_MAX);
}

/**
 * Prefer a short human hint for the handoff bubble (may exceed WA title length).
 * @param {{ slotDate?: string, slotTime?: string, label?: string }} slot
 */
function formatPreferredSlotHint(slot) {
  if (!slot) return null;
  if (slot.label) return String(slot.label).trim() || null;
  const date = String(slot.slotDate || '').trim();
  const time = String(slot.slotTime || '').trim();
  if (!date && !time) return null;
  const today = istYmd();
  const tomorrow = addDaysYmd(today, 1);
  if (date === today) return time ? `Today, ${time}` : 'Today';
  if (date === tomorrow) return time ? `Tomorrow, ${time}` : 'Tomorrow';
  if (date && isWeekendYmd(date)) return time ? `This weekend, ${time}` : 'This weekend';
  if (date) {
    const day = weekdayShortIst(date);
    return time ? `${day}, ${time}` : day;
  }
  return time || null;
}

/**
 * @param {Array<object>} slots - DTOs from getAvailableActiveSlots()
 * @returns {{ rows: Array<{id,title,description?}>, offers: Array<object> }}
 */
function buildLiveSlotListRows(slots) {
  const today = istYmd();
  const tomorrow = addDaysYmd(today, 1);
  const open = (Array.isArray(slots) ? slots : []).filter((s) => s && !s.bookingClosed && s.id);
  const capped = open.slice(0, MAX_LIVE_SLOT_ROWS);

  const offers = [];
  const rows = capped.map((slot) => {
    const id = `${SLOT_ROW_ID_PREFIX}${slot.id}`;
    const title = formatSlotBucketLabel(slot, { todayYmd: today, tomorrowYmd: tomorrow });
    const description = truncateWa(
      [slot.counselorName, slot.sessionTitle].filter(Boolean).join(' · ') || slot.slotDate || '',
      WA_LIST_DESC_MAX
    );
    const label = formatPreferredSlotHint(slot) || title;
    offers.push({
      id: String(slot.id),
      rowId: id,
      label,
      slotDate: slot.slotDate || null,
      slotTime: slot.slotTime || null,
    });
    return description ? { id, title, description } : { id, title };
  });

  rows.push({ ...OTHER_TIME_ROW });
  return { rows, offers };
}

/**
 * WhatsApp list interactive for hybrid slot pick.
 * Shared by Node 0 and B7 · Book.
 */
function buildHybridSlotListInteractive({ body = SLOT_PICKER_BODY, rows } = {}) {
  const safeRows = Array.isArray(rows) && rows.length ? rows : [{ ...OTHER_TIME_ROW }];
  return {
    type: 'list',
    body: body || SLOT_PICKER_BODY,
    buttonText: SLOT_LIST_BUTTON_TEXT,
    sections: [
      {
        title: SLOT_LIST_SECTION_TITLE,
        rows: safeRows.slice(0, WA_LIST_MAX_ROWS),
      },
    ],
  };
}

/**
 * Website handoff copy after a slot preference (or "other time").
 * Preferred slot is a non-binding hint only — never a CRM booking.
 *
 * @param {{ preferredSlotLabel?: string|null }} [opts]
 */
function buildHybridWebsiteHandoffMessage({ preferredSlotLabel = null } = {}) {
  const hint = preferredSlotLabel
    ? `Got it — ${preferredSlotLabel} noted as a preference.\n\n`
    : '';
  return `${hint}${BOOKING_LINK_MESSAGE}`;
}

/**
 * Fetch live slots for chat. Failures / empty / timeout → empty array
 * (caller still offers "Some other time"). Never books.
 */
async function fetchLiveSlotsForChat() {
  try {
    const slots = await Promise.race([
      guidanceBookingService.getAvailableActiveSlots(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('live_slot_fetch_timeout')), LIVE_SLOT_FETCH_TIMEOUT_MS);
      }),
    ]);
    return Array.isArray(slots) ? slots : [];
  } catch (_err) {
    return [];
  }
}

/**
 * Build the hybrid slot-picker node result (async — live DB slots).
 *
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @param {{
 *   stage?: string,
 *   body?: string,
 *   profilePatch?: object,
 * }} [opts]
 */
async function buildHybridSlotPickerResult(ctx, opts = {}) {
  const currentProfile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const mergedProfile = mergeFlowV2Profile(currentProfile, {
    temperature: 'hot',
    door: 'booking_intent',
    bookingStatus: 'booking_started',
    ...(opts.profilePatch || {}),
  });

  const slots = await fetchLiveSlotsForChat();
  const { rows, offers } = buildLiveSlotListRows(slots);

  return {
    replyText: null,
    replyParts: null,
    interactive: buildHybridSlotListInteractive({
      body: opts.body || SLOT_PICKER_BODY,
      rows,
    }),
    contextPatch: {
      stage: opts.stage || 'node0_awaiting_slot',
      profile: mergedProfile,
      hybridSlotOffers: offers,
    },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

/**
 * Resolve a slot-list reply into preferred-slot hint (or null for other time).
 * @param {string} text
 * @param {Array<object>} [offers]
 * @returns {{ kind: 'slot'|'other', preferredSlotLabel: string|null, slotId: string|null }}
 */
function resolveHybridSlotChoice(text, offers = []) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();

  if (
    !raw ||
    raw === OTHER_TIME_ROW_ID ||
    lower === 'some other time' ||
    lower.startsWith('some other time')
  ) {
    return { kind: 'other', preferredSlotLabel: null, slotId: null };
  }

  if (raw.startsWith(SLOT_ROW_ID_PREFIX)) {
    const slotId = raw.slice(SLOT_ROW_ID_PREFIX.length);
    const offer = (offers || []).find((o) => o.id === slotId || o.rowId === raw);
    return {
      kind: 'slot',
      preferredSlotLabel: offer?.label || null,
      slotId: slotId || null,
    };
  }

  const byLabel = (offers || []).find(
    (o) =>
      o.label &&
      (lower === String(o.label).toLowerCase() ||
        lower === String(o.rowId || '').toLowerCase() ||
        raw === o.rowId)
  );
  if (byLabel) {
    return { kind: 'slot', preferredSlotLabel: byLabel.label, slotId: byLabel.id };
  }

  // Free-text preference — still website handoff, with their words as hint.
  return { kind: 'other', preferredSlotLabel: raw.slice(0, 80) || null, slotId: null };
}

/**
 * @param {{ flowV2?: { profile?: object } }} ctx
 * @param {string} text
 * @returns {Promise<object>} standard Flow v2 node return shape
 */
async function handleNode0Override(ctx, text) {
  void text;
  // HYBRID_BOOKING_WEBSITE_CREATE — live slots in chat, CRM create only on website.
  return buildHybridSlotPickerResult(ctx, { stage: 'node0_awaiting_slot' });
}

/**
 * After a slot row (or other time / free text): website URL handoff + optional
 * backfill. Never writes OneOnOneCounselingLead / GuidanceSlot bookings.
 *
 * @param {{ flowV2?: { profile?: object, hybridSlotOffers?: object[] } }} ctx
 * @param {string} text
 * @returns {object}
 */
function handleNode0SlotReply(ctx, text) {
  const currentProfile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const offers = ctx?.flowV2?.hybridSlotOffers || [];
  const choice = resolveHybridSlotChoice(text, offers);

  const mergedProfile = mergeFlowV2Profile(currentProfile, {
    bookingStatus: 'link_sent',
    temperature: 'hot',
    door: 'booking_intent',
  });

  return {
    replyText: buildHybridWebsiteHandoffMessage({
      preferredSlotLabel: choice.preferredSlotLabel,
    }),
    replyParts: null,
    interactive: {
      type: 'button',
      body: BACKFILL_QUESTION,
      buttons: BACKFILL_BUTTONS,
    },
    contextPatch: {
      stage: 'node0_awaiting_backfill',
      profile: mergedProfile,
      hybridSlotOffers: null,
      preferredSlotHint: choice.preferredSlotLabel,
    },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

const BACKFILL_CAPTURED_TEXT =
  "Got it — I'll pass that on. Reply Done once you've submitted the form.";
const BACKFILL_SKIPPED_TEXT =
  "No problem — the form link is just above. Reply Done once you've submitted it.";

/**
 * NEW SCOPE in Master Flow Stage 3: the original Node 0 implementation
 * stopped at `node0_awaiting_backfill`. This handler makes that optional
 * question real. A recognized answer writes the same canonical
 * `goalPriority` slot B1 uses, then moves to B7's existing
 * `b7_awaiting_done` helper path without re-sending the URL. Any other
 * response skips backfill (it is optional) and reaches the same waiting
 * stage with the existing profile untouched.
 */
function handleNode0BackfillReply(ctx, text) {
  const currentProfile = ctx?.flowV2?.profile || emptyFlowV2Profile();
  const patch = extractFlowV2Slots(text, currentProfile);
  const hasBackfill = Array.isArray(patch.goalPriority) && patch.goalPriority.length > 0;
  const mergedProfile = hasBackfill
    ? mergeFlowV2Profile(currentProfile, { goalPriority: patch.goalPriority })
    : currentProfile;

  return {
    replyText: hasBackfill ? BACKFILL_CAPTURED_TEXT : BACKFILL_SKIPPED_TEXT,
    replyParts: null,
    interactive: null,
    contextPatch: {
      stage: 'b7_awaiting_done',
      profile: mergedProfile,
    },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  detectOverrideIntent,
  handleNode0Override,
  handleNode0SlotReply,
  handleNode0BackfillReply,
  OVERRIDE_PATTERNS,
  BOOKING_LINK_MESSAGE,
  SLOT_PICKER_BODY,
  BACKFILL_QUESTION,
  BACKFILL_BUTTONS,
  BACKFILL_CAPTURED_TEXT,
  BACKFILL_SKIPPED_TEXT,
  // exported (Phase 7) so B7 · Book can reuse the exact same booking-URL
  // line rather than hand-typing it a second time.
  BOOKING_URL,
  buildBookingUrlLine,
  // Hybrid booking helpers (HYBRID_BOOKING_WEBSITE_CREATE) — shared with B7.
  OTHER_TIME_ROW_ID,
  OTHER_TIME_ROW,
  SLOT_ROW_ID_PREFIX,
  buildLiveSlotListRows,
  buildHybridSlotListInteractive,
  buildHybridWebsiteHandoffMessage,
  buildHybridSlotPickerResult,
  resolveHybridSlotChoice,
  formatSlotBucketLabel,
  fetchLiveSlotsForChat,
};
