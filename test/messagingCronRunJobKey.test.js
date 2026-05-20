'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { CRON_JOB_KEYS, CRON_JOB_KEY_LIST } = require('../models/MessagingCronRun');

describe('MessagingCronRun jobKey', () => {
  test('CRON_JOB_KEYS includes send_iit_reminders', () => {
    assert.equal(CRON_JOB_KEYS.SEND_IIT_REMINDERS, 'send_iit_reminders');
  });

  test('CRON_JOB_KEY_LIST includes all cron job keys for schema enum', () => {
    assert.ok(CRON_JOB_KEY_LIST.includes('send_iit_reminders'));
    assert.ok(CRON_JOB_KEY_LIST.includes('send_reminders'));
    assert.ok(CRON_JOB_KEY_LIST.includes('send_meetlinks'));
    assert.ok(CRON_JOB_KEY_LIST.includes('send_30min_reminders'));
    assert.ok(CRON_JOB_KEY_LIST.includes('retry_whatsapp'));
    assert.equal(CRON_JOB_KEY_LIST.length, Object.keys(CRON_JOB_KEYS).length);
  });
});
