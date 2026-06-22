'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../services/chatbot/humanCopilot/humanCopilotAnalyticsService');
const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');
const flagsPath = require.resolve('../services/chatbot/humanCopilot/humanCopilotFlags');

describe('humanCopilotAnalyticsService', () => {
  const originalThreshold = process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD;

  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
    delete require.cache[flagsPath];
    if (originalThreshold === undefined) {
      delete process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD;
    } else {
      process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD = originalThreshold;
    }
  });

  function mockEmptyDb() {
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'countDocuments', async () => 0);
    mock.method(WhatsAppAgentHandoff, 'aggregate', async () => []);
  }

  test('empty database returns zero-filled analytics', async () => {
    mockEmptyDb();
    const {
      getAnalyticsOverview,
      getAnalyticsWorkloads,
      getAnalyticsAiUsage,
      getAnalyticsEscalations,
      getAnalyticsDelivery,
      getAnalyticsLeadQuality,
    } = require(servicePath);

    const overview = await getAnalyticsOverview({ sinceDays: 30 });
    assert.equal(overview.data.volume.total, 0);
    assert.equal(overview.data.volume.active, 0);
    assert.equal(overview.data.responseTimes.avgFirstResponseMs, 0);

    const workloads = await getAnalyticsWorkloads({ sinceDays: 30 });
    assert.equal(workloads.data.sr1.assigned, 0);
    assert.equal(workloads.data.sr2.resolved, 0);

    const aiUsage = await getAnalyticsAiUsage({ sinceDays: 30 });
    assert.equal(aiUsage.data.totalSuggestedReplies, 0);
    assert.equal(aiUsage.data.acceptanceRate, 0);

    const escalations = await getAnalyticsEscalations({ sinceDays: 30 });
    assert.equal(escalations.data.totalHandoffs, 0);
    assert.equal(escalations.data.reasons.length, 4);

    const delivery = await getAnalyticsDelivery({ sinceDays: 30 });
    assert.equal(delivery.data.successfulSends, 0);
    assert.equal(delivery.data.retrySuccessRate, 0);

    const leadQuality = await getAnalyticsLeadQuality({ sinceDays: 30 });
    assert.equal(leadQuality.data.cold, 0);
    assert.equal(leadQuality.data.averageLeadScore, 0);
  });

  test('single handoff overview computes response and resolution times', async () => {
    const WhatsAppAgentHandoff = require(handoffModelPath);
    const createdAt = new Date('2026-06-01T10:00:00Z');
    const firstResponseAt = new Date('2026-06-01T10:12:00Z');
    const resolvedAt = new Date('2026-06-01T11:00:00Z');

    mock.method(WhatsAppAgentHandoff, 'countDocuments', async (query) => {
      if (query.status === 'resolved') return 1;
      if (query.isReopened) return 0;
      if (query.copilotState) return 1;
      return 1;
    });
    mock.method(WhatsAppAgentHandoff, 'aggregate', async (pipeline) => {
      const firstStage = pipeline[0]?.$match;
      if (firstStage?.firstResponseAt) {
        return [{ avgMs: firstResponseAt - createdAt, maxMs: firstResponseAt - createdAt }];
      }
      if (firstStage?.resolvedAt) {
        return [{ avgMs: resolvedAt - createdAt, maxMs: resolvedAt - createdAt }];
      }
      return [];
    });

    const { getAnalyticsOverview } = require(servicePath);
    const result = await getAnalyticsOverview({ sinceDays: 7 });
    assert.equal(result.data.volume.total, 1);
    assert.equal(result.data.volume.resolved, 1);
    assert.equal(result.data.responseTimes.avgFirstResponseMs, 12 * 60 * 1000);
    assert.equal(result.data.responseTimes.avgResolutionMs, 60 * 60 * 1000);
  });

  test('multiple handoffs aggregate volume totals', async () => {
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'countDocuments', async (query) => {
      if (query.status === 'resolved') return 3;
      if (query.isReopened) return 1;
      if (query.copilotState) return 2;
      return 5;
    });
    mock.method(WhatsAppAgentHandoff, 'aggregate', async () => []);

    const { getAnalyticsOverview } = require(servicePath);
    const result = await getAnalyticsOverview({ sinceDays: 30 });
    assert.equal(result.data.volume.total, 5);
    assert.equal(result.data.volume.resolved, 3);
    assert.equal(result.data.volume.reopened, 1);
    assert.equal(result.data.volume.active, 2);
  });

  test('reopened conversations appear in escalation reasons', async () => {
    process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD = '70';
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'countDocuments', async () => 4);
    mock.method(WhatsAppAgentHandoff, 'aggregate', async () => [
      {
        human_requested: 1,
        low_confidence: 0,
        hot_lead: 2,
        reopened: 2,
      },
    ]);

    const { getAnalyticsEscalations } = require(servicePath);
    const result = await getAnalyticsEscalations({ sinceDays: 30 });
    const reopened = result.data.reasons.find((r) => r.key === 'reopened');
    assert.equal(reopened.count, 2);
    assert.equal(reopened.percent, 50);
  });

  test('AI edited replies compute acceptance rate', async () => {
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'aggregate', async (pipeline) => {
      const suggestMatch = pipeline.find((stage) => stage.$match?.['auditTrail.action']);
      if (suggestMatch) return [{ count: 10 }];
      return [
        { _id: 'ai_used', count: 6 },
        { _id: 'ai_edited', count: 4 },
        { _id: 'manual', count: 12 },
      ];
    });

    const { getAnalyticsAiUsage } = require(servicePath);
    const result = await getAnalyticsAiUsage({ sinceDays: 30 });
    assert.equal(result.data.totalSuggestedReplies, 10);
    assert.equal(result.data.accepted, 6);
    assert.equal(result.data.edited, 4);
    assert.equal(result.data.manual, 12);
    assert.equal(result.data.acceptanceRate, 0.6);
  });

  test('failed sends and retries compute delivery metrics', async () => {
    const WhatsAppAgentHandoff = require(handoffModelPath);
    let aggCalls = 0;
    mock.method(WhatsAppAgentHandoff, 'aggregate', async (pipeline) => {
      aggCalls += 1;
      const hasUnwindReplies = pipeline.some((stage) => stage.$unwind === '$copilotReplies');
      const hasUnwindAudit = pipeline.some((stage) => stage.$unwind === '$auditTrail');
      if (hasUnwindReplies && !pipeline.some((stage) => stage.$addFields?.retried)) {
        return [
          { _id: 'sent', count: 8 },
          { _id: 'failed', count: 2 },
        ];
      }
      if (hasUnwindAudit) return [{ count: 4 }];
      if (hasUnwindReplies) return [{ count: 3 }];
      return [];
    });

    const { getAnalyticsDelivery } = require(servicePath);
    const result = await getAnalyticsDelivery({ sinceDays: 30 });
    assert.equal(aggCalls, 3);
    assert.equal(result.data.successfulSends, 8);
    assert.equal(result.data.failedSends, 2);
    assert.equal(result.data.retries, 4);
    assert.equal(result.data.retrySuccessRate, 0.75);
  });

  test('workload calculations split SR1 and SR2 metrics', async () => {
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'countDocuments', async (query) => {
      if (query.assignedSrCounsellor === 'sr1' && query.status === 'resolved') return 4;
      if (query.assignedSrCounsellor === 'sr1') return 6;
      if (query.assignedSrCounsellor === 'sr2' && query.status === 'resolved') return 2;
      if (query.assignedSrCounsellor === 'sr2') return 3;
      return 0;
    });
    mock.method(WhatsAppAgentHandoff, 'aggregate', async (pipeline) => {
      const sr = pipeline[0]?.$match?.assignedSrCounsellor;
      if (sr === 'sr1') return [{ avgMs: 600000 }];
      if (sr === 'sr2') return [{ avgMs: 900000 }];
      return [];
    });

    const { getAnalyticsWorkloads } = require(servicePath);
    const result = await getAnalyticsWorkloads({ sinceDays: 30 });
    assert.equal(result.data.sr1.assigned, 6);
    assert.equal(result.data.sr1.resolved, 4);
    assert.equal(result.data.sr1.avgFirstResponseMs, 600000);
    assert.equal(result.data.sr2.assigned, 3);
    assert.equal(result.data.sr2.resolved, 2);
    assert.equal(result.data.sr2.avgFirstResponseMs, 900000);
  });

  test('deriveEscalationReasons mirrors alert logic', () => {
    process.env.CHATBOT_COPILOT_HOT_LEAD_THRESHOLD = '70';
    const { deriveEscalationReasons } = require(servicePath);
    assert.deepEqual(deriveEscalationReasons({ reason: 'user_requested' }, 50), [
      'human_requested',
    ]);
    assert.deepEqual(
      deriveEscalationReasons({ isReopened: true, copilotState: 'reopened' }, 80),
      ['reopened', 'hot_lead']
    );
  });
});
