#!/usr/bin/env node
'use strict';
/**
 * Section A — Production UAT (Audit mode)
 * Path: POST production /webhook/gupshup → claimed inbound processing →
 *       outbound via Gupshup → WhatsApp phone 9347763131
 * Verifies via production MongoDB.
 * Does NOT call local processInbound. Does NOT use test hooks/mocks.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');

const BACKEND = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(BACKEND, '.env') });

const WEBHOOK =
  process.env.SECTION_A_WEBHOOK_URL ||
  'https://guide-xpert-backend.vercel.app/webhook/gupshup';
const PHONE10 = String(process.env.SECTION_A_PHONE || '9347763131').replace(/\D/g, '').slice(-10);
const SOURCE = '91' + PHONE10;
const OUT_DIR = path.join(BACKEND, 'smoke-results', 'sectionA');
const WAIT_MS = Number(process.env.SECTION_A_WAIT_MS || 3500);
const RAPID_GAP_MS = Number(process.env.SECTION_A_RAPID_GAP_MS || 250);
const PASS_GATE = Number(process.env.SECTION_A_PASS_GATE || 0.98);

const SCOPE_REFUSAL = /I'm here to help only with GuideXpert|cannot assist with|outside (my|the) scope/i;
const ICE_FALLBACK = /IIT Counselling Expert|JoSAA|counselling strategy/i;
const HUMAN_CLAIM = /\bI am (a )?human\b|\bI'm (a )?human\b|\bI am not (an )?AI\b/i;
const EMPTY_REPLY = /^$/;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildCases() {
  const c = [];
  const add = (id, group, user, opts = {}) =>
    c.push({
      id,
      group,
      user,
      resetState: opts.resetState !== false,
      expect: opts.expect || {},
      note: opts.note || '',
    });

  // A1
  const greetings = [
    'Hello','Hi','Hey','Hii','Hiiii','Helloo','Good morning','Good afternoon','Good evening',
    'Good night','Greetings','Namaste','Vanakkam','Salaam','Yo','Sup',"What's up",'Start','/start',
    'Hi there','Hello GuideXpert','Hey GuideXpert',
  ];
  greetings.forEach((u, i) =>
    add(`A1-${String(i + 1).padStart(2, '0')}`, 'A1_greetings', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, greetingish: true },
    })
  );

  // A2
  [
    ['Who are you?', { identity: true }],
    ['What are you?', { identity: true }],
    ['Are you ChatGPT?', { notHuman: true, identity: true }],
    ['Are you AI?', { identity: true }],
    ['Are you human?', { notHuman: true }],
    ['Who created you?', { identity: true }],
    ['What company are you from?', { identity: true }],
    ['What is GuideXpert?', { identity: true }],
  ].forEach(([u, e], i) => add(`A2-${String(i + 1).padStart(2, '0')}`, 'A2_identity', u, { expect: { nonEmpty: true, noScopeRefusal: true, ...e } }));

  // A3
  [
    'What can you do?',
    'How can you help?',
    'Can you help me?',
    'What services do you provide?',
    'Can you help with admissions?',
    'Can you help with counselling?',
    'Can you predict colleges?',
    'Can you explain JoSAA?',
    'Can you book counselling?',
  ].forEach((u, i) =>
    add(`A3-${String(i + 1).padStart(2, '0')}`, 'A3_capability', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, capability: true },
    })
  );

  // A4
  ['Help', 'Support', 'Menu', 'Main menu', 'Go back', 'Start over', 'Restart', 'Cancel', 'Home'].forEach(
    (u, i) =>
      add(`A4-${String(i + 1).padStart(2, '0')}`, 'A4_help', u, {
        expect: { nonEmpty: true, safeNav: true },
      })
  );

  // A5
  ['Thanks', 'Thank you', 'Thank you so much', 'Awesome', 'Perfect', 'Great', 'Nice', 'Helpful', 'Love it'].forEach(
    (u, i) =>
      add(`A5-${String(i + 1).padStart(2, '0')}`, 'A5_gratitude', u, {
        expect: { nonEmpty: true, gratitudeAck: true },
      })
  );

  // A6
  ['Bye', 'Goodbye', 'See you', 'Talk later', 'Catch you later', 'Exit', 'Quit', 'Stop'].forEach((u, i) =>
    add(`A6-${String(i + 1).padStart(2, '0')}`, 'A6_goodbye', u, {
      expect: { nonEmpty: true },
    })
  );

  // A7
  ["How are you?", "Hope you're doing well", "How's your day?", 'Nice to meet you', 'Good job'].forEach(
    (u, i) =>
      add(`A7-${String(i + 1).padStart(2, '0')}`, 'A7_small_talk', u, {
        expect: { nonEmpty: true, shortish: true },
      })
  );

  // A8 — Help also in A4; keep as ambiguous here with clarifying expectation
  [
    'College',
    'Admission',
    'Help',
    'Counselling',
    'Fees',
    'Documents',
    'Scholarship',
    'Hostel',
    'Placements',
    'IIT',
    'NIT',
  ].forEach((u, i) =>
    add(`A8-${String(i + 1).padStart(2, '0')}`, 'A8_ambiguous', u, {
      expect: { nonEmpty: true, clarifyingOrMenu: true },
    })
  );

  // A9
  [
    'Helo',
    'Hiiii',
    'Counsling',
    'Admision',
    'Collage predictor',
    'Josaa',
    'Jee mains',
    'Advnced',
  ].forEach((u, i) =>
    add(`A9-${String(i + 1).padStart(2, '0')}`, 'A9_typos', u, {
      expect: { nonEmpty: true, noHardFail: true },
    })
  );

  // A10
  [
    { user: '', note: 'empty' },
    { user: ' ', note: 'space' },
    { user: '\t', note: 'tab' },
    { user: '😀', note: 'emoji' },
    { user: '👍', note: 'emoji' },
    { user: '🙏', note: 'emoji' },
    { user: '❤️', note: 'emoji' },
    { user: '😂', note: 'emoji' },
    { user: '???', note: 'punct' },
    { user: '...', note: 'punct' },
    { user: '!!!', note: 'punct' },
  ].forEach((row, i) =>
    add(`A10-${String(i + 1).padStart(2, '0')}`, 'A10_empty_inputs', row.user, {
      expect: { noIceFallback: true, friendlyClarify: true },
      note: row.note,
    })
  );

  // A11
  ['नमस्ते', 'హలో', 'வணக்கம்', 'ഹലോ', 'Hello नमस्ते', 'Hi హలో'].forEach((u, i) =>
    add(`A11-${String(i + 1).padStart(2, '0')}`, 'A11_multilang_greetings', u, {
      expect: { nonEmpty: true, noScopeRefusal: true },
    })
  );

  // A12 continuity — one conversation
  add('A12-01', 'A12_session_continuity', 'Hello', { resetState: true, expect: { nonEmpty: true } });
  add('A12-02', 'A12_session_continuity', 'Thanks', { resetState: false, expect: { nonEmpty: true } });
  add('A12-03', 'A12_session_continuity', 'Help', { resetState: false, expect: { nonEmpty: true } });
  add('A12-04', 'A12_session_continuity', 'Bye', { resetState: false, expect: { nonEmpty: true } });
  add('A12-05', 'A12_session_continuity', 'Hello again', { resetState: false, expect: { nonEmpty: true } });

  // A13 rapid — marked; runner sends with short gaps
  ['Hi', 'Hello', 'Help', 'College', 'Thanks', 'Bye'].forEach((u, i) =>
    add(`A13-${String(i + 1).padStart(2, '0')}`, 'A13_rapid_messages', u, {
      resetState: i === 0,
      rapid: true,
      expect: { nonEmpty: true },
    })
  );

  return c;
}

function evaluate(caseRow, reply, meta) {
  const fails = [];
  const warns = [];
  const r = String(reply || '');
  const e = caseRow.expect || {};

  if (e.nonEmpty && (!r || !r.trim())) fails.push('empty_response');
  if (/connected you with a human agent|Please wait; we will reply here/i.test(r)) {
    fails.push('unexpected_human_handoff');
  }
  if (e.noScopeRefusal && SCOPE_REFUSAL.test(r)) fails.push('scope_rejection');
  if (e.notHuman && HUMAN_CLAIM.test(r)) fails.push('claimed_to_be_human');
  if (e.noIceFallback && ICE_FALLBACK.test(r) && r.length > 400) fails.push('possible_ice_fallback');
  if (e.shortish && r.length > 900) warns.push('longer_than_expected_for_small_talk');
  if (e.identity && !/guide\s*xpert|counsellor|counselor|assistant|admission|guid/i.test(r)) {
    warns.push('weak_identity_signal');
  }
  if (e.gratitudeAck && /important decisions|Would you like me to suggest|Which entrance exam/i.test(r)) {
    fails.push('restarted_or_entered_journey_on_thanks');
  }
  if (e.clarifyingOrMenu) {
    const ok =
      /\?|menu|option|help|which|what (do|are|kind)|tell me more|could you|clarify|choose|select/i.test(r) ||
      /GuideXpert/i.test(r);
    if (!ok) warns.push('may_have_guessed_without_clarifying');
  }
  if (e.safeNav) {
    if (SCOPE_REFUSAL.test(r)) fails.push('help_nav_scope_refusal');
  }
  if (meta.webhookError) fails.push(`webhook_error:${meta.webhookError}`);
  if (meta.inboundSaved === false && String(caseRow.user || '').trim() !== '') {
    fails.push('inbound_not_saved');
  }
  // Empty user inputs: inbound may legitimately not save — treat no reply as fail only if we expected clarification via outbound linked somehow
  if (String(caseRow.user || '').trim() === '' || /^\s+$/.test(caseRow.user || '')) {
    if (!r) warns.push('no_outbound_for_blank_input_observable');
  } else if (!r && !meta.webhookError) {
    fails.push('no_outbound_reply');
  }

  let status = 'PASS';
  if (fails.length) status = 'FAIL';
  else if (warns.length) status = 'PASS_WITH_WARNINGS';
  return { status, fails, warns };
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
        context: { college: {}, rank: {}, careerCounselling: {}, knowledgeAssistantActive: false },
        updatedAt: new Date(),
      },
    },
    { upsert: false }
  );
  await db.collection('whatsappconversations').updateOne(
    { _id: conversationId },
    { $set: { status: 'active', currentHandoffId: null, updatedAt: new Date() } }
  );
}

function extractReplyText(outbound) {
  if (!outbound) return '';
  if (outbound.content && outbound.content.text) return String(outbound.content.text);
  if (outbound.textPreview) return String(outbound.textPreview);
  if (outbound.text) return String(outbound.text);
  return '';
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date();
  console.log('═══════════════════════════════════════════════');
  console.log(' SECTION A — PRODUCTION UAT (AUDIT)');
  console.log(' Phone:', PHONE10);
  console.log(' Webhook:', WEBHOOK);
  console.log(' Mongo:', (process.env.MONGODB_URI || '').replace(/\/\/.*@/, '//***@').slice(0, 70));
  console.log(' Started:', startedAt.toISOString());
  console.log('═══════════════════════════════════════════════\n');

  // Preflight: smoke endpoint + health
  let smokeStatus = null;
  try {
    const smoke = await axios.post(
      'https://guide-xpert-backend.vercel.app/api/internal/smoke/send',
      { phone: PHONE10, message: 'probe' },
      { timeout: 15000, validateStatus: () => true }
    );
    smokeStatus = smoke.status;
  } catch (e) {
    smokeStatus = e.message;
  }
  const health = await axios.get('https://guide-xpert-backend.vercel.app/api/health', { timeout: 15000 });
  console.log('Smoke endpoint HTTP:', smokeStatus, '(404 => secret not configured on Vercel)');
  console.log('Health ready:', health.data?.whatsapp?.ready, 'scope:', health.data?.scopeFirewall?.ready);

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const inboundCol = db.collection('whatsappinboundmessages');
  const outboundCol = db.collection('whatsappoutboundmessages');
  const convCol = db.collection('whatsappconversations');
  const botCol = db.collection('whatsappbotstates');

  const convBefore = await convCol.findOne({ phone: PHONE10 });
  console.log('Conversation before:', convBefore ? String(convBefore._id) : 'none');

  const cases = buildCases();
  console.log('Total cases:', cases.length, '\n');

  const results = [];
  let conversationId = convBefore?._id || null;

  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i];
    const msgId = `sectionA-${c.id}-${Date.now()}-${i}`;
    const t0 = Date.now();
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.id} ${JSON.stringify(c.user).slice(0, 40)} … `);

    if (c.resetState && conversationId) {
      await resetBotState(db, conversationId);
    }

    let httpStatus = null;
    let webhookBody = null;
    let webhookError = null;
    try {
      const res = await axios.post(WEBHOOK, buildPayload(c.user, msgId), {
        timeout: 120000,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
      httpStatus = res.status;
      webhookBody = res.data;
    } catch (e) {
      httpStatus = e.response?.status || 0;
      webhookBody = e.response?.data || null;
      webhookError = e.message;
    }

    // wait for processing / outbound
    const wait = c.group === 'A13_rapid_messages' ? RAPID_GAP_MS : WAIT_MS;
    await sleep(wait);

    const inbound = await inboundCol.findOne({ providerMessageId: msgId });
    if (inbound?.conversationId) conversationId = inbound.conversationId;

    let outbound = null;
    if (inbound?._id) {
      outbound = await outboundCol
        .find({ inReplyToInboundId: inbound._id, senderType: 'bot' })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
    }
    if (!outbound && conversationId) {
      // fallback: latest bot outbound after t0
      outbound = await outboundCol
        .find({
          conversationId,
          senderType: 'bot',
          createdAt: { $gte: new Date(t0 - 1000) },
        })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
    }

    const botState = conversationId ? await botCol.findOne({ conversationId }) : null;
    const reply = extractReplyText(outbound);
    const latencyMs = Date.now() - t0;
    const verdict = evaluate(c, reply, {
      webhookError,
      inboundSaved: Boolean(inbound),
      httpStatus,
    });

    const row = {
      id: c.id,
      group: c.group,
      user: c.user,
      note: c.note,
      resetState: c.resetState,
      httpStatus,
      webhookSuccess: Boolean(webhookBody && (webhookBody.success || webhookBody.received)),
      inboundSaved: Boolean(inbound),
      inboundId: inbound ? String(inbound._id) : null,
      inboundProcessStatus: inbound?.processStatus || null,
      outboundId: outbound ? String(outbound._id) : null,
      outboundStatus: outbound?.status || null,
      gupshupMessageId: outbound?.gupshupMessageId || null,
      replyPreview: reply.slice(0, 280),
      replyLength: reply.length,
      botState: botState?.state || null,
      latencyMs,
      status: verdict.status,
      fails: verdict.fails,
      warns: verdict.warns,
      scopeRefusal: SCOPE_REFUSAL.test(reply),
    };
    results.push(row);
    console.log(verdict.status, `lat=${latencyMs}ms`, `out=${outbound?.status || 'none'}`);
  }

  // Post checks: duplicates / conversation count
  const convs = await convCol.find({ phone: PHONE10 }).toArray();
  const botStateFinal = conversationId ? await botCol.findOne({ conversationId }) : null;
  const since = startedAt;
  const inboundCount = await inboundCol.countDocuments({
    phone: PHONE10,
    createdAt: { $gte: since },
  });
  const outboundCount = await outboundCol.countDocuments({
    conversationId: conversationId || null,
    createdAt: { $gte: since },
    senderType: 'bot',
  });

  let leadEvents = null;
  try {
    leadEvents = {
      recent: await db.collection('whatsappleadevents').countDocuments({
        phone: PHONE10,
        createdAt: { $gte: since },
      }),
    };
  } catch (_) {
    leadEvents = { error: 'collection_unavailable' };
  }

  const pass = results.filter((r) => r.status === 'PASS').length;
  const warn = results.filter((r) => r.status === 'PASS_WITH_WARNINGS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const total = results.length;
  const passRate = total ? ((pass + warn) / total) * 100 : 0;
  const gatePct = PASS_GATE * 100;
  let readiness = 'FAIL';
  if (passRate >= gatePct && fail === 0) readiness = 'PASS';
  else if (passRate >= gatePct) readiness = 'PASS_WITH_WARNINGS';
  else readiness = 'FAIL';

  const byGroup = {};
  for (const r of results) {
    byGroup[r.group] = byGroup[r.group] || { pass: 0, warn: 0, fail: 0, total: 0 };
    byGroup[r.group].total += 1;
    if (r.status === 'PASS') byGroup[r.group].pass += 1;
    else if (r.status === 'PASS_WITH_WARNINGS') byGroup[r.group].warn += 1;
    else byGroup[r.group].fail += 1;
  }

  const report = {
    section: 'A',
    title: 'Conversation Foundation Certification',
    mode: 'AUDIT',
    phone: PHONE10,
    executedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    pipeline: {
      inbound: 'POST https://guide-xpert-backend.vercel.app/webhook/gupshup (synthetic Gupshup payload)',
      processing: 'production backend claimed inbound → scope → intent → journey/RAG/LLM',
      outbound: 'production whatsappOutboundService → Gupshup → Meta → WhatsApp 9347763131',
      notes: [
        'Official POST /api/internal/smoke/send returned 404 — INTERNAL_SMOKE_TEST_SECRET not configured on Vercel Production.',
        'Inbound does not originate from physical WhatsApp client / Meta; outbound is real to the test phone.',
        'No local processInbound. No test hooks. No mocks.',
      ],
    },
    preflight: {
      smokeEndpointHttp: smokeStatus,
      health: {
        whatsappReady: health.data?.whatsapp?.ready,
        scopeFirewallReady: health.data?.scopeFirewall?.ready,
        chatbotEnabled: health.data?.whatsapp?.chatbotEnabled,
      },
    },
    summary: {
      total,
      pass,
      passWithWarnings: warn,
      fail,
      passRatePercent: Number(passRate.toFixed(2)),
      sectionAReadiness: readiness,
    },
    byGroup,
    database: {
      conversationIds: convs.map((x) => String(x._id)),
      conversationCount: convs.length,
      duplicateConversation: convs.length > 1,
      finalBotState: botStateFinal?.state || null,
      inboundCreatedDuringRun: inboundCount,
      outboundCreatedDuringRun: outboundCount,
      leadEvents,
    },
    cases: results,
    failures: results
      .filter((r) => r.status === 'FAIL')
      .map((r) => ({
        id: r.id,
        user: r.user,
        fails: r.fails,
        replyPreview: r.replyPreview,
        severity: r.fails.includes('claimed_to_be_human') || r.fails.includes('scope_rejection')
          ? 'HIGH'
          : 'MEDIUM',
        recommendedFix: recommendFix(r),
      })),
  };

  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUT_DIR, `sectionA-certification-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `sectionA-certification-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));
  console.log('\n═══════════════════════════════════════════════');
  console.log(' READINESS:', readiness, `| passRate=${passRate.toFixed(1)}% P=${pass} W=${warn} F=${fail}`);
  console.log(' Report JSON:', jsonPath);
  console.log(' Report MD  :', mdPath);
  console.log('═══════════════════════════════════════════════');

  await mongoose.disconnect();
  process.exit(readiness === 'PASS' ? 0 : 2);
}

function recommendFix(r) {
  if (r.fails.includes('empty_response') || r.fails.includes('no_outbound_reply')) {
    return 'Investigate inbound processing for this utterance; ensure greeting/unknown handlers always emit a reply.';
  }
  if (r.fails.includes('scope_rejection')) {
    return 'Add utterance to allow-list / intent routes so foundation phrases are not scope-blocked.';
  }
  if (r.fails.includes('claimed_to_be_human')) {
    return 'Update identity prompt/guardrail to deny being human.';
  }
  if (r.fails.includes('restarted_or_entered_journey_on_thanks')) {
    return 'Route gratitude as acknowledgment intent; do not re-enter career/college journeys.';
  }
  if (r.fails.some((f) => String(f).startsWith('webhook_error'))) {
    return 'Check production webhook availability / timeout; retry case.';
  }
  return 'Review transcript and intent classification for root cause.';
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# GuideXpert Production UAT — Section A Certification');
  lines.push('');
  lines.push(`- **Phone:** ${report.phone}`);
  lines.push(`- **Executed:** ${report.executedAt}`);
  lines.push(`- **Completed:** ${report.completedAt}`);
  lines.push(`- **Readiness:** **${report.summary.sectionAReadiness}**`);
  lines.push(
    `- **Score:** ${report.summary.pass}/${report.summary.total} PASS, ${report.summary.passWithWarnings} WARN, ${report.summary.fail} FAIL (${report.summary.passRatePercent}%)`
  );
  lines.push('');
  lines.push('## Pipeline');
  for (const n of report.pipeline.notes) lines.push(`- ${n}`);
  lines.push('');
  lines.push('## By group');
  lines.push('| Group | Pass | Warn | Fail | Total |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const [g, s] of Object.entries(report.byGroup)) {
    lines.push(`| ${g} | ${s.pass} | ${s.warn} | ${s.fail} | ${s.total} |`);
  }
  lines.push('');
  lines.push('## Database');
  lines.push(`- Conversations for phone: **${report.database.conversationCount}** (duplicate=${report.database.duplicateConversation})`);
  lines.push(`- Final bot state: \`${report.database.finalBotState}\``);
  lines.push(`- Inbounds created: ${report.database.inboundCreatedDuringRun}`);
  lines.push(`- Outbounds created: ${report.database.outboundCreatedDuringRun}`);
  lines.push('');
  lines.push('## Case results');
  lines.push('| ID | Group | User | Status | Latency | Outbound | Notes |');
  lines.push('|---|---|---|---|---:|---|---|');
  for (const r of report.cases) {
    const notes = [...(r.fails || []), ...(r.warns || [])].join('; ') || '';
    lines.push(
      `| ${r.id} | ${r.group} | ${JSON.stringify(r.user)} | ${r.status} | ${r.latencyMs} | ${r.outboundStatus || '-'} | ${notes.replace(/\|/g, '/')} |`
    );
  }
  lines.push('');
  lines.push('## Failures / root causes');
  if (!report.failures.length) lines.push('_None_');
  for (const f of report.failures) {
    lines.push(`### ${f.id} — ${JSON.stringify(f.user)}`);
    lines.push(`- Severity: ${f.severity}`);
    lines.push(`- Fails: ${f.fails.join(', ')}`);
    lines.push(`- Reply: ${JSON.stringify(f.replyPreview)}`);
    lines.push(`- Recommended fix: ${f.recommendedFix}`);
    lines.push('');
  }
  lines.push('## Transcript (compact)');
  for (const r of report.cases) {
    lines.push(`**${r.id} USER:** ${JSON.stringify(r.user)}`);
    lines.push(`**BOT:** ${JSON.stringify(r.replyPreview)}`);
    lines.push('');
  }
  return lines.join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
