'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = require.resolve('../controllers/leadInsightsController');
const servicePath = require.resolve('../services/chatbot/leadInsights/leadInsightsService');
const serverPath = path.join(__dirname, '../server.js');

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('leadInsightsController', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[controllerPath];
    delete require.cache[servicePath];
  });

  function mockService(impl = {}) {
    delete require.cache[servicePath];
    const service = require(servicePath);
    if (impl.getLeadDetails) {
      mock.method(service, 'getLeadDetails', impl.getLeadDetails);
    }
    if (impl.listLeads) {
      mock.method(service, 'listLeads', impl.listLeads);
    }
    if (impl.getLeadStats) {
      mock.method(service, 'getLeadStats', impl.getLeadStats);
    }
    if (impl.getHotLeads) {
      mock.method(service, 'getHotLeads', impl.getHotLeads);
    }
    delete require.cache[controllerPath];
    return require(controllerPath);
  }

  test('getLeadDetailsByPhone returns profile score and recent events', async () => {
    const controller = mockService({
      getLeadDetails: async () => ({
        profile: { phone: '9876543210' },
        score: { leadScore: 86, leadStage: 'hot' },
        recentEvents: [{ events: [] }],
      }),
    });

    const req = { params: { phone: '9876543210' } };
    const res = makeRes();
    await controller.getLeadDetailsByPhone(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.score.leadScore, 86);
    assert.equal(res.body.data.recentEvents.length, 1);
  });

  test('getLeadDetailsByPhone returns 400 for invalid phone', async () => {
    const controller = mockService({
      getLeadDetails: async () => ({ error: 'Invalid phone. Expected 10 digits.' }),
    });

    const req = { params: { phone: 'bad' } };
    const res = makeRes();
    await controller.getLeadDetailsByPhone(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
  });

  test('listLeadInsights supports pagination and filters', async () => {
    const controller = mockService({
      listLeads: async () => ({
        total: 100,
        page: 2,
        limit: 25,
        items: [{ phone: '9876543210', leadScore: 72, leadStage: 'hot' }],
      }),
    });

    const req = { query: { stage: 'hot', minScore: '50', page: '2', limit: '25' } };
    const res = makeRes();
    await controller.listLeadInsights(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.page, 2);
    assert.equal(res.body.data.items[0].leadStage, 'hot');
  });

  test('listLeadInsights returns 400 for invalid stage', async () => {
    const controller = mockService();
    const req = { query: { stage: 'boiling' } };
    const res = makeRes();
    await controller.listLeadInsights(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
  });

  test('getLeadInsightsStats returns aggregated stats', async () => {
    const controller = mockService({
      getLeadStats: async () => ({
        totalLeads: 1452,
        coldLeads: 650,
        warmLeads: 520,
        hotLeads: 282,
        averageScore: 54.2,
      }),
    });

    const req = { query: {} };
    const res = makeRes();
    await controller.getLeadInsightsStats(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.hotLeads, 282);
    assert.equal(res.body.data.averageScore, 54.2);
  });

  test('getHotLeadInsights returns ordered hot leads', async () => {
    const controller = mockService({
      getHotLeads: async () => [
        { phone: '9000000001', leadScore: 99, leadStage: 'hot' },
        { phone: '9000000002', leadScore: 95, leadStage: 'hot' },
      ],
    });

    const req = { query: {} };
    const res = makeRes();
    await controller.getHotLeadInsights(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.items.length, 2);
    assert.equal(res.body.data.items[0].leadScore, 99);
  });

  test('listLeadInsights returns empty results', async () => {
    const controller = mockService({
      listLeads: async () => ({ total: 0, page: 1, limit: 25, items: [] }),
    });

    const req = { query: { stage: 'cold' } };
    const res = makeRes();
    await controller.listLeadInsights(req, res);

    assert.equal(res.body.data.total, 0);
    assert.deepEqual(res.body.data.items, []);
  });

  test('controller surfaces service failures as 500', async () => {
    const controller = mockService({
      getLeadStats: async () => {
        throw new Error('db down');
      },
    });

    const req = { query: {} };
    const res = makeRes();
    await controller.getLeadInsightsStats(req, res);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.success, false);
  });

  test('lead insights route is mounted behind requireAdmin', () => {
    const serverSource = fs.readFileSync(serverPath, 'utf8');
    assert.match(
      serverSource,
      /app\.use\('\/api\/admin\/lead-insights',\s*requireAdmin,\s*leadInsightsRoutes\)/
    );
  });
});
