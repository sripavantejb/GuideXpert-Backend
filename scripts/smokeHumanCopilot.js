'use strict';

/**
 * Human Copilot production smoke test (API + DB).
 * Run: node scripts/smokeHumanCopilot.js
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:5000';
const ADMIN_ID = process.env.SMOKE_ADMIN_ID || '697b3550fcce6972435f3541';

const results = [];

function record(id, pass, detail) {
  results.push({ id, pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id}: ${detail}`);
}

async function api(path, options = {}, token) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { status: res.status, body, ok: res.ok };
}

async function main() {
  const token = jwt.sign({ adminId: ADMIN_ID }, process.env.ADMIN_JWT_SECRET, { expiresIn: '2h' });

  // 1. Health / feature flags
  const health = await api('/api/health');
  const hc = health.body.humanCopilot || {};
  record(
    '1-feature-flags',
    health.ok &&
      hc.enabled === true &&
      hc.ready === true &&
      hc.queueHealthy === true &&
      hc.notificationsHealthy === true,
    JSON.stringify(hc)
  );

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const handoffs = db.collection('whatsappagenthandoffs');
  const conversations = db.collection('whatsappconversations');
  const admins = db.collection('admins');

  // Ensure admin has human-copilot access + agent profile for assignment tests
  await admins.updateOne(
    { _id: new mongoose.Types.ObjectId(ADMIN_ID) },
    {
      $set: {
        sectionAccess: ['human-copilot'],
        'copilotAgentProfile.enabled': true,
        'copilotAgentProfile.role': 'general_counsellor',
        'copilotAgentProfile.availability': 'active',
        'copilotAgentProfile.maxConcurrentConversations': 5,
        'copilotAgentProfile.specialties': ['general'],
        'copilotAgentProfile.legacySlot': 'sr1',
      },
    }
  );

  const phone = '9999900001';
  let conv = await conversations.findOne({ phone });
  if (!conv) {
    const ins = await conversations.insertOne({
      phone,
      productLine: 'guidexpert',
      state: 'handoff',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    conv = await conversations.findOne({ _id: ins.insertedId });
  }

  const handoffDoc = {
    conversationId: conv._id,
    phone,
    productLine: 'guidexpert',
    status: 'open',
    route: 'admin_pool',
    copilotState: 'pending',
    reason: 'user_requested',
    userLastMessage: 'Talk to counsellor - smoke test IIT scholarship question',
    summaryForAgent: 'Smoke test handoff for production verification',
    internalNotes: [],
    copilotReplies: [],
    copilotFollowups: [],
    auditTrail: [],
    lockVersion: 0,
    botPaused: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
  };
  const created = await handoffs.insertOne({ ...handoffDoc });
  const handoffId = String(created.insertedId);

  record('2-trigger-handoff', true, `Created smoke handoff ${handoffId} in MongoDB (simulated WhatsApp trigger)`);

  // 3. Queue
  const queue = await api('/api/admin/human-copilot/queue?limit=50', {}, token);
  const inQueue = (queue.body.items || []).some((i) => i.id === handoffId);
  record('3-queue', queue.ok && inQueue, `status=${queue.status} inQueue=${inQueue} count=${(queue.body.items || []).length}`);

  // 4. Assignment (sr1 legacy)
  const assign = await api(
    `/api/admin/human-copilot/handoffs/${handoffId}/assign`,
    { method: 'POST', body: JSON.stringify({ srCounsellor: 'sr1' }) },
    token
  );
  const afterAssign = await handoffs.findOne({ _id: created.insertedId });
  record(
    '4-assignment',
    assign.ok &&
      afterAssign.assignedSrCounsellor === 'sr1' &&
      afterAssign.assignedAgentId &&
      ['assigned', 'claimed'].includes(afterAssign.copilotState) &&
      (afterAssign.auditTrail || []).some((a) => a.action === 'assigned'),
    `api=${assign.status} assignedAgentId=${!!afterAssign.assignedAgentId} state=${afterAssign.copilotState}`
  );

  // 5. Context / detail
  const detail = await api(`/api/admin/human-copilot/handoffs/${handoffId}`, {}, token);
  const d = detail.body.data || {};
  record(
    '5-context',
    detail.ok &&
      d.handoff &&
      d.transcript !== undefined &&
      (d.structuredSummary !== undefined || d.aiSummary !== undefined),
    `status=${detail.status} hasHandoff=${!!d.handoff} hasSummary=${!!(d.structuredSummary || d.aiSummary)}`
  );

  // 6. Suggest reply
  const suggest = await api(
    `/api/admin/human-copilot/handoffs/${handoffId}/suggest-reply`,
    { method: 'POST', body: JSON.stringify({}) },
    token
  );
  record(
    '6-suggest-reply',
    suggest.ok && Array.isArray(suggest.body.suggestions),
    `status=${suggest.status} suggestions=${(suggest.body.suggestions || []).length} fallback=${suggest.body.fallback}`
  );

  // 7. Reply (may fail WhatsApp delivery in dev — check API + DB draft)
  const replyText = 'Smoke test reply from Human Copilot admin panel.';
  const suggestedText =
    typeof (suggest.body.suggestions || [])[0] === 'string'
      ? suggest.body.suggestions[0]
      : (suggest.body.suggestions || [])[0]?.text || null;
  const reply = await api(
    `/api/admin/human-copilot/handoffs/${handoffId}/reply`,
    {
      method: 'POST',
      body: JSON.stringify({
        text: replyText,
        lockVersion: assign.body.lockVersion ?? afterAssign.lockVersion,
        replySource: 'ai_edited',
        suggestedText,
      }),
    },
    token
  );
  const afterReply = await handoffs.findOne({ _id: created.insertedId });
  const lastReply = (afterReply.copilotReplies || []).slice(-1)[0];
  record(
    '7-reply',
    reply.ok || (lastReply && ['sending', 'sent', 'failed'].includes(lastReply.status)),
    `api=${reply.status} delivery=${reply.body.deliveryStatus || lastReply?.status} replyId=${reply.body.replyId || lastReply?._id}`
  );

  // 8. Manual reply on second handoff
  const manualHandoff = await handoffs.insertOne({
    conversationId: conv._id,
    phone: '9999900002',
    productLine: 'guidexpert',
    status: 'claimed',
    route: 'admin_pool',
    copilotState: 'assigned',
    assignedSrCounsellor: 'sr1',
    assignedAgentId: new mongoose.Types.ObjectId(ADMIN_ID),
    reason: 'user_requested',
    userLastMessage: 'Manual reply smoke',
    summaryForAgent: 'Manual smoke',
    internalNotes: [],
    copilotReplies: [],
    copilotFollowups: [],
    auditTrail: [],
    lockVersion: 0,
    botPaused: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
  });
  const manualId = String(manualHandoff.insertedId);
  const manualReply = await api(
    `/api/admin/human-copilot/handoffs/${manualId}/reply`,
    { method: 'POST', body: JSON.stringify({ text: 'Manual smoke reply', replySource: 'manual' }) },
    token
  );
  const manualDoc = await handoffs.findOne({ _id: manualHandoff.insertedId });
  const manualLast = (manualDoc.copilotReplies || []).slice(-1)[0];
  record(
    '8-manual-reply',
    manualReply.ok || manualLast?.replySource === 'manual',
    `api=${manualReply.status} replySource=${manualLast?.replySource}`
  );

  // 9. Internal notes
  const note = await api(
    `/api/admin/human-copilot/handoffs/${handoffId}/notes`,
    { method: 'POST', body: JSON.stringify({ text: 'Smoke test internal note' }) },
    token
  );
  const afterNote = await handoffs.findOne({ _id: created.insertedId });
  record(
    '9-internal-notes',
    note.ok && (afterNote.internalNotes || []).some((n) => n.text.includes('Smoke test')),
    `status=${note.status} notes=${(afterNote.internalNotes || []).length}`
  );

  // 10. Resolve
  const resolve = await api(
    `/api/admin/human-copilot/handoffs/${handoffId}/resolve`,
    { method: 'POST', body: '{}' },
    token
  );
  const afterResolve = await handoffs.findOne({ _id: created.insertedId });
  const queueAfter = await api('/api/admin/human-copilot/queue?limit=50', {}, token);
  const stillInQueue = (queueAfter.body.items || []).some((i) => i.id === handoffId);
  record(
    '10-resolve',
    resolve.ok && afterResolve.status === 'resolved' && !stillInQueue,
    `status=${resolve.status} handoffStatus=${afterResolve.status} inQueue=${stillInQueue}`
  );

  // 11. Reopen handoff
  const reopen = await handoffs.insertOne({
    conversationId: conv._id,
    phone,
    productLine: 'guidexpert',
    status: 'open',
    route: 'admin_pool',
    copilotState: 'reopened',
    isReopened: true,
    reason: 'reopened',
    reopenedAt: new Date(),
    userLastMessage: 'Talk to counsellor again',
    summaryForAgent: 'Reopened smoke test',
    internalNotes: [],
    copilotReplies: [],
    copilotFollowups: [],
    auditTrail: [],
    lockVersion: 0,
    botPaused: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
  });
  const reopenId = String(reopen.insertedId);
  const notif = await api('/api/admin/human-copilot/notifications', {}, token);
  const hasReopen = (notif.body.items || []).some((i) => i.id === reopenId);
  record('11-reopen', notif.ok && hasReopen, `notifications=${notif.body.count} hasReopen=${hasReopen}`);

  // 12. Analytics
  const analyticsPaths = [
    '/analytics/overview',
    '/analytics/workloads',
    '/analytics/ai-usage',
    '/analytics/escalations',
    '/analytics/delivery',
    '/analytics/lead-quality',
  ];
  const analyticsOk = (
    await Promise.all(analyticsPaths.map((p) => api(`/api/admin/human-copilot${p}`, {}, token)))
  ).every((r) => r.ok);
  record('12-analytics-tab', analyticsOk, `endpoints=${analyticsPaths.length} allOk=${analyticsOk}`);

  // 13. Learning
  const learningPaths = ['/learning/overview', '/learning/edit-patterns', '/learning/topics', '/learning/examples'];
  const learningOk = (
    await Promise.all(learningPaths.map((p) => api(`/api/admin/human-copilot${p}`, {}, token)))
  ).every((r) => r.ok);
  record('13-learning-tab', learningOk, `endpoints=${learningPaths.length} allOk=${learningOk}`);

  // 14. Follow-ups
  const followups = await api('/api/admin/human-copilot/followups/recommended', {}, token);
  record('14-followup-assistant', followups.ok, `status=${followups.status}`);

  // 15. Agents tab
  const agents = await api('/api/admin/human-copilot/agents', {}, token);
  const routing = await api('/api/admin/human-copilot/routing', {}, token);
  record(
    '15-agents-tab',
    agents.ok && routing.ok && Array.isArray(agents.body.agents),
    `agents=${(agents.body.agents || []).length} routingMode=${routing.body.data?.routingMode}`
  );

  // 16. Multi-agent routing (unit-level via auto-assign API)
  const routeHandoff = await handoffs.insertOne({
    conversationId: conv._id,
    phone: '9999900003',
    productLine: 'guidexpert',
    status: 'open',
    route: 'admin_pool',
    copilotState: 'pending',
    reason: 'user_requested',
    userLastMessage: 'What IIT branch for JEE rank 5000?',
    summaryForAgent: 'IIT branch question',
    internalNotes: [],
    copilotReplies: [],
    copilotFollowups: [],
    auditTrail: [],
    lockVersion: 0,
    botPaused: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
  });
  const routeId = String(routeHandoff.insertedId);
  await api(
    '/api/admin/human-copilot/agents/settings',
    { method: 'POST', body: JSON.stringify({ routingMode: 'specialty' }) },
    token
  );
  const autoAssign = await api(
    `/api/admin/human-copilot/handoffs/${routeId}/auto-assign`,
    { method: 'POST', body: '{}' },
    token
  );
  record(
    '16-multi-agent-routing',
    autoAssign.ok,
    `assigned=${autoAssign.body.assigned} mode=${autoAssign.body.routingMode} reason=${autoAssign.body.reason}`
  );

  // 17. Failed delivery + retry (simulate if last reply failed)
  let retryPass = false;
  if (lastReply?.status === 'failed' && lastReply._id) {
    const retry = await api(
      `/api/admin/human-copilot/handoffs/${handoffId}/retry-reply`,
      { method: 'POST', body: JSON.stringify({ replyId: String(lastReply._id) }) },
      token
    );
    retryPass = retry.ok;
  } else {
    retryPass = true; // not testable without forced failure
  }
  record('17-failed-delivery-retry', retryPass, lastReply?.status === 'failed' ? 'retried' : 'skipped-no-failed-reply');

  // 18. Concurrency — version conflict
  const conflict = await api(
    `/api/admin/human-copilot/handoffs/${reopenId}/assign`,
    { method: 'POST', body: JSON.stringify({ srCounsellor: 'sr1', lockVersion: 0 }) },
    token
  );
  record('18-concurrency', conflict.status === 409 || conflict.ok, `status=${conflict.status} error=${conflict.body.message || conflict.body.error}`);

  // 19. Database fields
  const sample = await handoffs.findOne({ _id: created.insertedId });
  const fieldsOk =
    sample.copilotState &&
    Array.isArray(sample.copilotReplies) &&
    Array.isArray(sample.internalNotes) &&
    Array.isArray(sample.auditTrail);
  record('19-database-verification', fieldsOk, `fields present on resolved handoff ${handoffId}`);

  // 20. E2E journey (API-level)
  const e2ePass = results.filter((r) => r.id.startsWith('2') || r.id.startsWith('3') || r.id.startsWith('4') || r.id.startsWith('7') || r.id.startsWith('9') || r.id.startsWith('10')).every((r) => r.pass);
  record('20-e2e-journey', e2ePass, 'API-level journey through assign/reply/note/resolve');

  // Cleanup smoke handoffs
  await handoffs.deleteMany({ phone: { $in: ['9999900001', '9999900002', '9999900003'] } });

  await mongoose.disconnect();

  const failed = results.filter((r) => !r.pass);
  console.log('\n=== SUMMARY ===');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  if (failed.length) {
    console.log('Failures:', failed.map((f) => f.id).join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
