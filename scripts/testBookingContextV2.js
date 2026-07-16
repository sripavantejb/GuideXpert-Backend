'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  tryBookingSupportRouter,
  bookingCreateCheckReply,
} = require('../services/chatbot/bookingContext/bookingSupportRouter');
const {
  buildBookingContextFromSubmission,
} = require('../services/chatbot/bookingContext/bookingContextResolver');
const { applyBookingHallucinationGuard } = require('../services/chatbot/bookingContext/bookingHallucinationGuard');

const sampleBooking = buildBookingContextFromSubmission({
  _id: '507f1f77bcf86cd799439011',
  phone: '9347763131',
  fullName: 'Test User',
  assignedBdaName: 'Counsellor A',
  counsellingSlotInstantUtc: new Date('2026-06-20T12:30:00.000Z'),
  iitCounselling: {
    section1Data: {
      slotBooking: 'Saturday 6PM',
      slotBookingDate: '2026-06-20',
      stream: 'MPC',
      top5Colleges: ['IIT Hyderabad'],
    },
    section2Data: { preferredLanguage: 'Telugu' },
  },
});

test('deterministic router handles when is my counselling without LLM', () => {
  const route = tryBookingSupportRouter({
    text: 'When is my counselling?',
    leadContext: { bookingContext: sampleBooking },
    resolvedLanguage: 'en',
  });
  assert.equal(route.handled, true);
  assert.equal(route.deterministic, true);
  assert.match(route.replyText, /scheduled for|Session|Saturday/i);
});

test('booking create CASE A shows existing booking', () => {
  const reply = bookingCreateCheckReply('en', sampleBooking);
  assert.match(reply, /found an existing counselling booking/i);
  assert.match(reply, /Saturday 6PM|Counsellor A/i);
});

test('booking create CASE B redirects to website when missing', () => {
  const reply = bookingCreateCheckReply('en', { exists: false });
  assert.match(reply, /couldn't find an active counselling booking/i);
  assert.match(reply, /guidexpert.co.in/i);
});

test('hallucination guard blocks fake confirmation', () => {
  const guard = applyBookingHallucinationGuard({
    response: 'Your counselling booking for tomorrow at 3 PM is confirmed.',
    leadContext: { bookingContext: { exists: false } },
  });
  assert.equal(guard.modified, true);
  assert.match(guard.text, /couldn't find an active counselling booking/i);
});

test('reschedule always uses website portal message', () => {
  const route = tryBookingSupportRouter({
    text: 'Reschedule my session',
    leadContext: { bookingContext: sampleBooking },
  });
  assert.equal(route.handled, true);
  assert.match(route.replyText, /managed through the GuideXpert website/i);
});
