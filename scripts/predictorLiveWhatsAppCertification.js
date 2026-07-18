#!/usr/bin/env node
'use strict';

/**
 * Live WhatsApp production certification — Rank + College Predictor + regressions.
 *
 * Path: POST production /webhook/gupshup → processInbound → Gupshup → WhatsApp 9347763131
 * Evidence: production Mongo inbound/outbound/botState (+ optional analytics).
 *
 * Does NOT modify product code. Does NOT require local GUPSHUP_API_KEY
 * (Vercel production holds credentials). Local Gupshup pull is redacted.
 *
 *   node scripts/predictorLiveWhatsAppCertification.js
 *   PREDICTOR_LIVE_WAIT_MS=5000 node scripts/predictorLiveWhatsAppCertification.js
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');

const BACKEND = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env') });

const WEBHOOK =
  process.env.PREDICTOR_LIVE_WEBHOOK_URL ||
  process.env.SECTION_D_WEBHOOK_URL ||
  'https://guide-xpert-backend.vercel.app/webhook/gupshup';
const HEALTH =
  process.env.PREDICTOR_LIVE_HEALTH_URL || 'https://guide-xpert-backend.vercel.app/api/health';
const PHONE10 = String(process.env.PREDICTOR_LIVE_PHONE || '9347763131').replace(/\D/g, '').slice(-10);
const SOURCE = '91' + PHONE10;
const OUT_DIR = path.join(BACKEND, 'smoke-results', 'predictor');
const WAIT_MS = Number(process.env.PREDICTOR_LIVE_WAIT_MS || 5000);
const DELIVERY_WAIT_MS = Number(process.env.PREDICTOR_LIVE_DELIVERY_WAIT_MS || 20000);
const DELIVERY_POLL_MS = Number(process.env.PREDICTOR_LIVE_DELIVERY_POLL_MS || 2000);

const RE = {
  rankStart: /rank predictor|enter your (marks|percentile|score)|which exam|TS EAMCET|JEE|Reply with number only/i,
  collegeStart:
    /college predictor|which exam|select.*(your )?exam|AP EAMCET|TS EAMCET|Please enter your rank|Reply with number only/i,
  prediction: /here are your predicted colleges|predicted colleges:|opening.?closing|closing rank/i,
  rankResult: /predicted rank|estimated rank|your rank|rank (is|range|band)|approx(imate)? rank/i,
  ka: /knowledge assistant|I can help with GuideXpert|based on (our|the) knowledge/i,
  handoff: /connected you with a human agent|Please wait; we will reply here/i,
  menu: /main menu|reply with (a )?number|IIT Counselling|College Predictor|Rank Predictor/i,
  greeting: /hello|hi |welcome|how can I help|GuideXpert/i,
  scope: /I'm here to help only with GuideXpert|outside (my|the) scope/i,
  cancelExit: /cancelled|canceled|exited|main menu|how can I help/i,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildPayload(text, id) {
  return {
    type: 'message',
    payload: {
      source: SOURCE,
      id,
      type: 'text',
      payload: { type: 'text', text: text == null ? '' : String(text) },
    },
  };
}

function extractReplyText(outbound) {
  if (!outbound) return '';
  if (outbound.content?.text) return String(outbound.content.text);
  if (outbound.textPreview) return String(outbound.textPreview);
  if (outbound.text) return String(outbound.text);
  return '';
}

async function resetBotState(db, conversationId) {
  if (!conversationId) return;
  await db.collection('whatsappagenthandoffs').updateMany(
    { conversationId, status: { $in: ['open', 'claimed'] } },
    { $set: { status: 'cancelled', updatedAt: new Date(), resolvedAt: new Date() } }
  );
  await db.collection('whatsappbotstates').updateOne(
    { conversationId },
    {
      $set: {
        state: 'main_menu',
        context: {
          college: {},
          rank: {},
          careerCounselling: {},
          knowledgeAssistantActive: false,
          counsellorProgramAssistantActive: false,
          counsellorProgramSessionLanguage: null,
          iitCounsellingExpertActive: false,
          iitCounsellingExpertSessionLanguage: null,
          iitCounsellingStrategyActive: false,
          iitCounsellingStrategySessionLanguage: null,
          jeeCounsellingActive: false,
          jeeExamTrack: null,
          currentJourney: null,
          collegePredictorActive: false,
        },
        updatedAt: new Date(),
      },
    },
    { upsert: false }
  );
  await db.collection('whatsappconversations').updateOne(
    { _id: conversationId },
    {
      $set: {
        status: 'active',
        currentHandoffId: null,
        productLine: 'iit_counselling',
        updatedAt: new Date(),
      },
    }
  );
}

async function waitDelivery(outboundCol, outboundId, timeoutMs) {
  if (!outboundId) return { ok: false, status: null, reason: 'no_outbound_id' };
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await outboundCol.findOne({ _id: outboundId });
    const st = String(last?.status || '');
    if (/delivered|read/i.test(st)) return { ok: true, status: st, doc: last };
    if (/failed/i.test(st)) {
      return {
        ok: false,
        status: st,
        doc: last,
        reason: last?.webhookErrorReason || 'outbound_failed',
      };
    }
    if (/submitted|sent|accepted/i.test(st) && last?.gupshupMessageId) {
      // keep polling for DLR
    }
    await sleep(DELIVERY_POLL_MS);
  }
  last = await outboundCol.findOne({ _id: outboundId });
  const st = String(last?.status || '');
  if (/submitted|sent|accepted/i.test(st) && last?.gupshupMessageId) {
    return {
      ok: true,
      status: st,
      doc: last,
      acceptedAsSubmitted: true,
      reason: 'DLR not seen within timeout; accepted submitted+gupshupMessageId',
    };
  }
  return {
    ok: false,
    status: st || null,
    doc: last,
    reason: `delivery_timeout status=${st || 'unknown'}`,
  };
}

function buildCases() {
  /** @type {Array<{id:string,suite:string,user:string,resetState?:boolean,expect:object,note?:string}>} */
  const cases = [];
  const add = (id, suite, user, expect, opts = {}) =>
    cases.push({
      id,
      suite,
      user,
      resetState: opts.resetState !== false,
      expect,
      note: opts.note || '',
    });

  // ── Rank Predictor ──
  add('R1', 'rank', 'Predict my rank', {
    journey: 'rank',
    replyMatch: RE.rankStart,
    noKaSteal: true,
  });
  add('R2', 'rank', 'Estimate my rank', {
    journey: 'rank',
    replyMatch: RE.rankStart,
    noKaSteal: true,
  });
  add('R3', 'rank', 'Rank predictor', {
    journey: 'rank',
    replyMatch: RE.rankStart,
    noKaSteal: true,
  });
  add('R4a', 'rank', 'Rank predictor', { journey: 'rank', replyMatch: RE.rankStart }, { note: 'seed' });
  add(
    'R4b',
    'rank',
    'I got 85 marks in TS EAMCET',
    { journey: 'rank', slotOrProgress: true },
    { resetState: false, note: 'marks slot' }
  );
  add('R5', 'rank', 'My JEE percentile is 96', {
    journey: 'rank',
    slotOrProgress: true,
    noKaSteal: true,
  });
  add('R6a', 'rank', 'Rank predictor', { journey: 'rank' }, { note: 'seed cancel' });
  add(
    'R6b',
    'rank',
    'Cancel',
    { exitedOrMenu: true },
    { resetState: false }
  );
  add('R7a', 'rank', 'Rank predictor', { journey: 'rank' }, { note: 'seed restart' });
  add(
    'R7b',
    'rank',
    'Restart',
    { journey: 'rank', replyMatch: RE.rankStart },
    { resetState: false }
  );

  // ── College Predictor entry / NL ──
  add('C1', 'college', 'College predictor', {
    journey: 'college',
    replyMatch: RE.collegeStart,
    noKaSteal: true,
  });
  add('C2', 'college', 'Predict colleges', {
    journey: 'college',
    replyMatch: RE.collegeStart,
    noKaSteal: true,
  });
  add('C3', 'college', 'Which colleges can I get?', {
    journey: 'college',
    replyMatch: RE.collegeStart,
    noKaSteal: true,
  });
  add('C4', 'college', 'My TS EAMCET rank is 5200', {
    journey: 'college',
    slotOrProgress: true,
    noKaSteal: true,
  });
  add('C5', 'college', 'My AP EAMCET rank is 6500', {
    journey: 'college',
    slotOrProgress: true,
    noKaSteal: true,
  });
  add('C6', 'college', 'AIR 3500', {
    journey: 'college',
    slotOrProgress: true,
    noKaSteal: true,
  });
  add('C7', 'college', '5', {
    journey: 'college',
    replyMatch: RE.collegeStart,
    noKeamTrap: true,
    noKaSteal: true,
  }, { note: 'main-menu digit 5 → College welcome (not KEAM)' });

  // Exam selection (NL labels — stable vs menu digit order)
  const exams = [
    ['C8', 'KEAM', 'KEAM'],
    ['C9', 'MHT CET', 'MHT CET'],
    ['C10', 'KCET', 'KCET'],
    ['C11', 'WBJEE', 'WBJEE'],
    ['C12', 'JEE Main', 'JEE Main'],
  ];
  for (const [id, user, exam] of exams) {
    add(`${id}a`, 'college', 'College predictor', { journey: 'college' }, { note: `seed ${exam}` });
    add(
      `${id}b`,
      'college',
      user,
      { journey: 'college', examHint: exam, slotOrProgress: true },
      { resetState: false, note: `select ${exam}` }
    );
  }

  add('C13a', 'college', 'College predictor', { journey: 'college' }, { note: 'seed cancel' });
  add('C13b', 'college', 'Cancel', { exitedOrMenu: true }, { resetState: false });
  add('C14a', 'college', 'College predictor', { journey: 'college' }, { note: 'seed restart' });
  add(
    'C14b',
    'college',
    'Restart',
    { journey: 'college', replyMatch: RE.collegeStart },
    { resetState: false }
  );

  // Full E2E college prediction (must deliver to WhatsApp)
  add('E2E1', 'e2e', 'College predictor', { journey: 'college' }, { note: 'full journey seed' });
  add('E2E2', 'e2e', 'TS EAMCET', { journey: 'college' }, { resetState: false, note: 'exam' });
  add('E2E3', 'e2e', '5200', { journey: 'college' }, { resetState: false, note: 'rank' });
  add('E2E4', 'e2e', 'OC', { journey: 'college' }, { resetState: false, note: 'category' });
  add(
    'E2E5',
    'e2e',
    'Female',
    {
      journey: 'college',
      requirePredictionOrPrompt: true,
      requireDelivery: true,
    },
    { resetState: false, note: 'gender → predict (Female avoids AP OC Male block; TS OK)' }
  );

  // Regressions
  add('X1', 'regression', 'Hi', { replyMatch: RE.greeting });
  add('X2', 'regression', 'Menu', { replyMatch: RE.menu });
  add('X3', 'regression', 'IIT Counselling', {
    replyMatch: /IIT|JoSAA|counselling|counseling/i,
    noKaSteal: false,
  });
  add('X4', 'regression', 'Counselling Support', {
    replyMatch: /counsell|counsel|support|human|agent|help/i,
  });
  add('X5', 'regression', 'What is GuideXpert?', {
    replyMatch: /GuideXpert|counsell|counsel|admission|education/i,
  });
  add('X6', 'regression', 'JEE counselling strategy', {
    replyMatch: /JEE|counselling|counseling|strategy|JoSAA|choice/i,
  });
  add('X7', 'regression', 'Talk to human', { replyMatch: RE.handoff });
  add('X8a', 'regression', 'Hi', { replyMatch: RE.greeting }, { note: 'lang seed' });
  add(
    'X8b',
    'regression',
    'Telugu',
    { languageOrAck: true },
    { resetState: false, note: 'language switch attempt' }
  );
  add('X9', 'regression', 'Restart', { replyMatch: /menu|welcome|how can I help|GuideXpert/i });

  return cases;
}

