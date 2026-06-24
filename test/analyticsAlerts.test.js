'use strict';

const { describe, test, mock, afterEach, before } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const AnalyticsAlert = require('../models/AnalyticsAlert');
const alertsSvc = require('../services/analytics/smartAlertsService');

const ALERT_ID = new mongoose.Types.ObjectId();
const ADMIN_ID = new mongoose.Types.ObjectId();

describe('smartAlertsService', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('buildDedupeKey is stable', () => {
    assert.equal(
      alertsSvc.buildDedupeKey('hot_lead_inactivity', 'whatsapp', '9876543210'),
      'hot_lead_inactivity:whatsapp:9876543210'
    );
  });

  test('upsertAlert creates new alert when dedupeKey absent', async () => {
    const saved = {
      _id: ALERT_ID,
      dedupeKey: 'hot_lead_inactivity:whatsapp:9999999999',
      status: 'open',
      type: 'hot_lead_inactivity',
    };

    mock.method(AnalyticsAlert, 'findOne', () => ({ lean: async () => null }));
    mock.method(AnalyticsAlert, 'findOneAndUpdate', () => ({ lean: async () => saved }));

    const result = await alertsSvc.upsertAlert({
      type: 'hot_lead_inactivity',
      severity: 'high',
      title: 'Test',
      message: 'Test message',
      productLine: 'whatsapp',
      dedupeKey: saved.dedupeKey,
    });

    assert.equal(result.action, 'created');
    assert.equal(result.alert.dedupeKey, saved.dedupeKey);
  });

  test('upsertAlert skips resolved alerts', async () => {
    const existing = {
      _id: ALERT_ID,
      dedupeKey: 'conversion_drop:all:7d',
      status: 'resolved',
    };

    mock.method(AnalyticsAlert, 'findOne', () => ({ lean: async () => existing }));

    const result = await alertsSvc.upsertAlert({
      type: 'conversion_drop',
      severity: 'high',
      title: 'Drop',
      message: 'Drop msg',
      dedupeKey: existing.dedupeKey,
    });

    assert.equal(result.action, 'skipped_resolved');
  });

  test('acknowledgeAlert updates open alert', async () => {
    const acknowledged = {
      _id: ALERT_ID,
      status: 'acknowledged',
      acknowledgedBy: ADMIN_ID,
    };
    mock.method(AnalyticsAlert, 'findOneAndUpdate', () => ({ lean: async () => acknowledged }));

    const result = await alertsSvc.acknowledgeAlert(ALERT_ID, ADMIN_ID);
    assert.equal(result.alert.status, 'acknowledged');
  });

  test('acknowledgeAlert returns error when not open', async () => {
    mock.method(AnalyticsAlert, 'findOneAndUpdate', () => ({ lean: async () => null }));

    const result = await alertsSvc.acknowledgeAlert(ALERT_ID, ADMIN_ID);
    assert.equal(result.status, 404);
  });

  test('resolveAlert updates acknowledged alert', async () => {
    const resolved = { _id: ALERT_ID, status: 'resolved', resolvedBy: ADMIN_ID };
    mock.method(AnalyticsAlert, 'findOneAndUpdate', () => ({ lean: async () => resolved }));

    const result = await alertsSvc.resolveAlert(ALERT_ID, ADMIN_ID);
    assert.equal(result.alert.status, 'resolved');
  });
});

describe('followupEffectivenessService pct', () => {
  test('pct helper', () => {
    const { pct } = require('../services/analytics/followupEffectivenessService');
    assert.equal(pct(25, 100), 25);
    assert.equal(pct(0, 0), 0);
  });
});

