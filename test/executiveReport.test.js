'use strict';

const { describe, test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const ReportModel = require('../models/ExecutiveReportSnapshot');
const reportSvc = require('../services/analytics/executiveReportService');

const SAMPLE_PAYLOAD = {
  reportDate: '2026-06-19',
  generatedAt: new Date().toISOString(),
  executiveSummary: {
    leadVolume: { lifecycleCohort: 100 },
    qualifiedAndHot: { qualifiedLeads: 80, hotLeads: 10 },
    bookings: { lifecycleBooked: 40 },
    conversions: { lifecycleAdmission: 5 },
  },
  alertsMeta: { openCount: 3 },
  followupEffectiveness: { followupsSent: 12, replyRate: 25, conversionRate: 8 },
  summary: {
    lifecycleCohort: 100,
    qualifiedLeads: 80,
    hotLeads: 10,
    lifecycleBooked: 40,
    lifecycleAdmission: 5,
    openAlerts: 3,
    followupsSent: 12,
    replyRate: 25,
    conversionRate: 8,
  },
};

describe('executiveReportService helpers', () => {
  test('extractKpis and compareKpis', () => {
    const current = reportSvc.extractKpis(SAMPLE_PAYLOAD);
    const previous = reportSvc.extractKpis({
      ...SAMPLE_PAYLOAD,
      executiveSummary: {
        leadVolume: { lifecycleCohort: 90 },
        qualifiedAndHot: { qualifiedLeads: 70, hotLeads: 8 },
        bookings: { lifecycleBooked: 35 },
        conversions: { lifecycleAdmission: 4 },
      },
      alertsMeta: { openCount: 5 },
      followupEffectiveness: { followupsSent: 10, replyRate: 20, conversionRate: 6 },
    });
    const comparison = reportSvc.compareKpis(current, previous);
    assert.equal(comparison.lifecycleCohort.delta, 10);
    assert.equal(comparison.openAlerts.delta, -2);
  });

  test('previousReportDate', () => {
    assert.equal(reportSvc.previousReportDate('2026-06-19'), '2026-06-18');
  });
});

describe('executiveReportService generation', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('buildReportPayload composes existing services', async () => {
    const execSvc = require('../services/analytics/analyticsExecutiveService');
    const funnelSvc = require('../services/analytics/leadLifecycleFunnelService');
    const alertsSvc = require('../services/analytics/smartAlertsService');
    const counsellorSvc = require('../services/analytics/counsellorPerformanceService');
    const followupSvc = require('../services/analytics/followupEffectivenessService');

    mock.method(execSvc, 'getExecutiveSummary', async () => SAMPLE_PAYLOAD.executiveSummary);
    mock.method(alertsSvc, 'listAlerts', async () => ({
      items: [{ _id: 'a1', title: 'Test alert' }],
      meta: { openCount: 1 },
    }));
    mock.method(funnelSvc, 'getLifecycleFunnel', async () => ({ stages: [], meta: { cohortSize: 100 } }));
    mock.method(counsellorSvc, 'getCounsellorPerformance', async () => ({ counsellors: [] }));
    mock.method(followupSvc, 'getFollowupEffectiveness', async () => SAMPLE_PAYLOAD.followupEffectiveness);

    delete require.cache[require.resolve('../services/analytics/executiveReportService')];
    const freshSvc = require('../services/analytics/executiveReportService');
    const payload = await freshSvc.buildReportPayload('2026-06-19');
    assert.equal(payload.reportDate, '2026-06-19');
    assert.ok(payload.executiveSummary);
    assert.equal(payload.alerts.length, 1);
    assert.equal(payload.summary.lifecycleCohort, 100);
  });

  test('generateDailyReport creates snapshot', async () => {
    mock.method(reportSvc, 'buildReportPayload', async () => SAMPLE_PAYLOAD);
    mock.method(reportSvc, 'buildComparisonForReport', async () => ({
      previousReportDate: '2026-06-18',
      hasPrevious: false,
      kpis: {},
    }));
    mock.method(ReportModel, 'findOne', () => ({ lean: async () => null }));
    mock.method(ReportModel, 'findOneAndUpdate', () => ({
      lean: async () => ({
        _id: new mongoose.Types.ObjectId(),
        reportDate: '2026-06-19',
        payload: SAMPLE_PAYLOAD,
        generatedAt: new Date(),
        deliveryStatus: 'generated',
      }),
    }));

    const result = await reportSvc.generateDailyReport({ reportDate: '2026-06-19' });
    assert.equal(result.action, 'created');
    assert.equal(result.report.reportDate, '2026-06-19');
  });

  test('generateDailyReport returns existing when not forced', async () => {
    const existing = {
      _id: new mongoose.Types.ObjectId(),
      reportDate: '2026-06-19',
      payload: SAMPLE_PAYLOAD,
      generatedAt: new Date(),
      deliveryStatus: 'generated',
    };
    mock.method(ReportModel, 'findOne', () => ({ lean: async () => existing }));

    const result = await reportSvc.generateDailyReport({ reportDate: '2026-06-19', force: false });
    assert.equal(result.action, 'exists');
    assert.equal(result.report.reportDate, '2026-06-19');
  });
});

