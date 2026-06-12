'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const servicePath = require.resolve('../services/chatbot/leadInsights/leadInsightsService');
const profileModelPath = require.resolve('../models/WhatsAppLeadProfile');
const scoreModelPath = require.resolve('../models/WhatsAppLeadScore');
const eventModelPath = require.resolve('../models/WhatsAppLeadEvent');

const PHONE = '9876543210';
const CONVERSATION_ID = new mongoose.Types.ObjectId();

describe('leadInsightsService', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
  });

  function mockModels({
    profile = null,
    score = null,
    events = [],
    aggregateResult = [{ items: [], total: [] }],
    hotRows = [],
    statsRows = [],
  } = {}) {
    const WhatsAppLeadProfile = require(profileModelPath);
    mock.method(WhatsAppLeadProfile, 'findOne', () => ({
      select() {
        return { lean: async () => profile };
      },
    }));

    const WhatsAppLeadScore = require(scoreModelPath);
    mock.method(WhatsAppLeadScore, 'findOne', () => ({
      select() {
        return { lean: async () => score };
      },
    }));
    mock.method(WhatsAppLeadScore, 'aggregate', async (pipeline) => {
      const serialized = JSON.stringify(pipeline);
      if (serialized.includes('"$group"')) {
        return statsRows;
      }
      if (serialized.includes('"$facet"')) {
        return aggregateResult;
      }
      if (serialized.includes('"$limit"')) {
        return hotRows;
      }
      return aggregateResult;
    });
    Object.defineProperty(WhatsAppLeadScore, 'collection', {
      value: { name: 'whatsappleadscores' },
      configurable: true,
    });

    const WhatsAppLeadEvent = require(eventModelPath);
    mock.method(WhatsAppLeadEvent, 'find', () => ({
      select() {
        return {
          sort() {
            return {
              limit() {
                return { lean: async () => events };
              },
            };
          },
        };
      },
    }));

    const WhatsAppLeadProfileModel = require(profileModelPath);
    Object.defineProperty(WhatsAppLeadProfileModel, 'collection', {
      value: { name: 'whatsappleadprofiles' },
      configurable: true,
    });
  }

  test('getLeadDetails returns profile score and recent events for valid phone', async () => {
    const profile = {
      phone: PHONE,
      branchInterest: 'CSE',
      eventCount: 12,
      lastInteractionAt: new Date('2026-06-01T10:00:00Z'),
    };
    const score = {
      phone: PHONE,
      leadScore: 86,
      leadStage: 'hot',
    };
    const events = [
      {
        _id: new mongoose.Types.ObjectId(),
        phone: PHONE,
        createdAt: new Date('2026-06-05T10:00:00Z'),
        events: [{ type: 'demo_interest', value: 'yes', confidence: 0.9, evidence: 'demo' }],
      },
    ];
    mockModels({ profile, score, events });

    const { getLeadDetails } = require(servicePath);
    const result = await getLeadDetails(PHONE);

    assert.equal(result.profile.phone, PHONE);
    assert.equal(result.score.leadScore, 86);
    assert.equal(result.recentEvents.length, 1);
  });

  test('getLeadDetails rejects invalid phone', async () => {
    mockModels();
    const { getLeadDetails } = require(servicePath);
    const result = await getLeadDetails('bad-phone');
    assert.equal(result.error, 'Invalid phone. Expected 10 digits.');
  });

  test('listLeads applies stage and minScore filters with pagination', async () => {
    mockModels({
      aggregateResult: [
        {
          items: [
            {
              phone: PHONE,
              leadScore: 88,
              leadStage: 'hot',
              branchInterest: 'CSE',
              collegeInterest: 'IIT Bombay',
              eventCount: 14,
              lastInteractionAt: new Date('2026-06-05T10:00:00Z'),
            },
          ],
          total: [{ count: 42 }],
        },
      ],
    });

    const { listLeads } = require(servicePath);
    const result = await listLeads({ stage: 'hot', minScore: 50, page: 2, limit: 25 });

    assert.equal(result.total, 42);
    assert.equal(result.page, 2);
    assert.equal(result.limit, 25);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].leadStage, 'hot');
  });

  test('listLeads returns empty results', async () => {
    mockModels();
    const { listLeads } = require(servicePath);
    const result = await listLeads({ stage: 'cold' });
    assert.equal(result.total, 0);
    assert.deepEqual(result.items, []);
  });

  test('getLeadStats aggregates stage counts and average score', async () => {
    mockModels({
      statsRows: [
        {
          totalLeads: 1452,
          coldLeads: 650,
          warmLeads: 520,
          hotLeads: 282,
          averageScore: 54.2,
        },
      ],
    });

    const { getLeadStats } = require(servicePath);
    const stats = await getLeadStats();
    assert.equal(stats.totalLeads, 1452);
    assert.equal(stats.hotLeads, 282);
    assert.equal(stats.averageScore, 54.2);
  });

  test('getHotLeads returns hot leads ordered by score', async () => {
    mockModels({
      hotRows: [
        { phone: '9000000001', leadScore: 99, leadStage: 'hot' },
        { phone: '9000000002', leadScore: 95, leadStage: 'hot' },
      ],
    });

    const { getHotLeads } = require(servicePath);
    const rows = await getHotLeads();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].leadScore, 99);
    assert.equal(rows[1].leadScore, 95);
  });

  test('parseStage and parseMinScore validate query params', () => {
    const { parseStage, parseMinScore } = require(servicePath);
    assert.equal(parseStage('hot').stage, 'hot');
    assert.equal(parseStage('invalid').error, 'Invalid stage. Expected cold, warm, or hot.');
    assert.equal(parseMinScore('50').minScore, 50);
    assert.equal(parseMinScore('150').error, 'Invalid minScore. Expected a number between 0 and 100.');
  });
});
