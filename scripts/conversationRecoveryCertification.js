'use strict';

/**
 * Platform Feature #1 — Conversation Recovery certification (no Mongo required for core).
 * Run: node scripts/conversationRecoveryCertification.js
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  evaluateEligibility,
  mapStageToPhase,
  nextScheduleAt,
  isRecoveryOptOutText,
  deriveFlagsFromJourneyContext,
} = require('../services/conversationRecovery/conversationRecoveryCore');
const {
  buildRecoveryMessage,
  buildTemplateParams,
} = require('../services/conversationRecovery/conversationRecoveryMessageGenerator');
const {
  getConversationRecoveryConfig,
  setConversationRecoveryConfigOverrides,
  resetConversationRecoveryConfigOverrides,
} = require('../services/conversationRecovery/conversationRecoveryConfig');
const {
  classifySendFailure,
} = require('../services/conversationRecovery/conversationRecoveryDeliveryService');
const { cloneJourneyBlob } = require('../services/conversationRecovery/conversationRecoverySnapshotService');

const ROOT = path.join(__dirname, '..');
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push({ name, status: 'PASS' });
    console.log('PASS', name);
  } catch (err) {
    results.push({ name, status: 'FAIL', error: err.message });
    console.error('FAIL', name, err.message);
  }
}

check('config_defaults', () => {
  resetConversationRecoveryConfigOverrides();
  const cfg = getConversationRecoveryConfig();
  assert.deepEqual(cfg.intervalsHours, [24, 72, 168]);
  assert.equal(cfg.maxAttempts, 3);
  assert.equal(cfg.messageKind, 'conversation_recovery');
});

check('config_overrides', () => {
  setConversationRecoveryConfigOverrides({ maxAttempts: 5, intervalsHours: [1, 2, 3] });
  const cfg = getConversationRecoveryConfig();
  assert.equal(cfg.maxAttempts, 5);
  assert.deepEqual(cfg.intervalsHours, [1, 2, 3]);
  resetConversationRecoveryConfigOverrides();
});

check('map_stage_to_phase', () => {
  assert.equal(mapStageToPhase('personalized_recommendation'), 9);
  assert.equal(mapStageToPhase('future_path_vision'), 10);
  assert.equal(mapStageToPhase('phase_11_hesitation'), 11);
  assert.equal(mapStageToPhase('counseling_recommendation'), 12);
  assert.equal(mapStageToPhase('phase_13_booking'), 13);
  assert.equal(mapStageToPhase('journey_completed'), 14);
});

check('derive_flags', () => {
  const incomplete = deriveFlagsFromJourneyContext({ profile: {} });
  assert.equal(incomplete.journeyCompleted, false);
  assert.equal(incomplete.bookingCompleted, false);
  assert.equal(incomplete.optedOut, false);

  const booked = deriveFlagsFromJourneyContext({
    profile: { journeyOutcome: 'booking_initiated' },
  });
  assert.equal(booked.bookingCompleted, true);

  const opted = deriveFlagsFromJourneyContext({
    profile: { journeyOutcome: 'opted_out' },
  });
  assert.equal(opted.optedOut, true);
});

check('eligibility_all_gates', () => {
  const cfg = {
    featureEnabled: true,
    intervalsHours: [24, 72, 168],
    maxAttempts: 3,
    inactivityBaseHours: 24,
  };
  const now = new Date('2026-07-18T12:00:00.000Z');
  const snap = {
    journeyCompleted: false,
    bookingCompleted: false,
    optedOut: false,
    lastActivityAt: new Date('2026-07-16T12:00:00.000Z'),
  };
  const ok = evaluateEligibility(snap, { attemptCount: 0 }, cfg, now);
  assert.equal(ok.eligible, true);

  assert.equal(
    evaluateEligibility(
      { ...snap, journeyCompleted: true },
      { attemptCount: 0 },
      cfg,
      now
    ).eligible,
    false
  );
  assert.equal(
    evaluateEligibility(
      { ...snap, bookingCompleted: true },
      { attemptCount: 0 },
      cfg,
      now
    ).eligible,
    false
  );
  assert.equal(
    evaluateEligibility({ ...snap, optedOut: true }, { attemptCount: 0 }, cfg, now)
      .eligible,
    false
  );
  assert.equal(
    evaluateEligibility(snap, { attemptCount: 3 }, cfg, now).eligible,
    false
  );
  assert.equal(
    evaluateEligibility(
      { ...snap, lastActivityAt: new Date('2026-07-18T10:00:00.000Z') },
      { attemptCount: 0 },
      cfg,
      now
    ).eligible,
    false
  );
  assert.equal(
    evaluateEligibility(snap, { paused: true }, cfg, now).eligible,
    false
  );
});

check('next_schedule_intervals', () => {
  const cfg = { intervalsHours: [24, 72, 168] };
  const base = new Date('2026-07-17T00:00:00.000Z');
  const a1 = nextScheduleAt(base, 1, cfg);
  assert.equal(a1.toISOString(), '2026-07-18T00:00:00.000Z');
  const a2 = nextScheduleAt(base, 2, cfg);
  assert.equal(a2.toISOString(), '2026-07-20T00:00:00.000Z');
  const a3 = nextScheduleAt(base, 3, cfg);
  assert.equal(a3.toISOString(), '2026-07-24T00:00:00.000Z');
});

check('opt_out_phrases', () => {
  assert.equal(isRecoveryOptOutText('STOP'), true);
  assert.equal(isRecoveryOptOutText('unsubscribe'), true);
  assert.equal(isRecoveryOptOutText('not interested'), true);
  assert.equal(isRecoveryOptOutText('continue please'), false);
});

check('message_generator_no_booking_url', () => {
  for (const phase of [1, 9, 10, 11, 12, 13]) {
    const msg = buildRecoveryMessage({ lastPhase: phase, studentName: 'Asha' });
    assert.match(msg, /Asha/);
    assert.doesNotMatch(msg, /https?:\/\//i);
    assert.doesNotMatch(msg, /phase 1/i);
    const params = buildTemplateParams({ lastPhase: phase, studentName: 'Asha Kumar' });
    assert.equal(params[0], 'Asha');
    assert.equal(params.length, 2);
  }
});

check('failure_classification', () => {
  assert.equal(classifySendFailure(new Error('rate limit 429')), 'rate_limit');
  assert.equal(classifySendFailure(new Error('template missing')), 'template_missing');
  assert.equal(classifySendFailure(new Error('user blocked')), 'blocked');
});

check('journey_blob_clone', () => {
  const src = { stage: 'x', profile: { name: 'A' }, nested: { a: 1 } };
  const cloned = cloneJourneyBlob(src);
  assert.deepEqual(cloned, src);
  cloned.nested.a = 9;
  assert.equal(src.nested.a, 1);
});

check('resume_service_exports', () => {
  const resume = require('../services/conversationRecovery/conversationRecoveryResumeService');
  assert.equal(typeof resume.tryResumeFromRecovery, 'function');
  assert.equal(typeof resume.pauseCase, 'function');
  assert.equal(typeof resume.stopCase, 'function');
  assert.equal(typeof resume.rescheduleCase, 'function');
});

check('aggregates_exports', () => {
  const agg = require('../services/conversationRecovery/conversationRecoveryAggregates');
  assert.equal(typeof agg.getOverviewMetrics, 'function');
  assert.equal(typeof agg.getFunnelMetrics, 'function');
  assert.equal(typeof agg.listStudents, 'function');
});

check('scheduler_exports', () => {
  const sched = require('../services/conversationRecovery/conversationRecoveryScheduler');
  assert.equal(typeof sched.runConversationRecoveryCron, 'function');
  assert.equal(typeof sched.dispatchDueAttempts, 'function');
});

check('phases_1_14_engines_untouched', () => {
  const enginesDir = path.join(
    ROOT,
    'services/chatbot/careerCounselling'
  );
  const forbidden = [
    'conversationRecovery',
    'ConversationRecovery',
    'recoveryEligible',
  ];
  const files = fs.readdirSync(enginesDir).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const text = fs.readFileSync(path.join(enginesDir, file), 'utf8');
    for (const needle of forbidden) {
      assert.equal(
        text.includes(needle),
        false,
        `${file} must not reference ${needle}`
      );
    }
  }
});

check('snapshot_hook_in_guided_processor_only', () => {
  const proc = fs.readFileSync(
    path.join(ROOT, 'services/chatbot/guidedFlows/guidedFlowProcessors.js'),
    'utf8'
  );
  assert.match(proc, /upsertFromTurn/);
  assert.match(proc, /conversationRecoverySnapshotService/);
});

check('orchestrator_resume_intercept', () => {
  const orch = fs.readFileSync(
    path.join(ROOT, 'services/chatbot/chatbotOrchestratorService.js'),
    'utf8'
  );
  assert.match(orch, /tryResumeFromRecovery/);
});

check('cron_and_admin_routes_present', () => {
  const cron = fs.readFileSync(path.join(ROOT, 'routes/cronRoutes.js'), 'utf8');
  assert.match(cron, /conversation-recovery/);
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /conversation-recovery/);
  const vercel = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  assert.match(vercel, /conversation-recovery/);
});

check('idempotency_key_format', () => {
  const {
    buildIdempotencyKey,
    isAttemptAlreadyProcessed,
  } = require('../services/conversationRecovery/conversationRecoveryIdempotency');
  assert.equal(
    buildIdempotencyKey('abc', 2),
    'abc:conversation_recovery:2'
  );
  assert.equal(isAttemptAlreadyProcessed({ deliveryStatus: 'sent' }), true);
  assert.equal(isAttemptAlreadyProcessed({ deliveryStatus: 'queued' }), false);
  assert.equal(isAttemptAlreadyProcessed({ sentAt: new Date() }), true);
});

check('ops_window_quiet_hours', () => {
  const { evaluateSendWindow } = require('../services/conversationRecovery/conversationRecoveryOpsWindow');
  const noon = new Date('2026-07-18T06:30:00.000Z'); // ~12:00 IST
  const ok = evaluateSendWindow(
    {
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      sendWindowEnabled: true,
      sendWindowStart: '09:00',
      sendWindowEnd: '20:00',
      timezone: 'Asia/Kolkata',
    },
    noon
  );
  assert.equal(ok.allowed, true);
  const night = new Date('2026-07-18T18:30:00.000Z'); // ~00:00 IST
  const blocked = evaluateSendWindow(
    {
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      timezone: 'Asia/Kolkata',
    },
    night
  );
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.reasons.includes('quiet_hours'));
});

check('campaign_config_ops_fields', () => {
  resetConversationRecoveryConfigOverrides();
  setConversationRecoveryConfigOverrides({
    quietHoursEnabled: true,
    dailySendLimit: 100,
    sendWindowEnabled: true,
    delayHours: 24,
    retryIntervalHours: 72,
  });
  const cfg = getConversationRecoveryConfig();
  assert.equal(cfg.quietHoursEnabled, true);
  assert.equal(cfg.dailySendLimit, 100);
  assert.equal(cfg.sendWindowEnabled, true);
  assert.deepEqual(cfg.intervalsHours.slice(0, 2), [24, 72]);
  resetConversationRecoveryConfigOverrides();
});

check('ops_modules_exports', () => {
  assert.equal(
    typeof require('../services/conversationRecovery/conversationRecoveryHealth').getRecoveryHealth,
    'function'
  );
  assert.equal(
    typeof require('../services/conversationRecovery/conversationRecoveryAlertService')
      .evaluateAndUpsertAlerts,
    'function'
  );
  assert.equal(
    typeof require('../services/conversationRecovery/conversationRecoveryAuditService')
      .writeAuditLog,
    'function'
  );
  assert.equal(
    typeof require('../services/conversationRecovery/conversationRecoveryTimeline')
      .buildDeliveryTimeline,
    'function'
  );
  assert.equal(
    typeof require('../services/conversationRecovery/conversationRecoveryCampaignPerformance')
      .getCampaignPerformance,
    'function'
  );
  assert.equal(
    typeof require('../services/conversationRecovery/conversationRecoveryMessageGenerator')
      .previewRecoveryMessage,
    'function'
  );
  const resume = require('../services/conversationRecovery/conversationRecoveryResumeService');
  assert.equal(typeof resume.resumeCase, 'function');
});

check('timeline_step_order', () => {
  const {
    buildDeliveryTimeline,
  } = require('../services/conversationRecovery/conversationRecoveryTimeline');
  const tl = buildDeliveryTimeline({
    caseDoc: { recoveredAt: new Date('2026-07-18T12:00:00Z'), status: 'recovered' },
    attempts: [
      {
        attemptNumber: 1,
        queuedAt: new Date('2026-07-17T10:00:00Z'),
        sentAt: new Date('2026-07-17T10:01:00Z'),
        deliveredAt: new Date('2026-07-17T10:02:00Z'),
        readAt: new Date('2026-07-17T10:03:00Z'),
        repliedAt: new Date('2026-07-17T11:00:00Z'),
      },
    ],
  });
  assert.deepEqual(
    tl.steps.map((s) => s.key),
    ['queued', 'sent', 'delivered', 'read', 'reply', 'recovered', 'journey_completed']
  );
  assert.equal(tl.steps.filter((s) => s.completed).length >= 6, true);
});

check('admin_ops_routes_present', () => {
  const routes = fs.readFileSync(
    path.join(ROOT, 'routes/conversationRecoveryAdminRoutes.js'),
    'utf8'
  );
  for (const needle of [
    '/health',
    '/alerts',
    '/audit-logs',
    '/bulk',
    '/trends',
    '/campaign-performance',
    '/message-preview',
    '/system-metrics',
    '/students/:id/resume',
    '/students/:id/timeline',
  ]) {
    assert.match(routes, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

check('version_freeze_marker', () => {
  const readiness = fs.readFileSync(
    path.join(ROOT, 'docs/CONVERSATION-RECOVERY-PRODUCTION-READINESS.md'),
    'utf8'
  );
  assert.match(readiness, /v1\.0\.0/);
  assert.match(readiness, /Production Ready/i);
});

// Optional: invoke phase1to14 if env set
if (process.env.CONVERSATION_RECOVERY_RUN_PHASE_REGRESSION === '1') {
  check('phase1to14_regression_invoked', () => {
    const r = spawnSync('node', ['scripts/phase1to14Regression.js'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env,
    });
    assert.equal(r.status, 0, r.stdoutTail || r.stderr || 'phase regression failed');
  });
}

const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
const summary = {
  suite: 'conversation_recovery_certification',
  total: results.length,
  pass,
  fail,
  overall: fail === 0 ? 'PASS' : 'FAIL',
  results,
};
console.log('\n' + JSON.stringify(summary, null, 2));
process.exit(fail === 0 ? 0 : 2);