describe('executiveReportService history', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('getReportHistory returns lightweight items', async () => {
    mock.method(ReportModel, 'find', () => ({
      sort() {
        return this;
      },
      skip() {
        return this;
      },
      limit() {
        return this;
      },
      select() {
        return {
          lean: async () => [
            {
              _id: new mongoose.Types.ObjectId(),
              reportDate: '2026-06-19',
              generatedAt: new Date(),
              deliveryStatus: 'generated',
              payload: { summary: { lifecycleCohort: 100 } },
            },
          ],
        };
      },
    }));
    mock.method(ReportModel, 'countDocuments', async () => 1);

    const history = await reportSvc.getReportHistory({ limit: 10 });
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].summary.lifecycleCohort, 100);
    assert.equal(history.meta.total, 1);
  });

  test('getLatestReport includes comparison', async () => {
    const current = {
      reportDate: '2026-06-19',
      payload: SAMPLE_PAYLOAD,
    };
    const previous = {
      reportDate: '2026-06-18',
      payload: {
        ...SAMPLE_PAYLOAD,
        summary: { ...SAMPLE_PAYLOAD.summary, lifecycleCohort: 90 },
      },
    };

    mock.method(ReportModel, 'findOne', (filter) => {
      if (!filter || Object.keys(filter).length === 0) {
        return { sort: () => ({ lean: async () => current }) };
      }
      if (filter.reportDate === '2026-06-18') {
        return { lean: async () => previous };
      }
      return { lean: async () => null };
    });

    const latest = await reportSvc.getLatestReport();
    assert.ok(latest.report);
    assert.equal(latest.comparison.previousReportDate, '2026-06-18');
    assert.equal(latest.comparison.kpis.lifecycleCohort.delta, 10);
  });
});

describe('executiveReportService cron path', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('cron generation uses generated deliveryStatus', async () => {
    mock.method(reportSvc, 'buildReportPayload', async () => SAMPLE_PAYLOAD);
    mock.method(reportSvc, 'buildComparisonForReport', async () => ({
      previousReportDate: '2026-06-18',
      hasPrevious: false,
      kpis: {},
    }));
    mock.method(ReportModel, 'findOne', () => ({ lean: async () => null }));
    mock.method(ReportModel, 'findOneAndUpdate', () => ({
      lean: async () => ({
        reportDate: '2026-06-19',
        deliveryStatus: 'generated',
        payload: SAMPLE_PAYLOAD,
      }),
    }));

    const result = await reportSvc.generateDailyReport({
      reportDate: '2026-06-19',
      deliveryStatus: 'generated',
    });
    assert.equal(result.report.deliveryStatus, 'generated');
  });
});