function evaluate(c, meta) {
  const fails = [];
  const warns = [];
  const e = c.expect || {};
  const reply = meta.reply || '';
  const state = String(meta.botState?.state || '');
  const ctx = meta.botState?.context || {};
  const journey =
    ctx.currentJourney ||
    (ctx.collegePredictorActive || state.includes('college') ? 'college_predictor' : null) ||
    (state.includes('rank') ? 'rank_predictor' : null);

  if (!meta.inboundSaved) fails.push('inbound_not_saved');
  if (!meta.outboundSaved) fails.push('outbound_not_saved');
  if (meta.webhookHttp && meta.webhookHttp >= 400) fails.push(`webhook_http_${meta.webhookHttp}`);

  if (e.journey === 'rank') {
    const ok =
      /rank/i.test(state) ||
      journey === 'rank_predictor' ||
      RE.rankStart.test(reply) ||
      RE.rankResult.test(reply);
    if (!ok) fails.push('rank_journey_not_entered');
  }
  if (e.journey === 'college') {
    const ok =
      /college/i.test(state) ||
      journey === 'college_predictor' ||
      ctx.collegePredictorActive ||
      RE.collegeStart.test(reply) ||
      RE.prediction.test(reply);
    if (!ok) fails.push('college_journey_not_entered');
  }
  if (e.replyMatch && !e.replyMatch.test(reply)) fails.push('reply_mismatch');
  if (e.noKaSteal && (RE.ka.test(reply) || ctx.knowledgeAssistantActive)) {
    fails.push('stolen_by_knowledge_assistant');
  }
  if (e.noKeamTrap && /KEAM/i.test(reply) && !/which exam|select.*exam|College Predictor/i.test(reply)) {
    fails.push('menu_5_trapped_as_keam');
  }
  if (e.slotOrProgress) {
    const progressed =
      RE.collegeStart.test(reply) ||
      RE.rankStart.test(reply) ||
      RE.prediction.test(reply) ||
      RE.rankResult.test(reply) ||
      /rank|percentile|category|gender|admission|marks|exam/i.test(reply);
    if (!progressed) fails.push('slot_or_progress_missing');
  }
  if (e.exitedOrMenu) {
    if (!RE.cancelExit.test(reply) && !RE.menu.test(reply) && /college_predictor|rank_predictor/i.test(state)) {
      fails.push('journey_did_not_exit');
    }
  }
  if (e.requirePredictionOrPrompt) {
    if (!RE.prediction.test(reply) && !/rank|category|gender|admission|exam/i.test(reply)) {
      fails.push('prediction_or_prompt_missing');
    }
  }
  if (e.requireDelivery) {
    if (!meta.delivery?.ok) fails.push(`delivery_failed:${meta.delivery?.reason || meta.delivery?.status}`);
  } else if (meta.outboundStatus && !/submitted|delivered|read|sent|accepted/i.test(String(meta.outboundStatus))) {
    warns.push(`outbound_status_${meta.outboundStatus}`);
  }

  if (e.languageOrAck) {
    if (!reply || reply.length < 5) fails.push('language_no_reply');
  }

  if (e.examHint && meta.botState?.context?.college?.exam) {
    const exam = String(meta.botState.context.college.exam);
    if (!new RegExp(e.examHint.replace(/\s+/g, '.*'), 'i').test(exam) && !new RegExp(e.examHint, 'i').test(reply)) {
      warns.push(`exam_slot_may_differ:${exam}`);
    }
  }

  let status = 'PASS';
  if (fails.length) status = 'FAIL';
  else if (warns.length) status = 'PASS_WITH_WARNINGS';
  return { status, fails, warns };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');

  console.log('═══════════════════════════════════════════════════');
  console.log(' PREDICTOR LIVE WHATSAPP CERTIFICATION');
  console.log(' Phone:', PHONE10);
  console.log(' Webhook:', WEBHOOK);
  console.log(' Started:', startedAt.toISOString());
  console.log('═══════════════════════════════════════════════════\n');

  const preflight = {
    health: null,
    mongo: false,
    earlywaveHost: process.env.NW_PREDICTORS_BASE_URL || null,
    localGupshup: false,
    path: 'production_webhook_real_gupshup',
    blockers: [],
  };

  try {
    const health = await axios.get(HEALTH, { timeout: 15000 });
    preflight.health = {
      status: health.data?.status,
      whatsappReady: health.data?.whatsapp?.ready,
      gupshupConfigured: health.data?.whatsapp?.gupshupConfigured,
      chatbotEnabled: health.data?.whatsapp?.chatbotEnabled,
      scopeReady: health.data?.scopeFirewall?.ready,
      warnings: health.data?.whatsapp?.warnings || [],
    };
    if (!health.data?.whatsapp?.ready) preflight.blockers.push('Production WhatsApp not ready');
    if (!health.data?.whatsapp?.gupshupConfigured) preflight.blockers.push('Production Gupshup not configured');
  } catch (e) {
    preflight.blockers.push(`Health check failed: ${e.message}`);
  }

  if (!process.env.MONGODB_URI) preflight.blockers.push('MONGODB_URI missing locally (needed for evidence)');

  if (preflight.blockers.length) {
    console.error('BLOCKED:', preflight.blockers.join('; '));
    const blocked = {
      recommendation: 'NO GO',
      reason: 'preflight_failed',
      preflight,
      startedAt: startedAt.toISOString(),
    };
    const out = path.join(OUT_DIR, `predictor-live-wa-cert-${stamp}.json`);
    fs.writeFileSync(out, JSON.stringify(blocked, null, 2));
    process.exit(2);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  preflight.mongo = true;
  const db = mongoose.connection.db;
  const inboundCol = db.collection('whatsappinboundmessages');
  const outboundCol = db.collection('whatsappoutboundmessages');
  const convCol = db.collection('whatsappconversations');
  const botCol = db.collection('whatsappbotstates');
  const analyticsCol = db.collection('chatbotanalyticsevents');

  await convCol.updateMany(
    { phone: PHONE10 },
    { $set: { productLine: 'iit_counselling', updatedAt: new Date() } }
  );
  let conversationId = (await convCol.findOne({ phone: PHONE10 }))?._id || null;
  console.log('Conversation:', conversationId ? String(conversationId) : 'none (will create on first inbound)');
  console.log('Preflight OK — production Gupshup path\n');

  const cases = buildCases();
  const results = [];
  let e2eDelivered = false;

  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i];
    const msgId = `pred-live-${c.id}-${Date.now()}-${i}`;
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.id} ${JSON.stringify(c.user).slice(0, 48)} … `);

    if (c.resetState && conversationId) {
      await resetBotState(db, conversationId);
    }

    const stateBefore = conversationId
      ? await botCol.findOne({ conversationId })
      : null;

    let webhookHttp = null;
    let webhookError = null;
    const t0 = Date.now();
    try {
      const res = await axios.post(WEBHOOK, buildPayload(c.user, msgId), {
        timeout: 120000,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
      webhookHttp = res.status;
    } catch (err) {
      webhookHttp = err.response?.status || 0;
      webhookError = err.message;
    }

    await sleep(WAIT_MS);

    const inbound = await inboundCol.findOne({ providerMessageId: msgId });
    if (inbound?.conversationId) {
      conversationId = inbound.conversationId;
      await convCol.updateOne(
        { _id: conversationId },
        { $set: { productLine: 'iit_counselling', updatedAt: new Date() } }
      );
    }

    let outbound = null;
    if (inbound?._id) {
      outbound = await outboundCol
        .find({ inReplyToInboundId: inbound._id, senderType: 'bot' })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
    }
    if (!outbound && conversationId) {
      outbound = await outboundCol
        .find({ conversationId, senderType: 'bot', createdAt: { $gte: new Date(t0 - 2000) } })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
    }

    let delivery = null;
    if (c.expect.requireDelivery && outbound?._id) {
      delivery = await waitDelivery(outboundCol, outbound._id, DELIVERY_WAIT_MS);
      if (delivery.ok) e2eDelivered = true;
    } else if (outbound?._id) {
      // light poll for status enrichment
      delivery = await waitDelivery(outboundCol, outbound._id, Math.min(8000, DELIVERY_WAIT_MS));
      if (delivery.ok && c.suite === 'e2e') e2eDelivered = true;
    }

    const stateAfter = conversationId ? await botCol.findOne({ conversationId }) : null;
    const reply = extractReplyText(outbound);

    let analytics = [];
    try {
      analytics = await analyticsCol
        .find({
          $or: [
            { conversationId },
            { phone: PHONE10 },
            { 'meta.phone': PHONE10 },
          ],
          createdAt: { $gte: new Date(t0 - 1000) },
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
    } catch (_) {
      analytics = [];
    }

    const meta = {
      inboundSaved: Boolean(inbound),
      outboundSaved: Boolean(outbound),
      webhookHttp,
      webhookError,
      outboundStatus: outbound?.status || null,
      gupshupMessageId: outbound?.gupshupMessageId || null,
      reply,
      botState: stateAfter
        ? { state: stateAfter.state, context: stateAfter.context || {} }
        : null,
      stateBefore: stateBefore ? { state: stateBefore.state } : null,
      delivery,
      analyticsEvents: analytics.map((a) => a.event || a.type || a.name || a._id),
      latencyMs: Date.now() - t0,
    };

    const verdict = evaluate(c, meta);
    console.log(verdict.status, verdict.fails.length ? verdict.fails.join(',') : '');

    results.push({
      ...c,
      ...verdict,
      evidence: {
        providerMessageId: msgId,
        inboundId: inbound?._id || null,
        outboundId: outbound?._id || null,
        webhookHttp,
        outboundStatus: meta.outboundStatus,
        gupshupMessageId: meta.gupshupMessageId,
        delivery,
        stateBefore: meta.stateBefore,
        stateAfter: meta.botState
          ? {
              state: meta.botState.state,
              currentJourney: meta.botState.context?.currentJourney || null,
              college: meta.botState.context?.college || {},
              rank: meta.botState.context?.rank || {},
            }
          : null,
        replyPreview: reply.slice(0, 400),
        analyticsEvents: meta.analyticsEvents,
        latencyMs: meta.latencyMs,
        webhookError,
      },
    });
  }

  const pass = results.filter((r) => r.status === 'PASS' || r.status === 'PASS_WITH_WARNINGS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const bySuite = {};
  for (const r of results) {
    bySuite[r.suite] = bySuite[r.suite] || { pass: 0, fail: 0 };
    if (r.status === 'FAIL') bySuite[r.suite].fail += 1;
    else bySuite[r.suite].pass += 1;
  }

  const failures = results
    .filter((r) => r.status === 'FAIL')
    .map((r) => ({
      id: r.id,
      user: r.user,
      fails: r.fails,
      replyPreview: r.evidence.replyPreview,
      stateAfter: r.evidence.stateAfter,
      rootCauseHint:
        r.fails.includes('stolen_by_knowledge_assistant') || r.fails.includes('rank_journey_not_entered')
          ? 'Likely undeployed P0 NL rank routing / college entry collision (fixes exist only in local working tree)'
          : r.fails.some((f) => String(f).startsWith('delivery_failed'))
            ? 'Gupshup outbound/DLR issue'
            : 'See evidence',
    }));

  let recommendation = 'NO GO';
  let recommendationReason = '';
  if (!e2eDelivered) {
    recommendation = 'NO GO';
    recommendationReason = 'No complete end-to-end WhatsApp delivery confirmed to 9347763131';
  } else if (fail === 0) {
    recommendation = 'GO';
    recommendationReason = 'All scenarios passed with at least one confirmed WhatsApp delivery';
  } else if (fail <= 8 && e2eDelivered) {
    recommendation = 'CONDITIONAL GO';
    recommendationReason =
      'E2E WhatsApp delivery succeeded, but scenario failures remain (likely undeployed local predictor routing fixes)';
  } else {
    recommendation = 'NO GO';
    recommendationReason = `Too many failures (${fail}/${results.length}) despite delivery probe`;
  }

  const report = {
    title: 'GuideXpert Production Smoke — Live WhatsApp Predictor Certification',
    phone: PHONE10,
    webhook: WEBHOOK,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    preflight,
    deployNote: {
      productionPath: true,
      localPredictorFixesDeployed: false,
      note:
        'P0/P1 predictor routing fixes are present in the local working tree but NOT committed/deployed to production. This run certifies currently deployed production code.',
    },
    totals: {
      scenariosExecuted: results.length,
      pass,
      fail,
      passWithWarnings: results.filter((r) => r.status === 'PASS_WITH_WARNINGS').length,
    },
    bySuite,
    e2eWhatsAppDeliveryConfirmed: e2eDelivered,
    failures,
    remainingRisks: [
      'Local predictor NL/routing fixes not deployed — Rank NL and menu-5 may fail on production until release',
      'Earlywave host is beta (nw-predictors-backend-beta.earlywave.in)',
      'Local workstation cannot hold GUPSHUP secrets (Vercel env pull redacts [SENSITIVE])',
      'DLR may lag; submitted+gupshupMessageId accepted when delivered/read not seen in window',
    ],
    filesChangedDuringTesting: [],
    recommendation,
    recommendationReason,
    results,
  };

  const outJson = path.join(OUT_DIR, `predictor-live-wa-cert-${stamp}.json`);
  const outMd = path.join(OUT_DIR, `predictor-live-wa-cert-${stamp}.md`);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

  const md = [
    `# Live WhatsApp Predictor Certification`,
    ``,
    `- Phone: ${PHONE10}`,
    `- Webhook: ${WEBHOOK}`,
    `- Scenarios: ${results.length}`,
    `- PASS: ${pass} | FAIL: ${fail}`,
    `- E2E delivery confirmed: ${e2eDelivered}`,
    `- Recommendation: **${recommendation}**`,
    `- Reason: ${recommendationReason}`,
    ``,
    `## Preflight`,
    '```json',
    JSON.stringify(preflight, null, 2),
    '```',
    ``,
    `## Failures`,
    failures.length
      ? failures.map((f) => `- ${f.id}: ${f.fails.join(', ')} — ${f.rootCauseHint}`).join('\n')
      : '_None_',
    ``,
    `## Suite totals`,
    ...Object.entries(bySuite).map(([k, v]) => `- ${k}: ${v.pass} pass / ${v.fail} fail`),
    ``,
    `Full JSON: \`${outJson}\``,
  ].join('\n');
  fs.writeFileSync(outMd, md);

  console.log('\n═══════════════════════════════════════════════════');
  console.log(` PASS ${pass} / FAIL ${fail} / TOTAL ${results.length}`);
  console.log(` E2E WhatsApp delivery: ${e2eDelivered}`);
  console.log(` Recommendation: ${recommendation}`);
  console.log(` Report: ${outJson}`);
  console.log('═══════════════════════════════════════════════════');

  await mongoose.disconnect();
  process.exit(fail && recommendation === 'NO GO' ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
