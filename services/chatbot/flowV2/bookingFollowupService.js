'use strict';

/**
 * Company Stage 10 — Maybe Later follow-ups at +30m / +1h / +3h.
 * Stored on flowV2.profile.bookingFollowup; fired by cron.
 */

const FOLLOWUP_STEPS = Object.freeze([
  Object.freeze({
    level: 1,
    delayMs: 30 * 60 * 1000,
    body: [
      'Hi 👋',
      'Just checking in.',
      'Choosing the right college is a big decision.',
      "Whenever you're ready, your FREE IITian guidance session is waiting for you. 😊",
    ].join('\n'),
    buttons: Object.freeze([
      Object.freeze({ id: 'flowv2_b7_book', title: 'Book My Session' }),
    ]),
  }),
  Object.freeze({
    level: 2,
    delayMs: 60 * 60 * 1000,
    body: [
      'Many students pick a college based only on rankings or advertisements.',
      'A 30-minute conversation with an IITian can help you avoid common mistakes.',
      'Would you like to book your free session?',
    ].join('\n'),
    buttons: Object.freeze([
      Object.freeze({ id: 'flowv2_b7_book', title: 'Book My Session' }),
    ]),
  }),
  Object.freeze({
    level: 3,
    delayMs: 3 * 60 * 60 * 1000,
    body: [
      'Just a friendly reminder 😊',
      'The right college can shape your next 4 years—and your career after that.',
      "Don't miss the chance to get personalised guidance from an IITian, completely free.",
    ].join('\n'),
    buttons: Object.freeze([
      Object.freeze({ id: 'flowv2_b7_book', title: 'Book My Session' }),
      Object.freeze({ id: 'flowv2_b7_not_yet', title: 'Maybe Later' }),
    ]),
  }),
]);

function startBookingFollowups(now = new Date()) {
  return {
    bookingFollowup: {
      declinedAt: now.toISOString(),
      sentLevels: [],
    },
    followupsSent: 0,
  };
}

function nextDueFollowup(profile, now = new Date()) {
  const fu = profile?.bookingFollowup;
  if (!fu || !fu.declinedAt) return null;
  if (profile?.bookingStatus === 'link_sent' || profile?.bookingStatus === 'done') return null;

  const declinedAtMs = Date.parse(fu.declinedAt);
  if (!Number.isFinite(declinedAtMs)) return null;
  const elapsed = now.getTime() - declinedAtMs;
  const sent = new Set(Array.isArray(fu.sentLevels) ? fu.sentLevels : []);

  for (const step of FOLLOWUP_STEPS) {
    if (sent.has(step.level)) continue;
    if (elapsed >= step.delayMs) return step;
  }
  return null;
}

function markFollowupSent(profile, level) {
  const fu = profile?.bookingFollowup || {};
  const sentLevels = Array.isArray(fu.sentLevels) ? [...fu.sentLevels] : [];
  if (!sentLevels.includes(level)) sentLevels.push(level);
  return {
    ...(profile || {}),
    bookingFollowup: {
      ...fu,
      sentLevels,
      lastSentAt: new Date().toISOString(),
    },
    followupsSent: sentLevels.length,
  };
}

module.exports = {
  FOLLOWUP_STEPS,
  startBookingFollowups,
  nextDueFollowup,
  markFollowupSent,
};
