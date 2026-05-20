'use strict';

const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const IIT_REMINDER_ENV_KEYS = [
  'GUPSHUP_TEMPLATE_IIT_PRE2HR_TELUGU',
  'GUPSHUP_TEMPLATE_IIT_PRE45MIN_TELUGU',
  'GUPSHUP_TEMPLATE_IIT_PRE15MIN_TELUGU',
];

let mongod;

describe('IIT reminder scheduling', () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  beforeEach(async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
    for (const k of IIT_REMINDER_ENV_KEYS) {
      process.env[k] = `tpl-${k}`;
    }
  });

  after(() => {
    for (const k of IIT_REMINDER_ENV_KEYS) {
      delete process.env[k];
    }
  });

  test('WhatsAppRetryGroup accepts IIT reminder messageKind values', async () => {
    const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
    for (const messageKind of ['iit_pre2hr', 'iit_pre45min', 'iit_pre15min']) {
      const g = await WhatsAppRetryGroup.create({
        messageKind,
        trigger: 'scheduled_job',
        status: 'open',
      });
      assert.equal(g.messageKind, messageKind);
    }
  });

  test('ensureIitReminderJobsForSubmission creates three pending jobs when templates are set', async () => {
    const { ensureIitReminderJobsForSubmission } = require('../services/iitReminderScheduler');
    const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
    const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');

    const slotAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const subId = new mongoose.Types.ObjectId();
    const iitSub = {
      _id: subId,
      phone: '9876543210',
      counsellingSlotInstantUtc: slotAt,
      iitCounselling: {
        section1Data: { slotBooking: 'Wednesday 6PM' },
        section2Data: { preferredLanguage: 'Telugu' },
      },
    };

    const result = await ensureIitReminderJobsForSubmission(iitSub);
    assert.equal(result.error, undefined);
    assert.equal(result.jobs.length, 3);
    assert.ok(result.jobs.every((j) => j.state === 'pending' && j.templateIdEnvKey));
    assert.equal(result.jobs.filter((j) => j.created).length, 3);

    const jobCount = await WhatsAppReminderJob.countDocuments({ iitCounsellingSubmissionId: subId });
    assert.equal(jobCount, 3);

    const groupCount = await WhatsAppRetryGroup.countDocuments({
      messageKind: { $in: ['iit_pre2hr', 'iit_pre45min', 'iit_pre15min'] },
    });
    assert.equal(groupCount, 3);
  });

  test('ensureIitReminderJobsForSubmission skips jobs when template env is missing', async () => {
    for (const k of IIT_REMINDER_ENV_KEYS) {
      delete process.env[k];
    }
    const { ensureIitReminderJobsForSubmission } = require('../services/iitReminderScheduler');

    const slotAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const result = await ensureIitReminderJobsForSubmission({
      _id: new mongoose.Types.ObjectId(),
      phone: '9876543210',
      counsellingSlotInstantUtc: slotAt,
      iitCounselling: {
        section1Data: { slotBooking: 'Wednesday 6PM' },
        section2Data: { preferredLanguage: 'Telugu' },
      },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.jobs.length, 3);
    assert.ok(result.jobs.every((j) => j.state === 'skipped' && !j.templateIdEnvKey));
  });
});