describe('smartAlertsService evaluateAllAlerts', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[require.resolve('../services/analytics/smartAlertsService')];
  });

  test('evaluateAllAlerts aggregates rule results', async () => {
    const WhatsAppLeadScore = require('../models/WhatsAppLeadScore');
    const WhatsAppLeadProfile = require('../models/WhatsAppLeadProfile');
    const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
    const copilotAnalytics = require('../services/chatbot/humanCopilot/humanCopilotAnalyticsService');
    const snapshotSvc = require('../services/analytics/leadLifecycleSnapshotService');
    const WhatsAppAgentHandoff = require('../models/WhatsAppAgentHandoff');

    mock.method(WhatsAppLeadScore, 'find', () => ({
      select() {
        return { lean: async () => [] };
      },
    }));
    mock.method(WhatsAppLeadProfile, 'find', () => ({
      select() {
        return { lean: async () => [] };
      },
    }));
    mock.method(IitCounsellingSubmission, 'find', () => ({
      select() {
        return { lean: async () => [] };
      },
    }));
    mock.method(copilotAnalytics, 'getAnalyticsWorkloads', async () => ({
      data: { sr1: { assigned: 2, resolved: 1, avgFirstResponseMs: 1000 } },
    }));
    mock.method(copilotAnalytics, 'getAnalyticsOverview', async () => ({
      data: { volume: { active: 30 }, responseTimes: { avgFirstResponseMs: 1000 } },
    }));
    mock.method(snapshotSvc, 'getOrBuildSnapshot', async () => ({
      cohortSize: 100,
      stageCounts: { lead: 100, admission: 10 },
    }));
    mock.method(WhatsAppAgentHandoff, 'aggregate', async () => []);
    mock.method(WhatsAppAgentHandoff, 'countDocuments', async () => 0);
    mock.method(AnalyticsAlert, 'findOne', () => ({ lean: async () => null }));
    mock.method(AnalyticsAlert, 'findOneAndUpdate', (filter) => ({
      lean: async () => ({
        dedupeKey: filter.dedupeKey,
        status: 'open',
        type: 'operational_health',
      }),
    }));

    delete require.cache[require.resolve('../services/analytics/smartAlertsService')];
    const freshSvc = require('../services/analytics/smartAlertsService');
    const stats = await freshSvc.evaluateAllAlerts();
    assert.ok(stats.durationMs >= 0);
    assert.equal(typeof stats.created, 'number');
    assert.ok(stats.byType.operational_health >= 1);
  });

  test('cron evaluate path returns stats shape', async () => {
    mock.method(AnalyticsAlert, 'findOne', () => ({ lean: async () => null }));
    mock.method(AnalyticsAlert, 'findOneAndUpdate', () => ({
      lean: async () => ({ dedupeKey: 'x', status: 'open', type: 'operational_health' }),
    }));

    const copilotAnalytics = require('../services/chatbot/humanCopilot/humanCopilotAnalyticsService');
    const snapshotSvc = require('../services/analytics/leadLifecycleSnapshotService');
    mock.method(copilotAnalytics, 'getAnalyticsWorkloads', async () => ({ data: {} }));
    mock.method(copilotAnalytics, 'getAnalyticsOverview', async () => ({
      data: { volume: { active: 0 }, responseTimes: { avgFirstResponseMs: 0 } },
    }));
    mock.method(snapshotSvc, 'getOrBuildSnapshot', async () => ({
      cohortSize: 10,
      stageCounts: { lead: 10, admission: 2 },
    }));

    const WhatsAppLeadScore = require('../models/WhatsAppLeadScore');
    const WhatsAppLeadProfile = require('../models/WhatsAppLeadProfile');
    const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
    const WhatsAppAgentHandoff = require('../models/WhatsAppAgentHandoff');
    mock.method(WhatsAppLeadScore, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
    mock.method(WhatsAppLeadProfile, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
    mock.method(IitCounsellingSubmission, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
    mock.method(WhatsAppAgentHandoff, 'aggregate', async () => []);

    delete require.cache[require.resolve('../services/analytics/smartAlertsService')];
    const { evaluateAllAlerts } = require('../services/analytics/smartAlertsService');
    const stats = await evaluateAllAlerts();
    assert.ok(stats.evaluatedAt);
    assert.equal(typeof stats.totalCandidates, 'number');
  });
});
