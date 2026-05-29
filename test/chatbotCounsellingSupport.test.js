'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCounsellingSupportReply } = require('../services/chatbot/counsellingSupportService');

describe('buildCounsellingSupportReply', () => {
  test('IIT summary omits payment status and includes session details', async () => {
    const text = await buildCounsellingSupportReply(
      {
        phone: '9876543210',
        hasIit: true,
        iit: {
          fullName: 'Priya Sharma',
          slotBooking: 'Saturday 6PM',
          slotInstantLabel: 'Sat, 30 May, 6:00 pm',
          preferredLanguage: 'Telugu',
          demoStatusLabel: 'Not Scheduled',
          assignedBdaName: null,
          paymentStatusLabel: 'Not Paid',
        },
      },
      {
        recentWa: [
          { messageKind: 'slot_booked', status: 'read' },
          { messageKind: 'slot_booked', status: 'delivered' },
        ],
      }
    );

    assert.match(text, /Hi Priya!/);
    assert.match(text, /Session: Saturday 6PM/);
    assert.match(text, /Demo Status: Not Scheduled/);
    assert.match(text, /Meeting Link:/);
    assert.match(text, /slot_booked: read/);
    assert.doesNotMatch(text, /payment/i);
    assert.doesNotMatch(text, /not paid/i);
  });
});
