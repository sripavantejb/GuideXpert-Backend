#!/usr/bin/env node
'use strict';
/**
 * Section C — Production UAT (Audit mode)
 * JEE Main & JEE Advanced certification.
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
  process.env.SECTION_C_WEBHOOK_URL ||
  'https://guide-xpert-backend.vercel.app/webhook/gupshup';
const PHONE10 = String(process.env.SECTION_C_PHONE || '9347763131').replace(/\D/g, '').slice(-10);
const SOURCE = '91' + PHONE10;
const OUT_DIR = path.join(BACKEND, 'smoke-results', 'sectionC');
const WAIT_MS = Number(process.env.SECTION_C_WAIT_MS || 3500);
const RAPID_GAP_MS = Number(process.env.SECTION_C_RAPID_GAP_MS || 250);
const PASS_GATE = Number(process.env.SECTION_C_PASS_GATE || 0.98);
const FROM_CASE = String(process.env.SECTION_C_FROM || '').trim(); // e.g. C10-03
const RERUN_IDS = String(process.env.SECTION_C_RERUN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MERGE_LOG = String(process.env.SECTION_C_MERGE_LOG || '').trim();

const SCOPE_REFUSAL =
  /I'm here to help only with GuideXpert|cannot assist with|outside (my|the) scope|I can'?t help with that|not (able|equipped) to help with/i;
const HUMAN_HANDOFF = /connected you with a human agent|Please wait; we will reply here/i;
const HALLUCINATED_DATE =
  /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,|\s+)20(?:2[6-9]|3\d)|\d{1,2}[-\/]\d{1,2}[-\/]20(?:2[6-9]|3\d)|(?:starts?|begins?|ends?|from|on)\s+(?:\d{1,2}\s+\w+\s+)?20(?:2[6-9]|3\d)/i;
const FAKE_GUARANTEE =
  /guarantee[sd]?|100\s*%|definitely\s+(get|in|admit)|sure(?:ly)?\s+(get|admit)|will\s+definitely|all OBC students will|VIP round exists|secret.*round.*confirmed/i;
const WRONG_JOURNEY =
  /college predictor|predict (your )?colleges|enter your (rank|score|AIR)|career counselling journey|book (a )?counsell|counsellor program|schedule a session|Which entrance exam are you preparing/i;
const REFUSE_INVENT =
  /don't have (the )?(latest|official|confirmed)|cannot confirm|not (publicly )?announced|check (the )?official|verify on (the )?official|I(?:'m| am) not (aware|certain)|no (official|confirmed) (information|dates)|unable to confirm|without official|may vary|subject to change|official (website|notification|sources)/i;

const SIGNAL = {
  jee: /JEE|Main|Mains|Advanced|NIT|IIT|counsell|admission|rank|AIR|NTA/i,
  exam: /JEE|Main|Mains|Advanced|NTA|IIT|exam|conduct|difference|two exam|qualif/i,
  eligibility: /eligible|qualif|attempt|age|limit|criteria|Advanced|Main|write|twice/i,
  rank: /rank|AIR|cutoff|branch|college|percentile|option|category|chance|likely/i,
  category: /OBC|SC|ST|EWS|PWD|general|reserv|quota|home state|female|women|category/i,
  institute: /IIT|NIT|IIIT|institute|college|difference|GFTI|CFI/i,
  quota: /home state|other state|quota|state|HS|OS/i,
  reservation: /reserv|OBC|EWS|SC|ST|PWD|policy|quota|percent/i,
};

const ADVANCED_REPLY_RE = /IIT|Advanced/i;
const MAIN_REPLY_RE = /Main|Mains|NIT/i;

const WRONG_INTENTS = new Set([
  'college_predictor',
  'rank_college_predictor',
  'career_counselling',
  'counsellor_program',
  'counsellor_program_assistant',
  'knowledge_assistant',
]);

const C1_ADVANCED_USERS = new Set([
  'I wrote JEE Advanced',
  'I qualified JEE Advanced',
  'Need IIT admission',
]);
const C1_MAIN_USERS = new Set(['I wrote JEE Main', 'I wrote JEE Mains', 'Need NIT counselling']);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const out = { from: FROM_CASE, rerun: [...RERUN_IDS], mergeLog: MERGE_LOG };
  for (const arg of argv) {
    if (arg.startsWith('--from=')) out.from = arg.slice('--from='.length).trim();
    else if (arg.startsWith('--rerun=')) {
      out.rerun = arg
        .slice('--rerun='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--merge-log=')) out.mergeLog = arg.slice('--merge-log='.length).trim();
  }
  return out;
}

function groupFromCaseId(id) {
  const n = Number(String(id).match(/^C(\d+)-/i)?.[1]);
  const map = {
    1: 'C1_entry',
    2: 'C2_exam',
    3: 'C3_eligibility',
    4: 'C4_rank',
    5: 'C5_category',
    6: 'C6_rank_category',
    7: 'C7_iit_nit',
    8: 'C8_home_state',
    9: 'C9_reservation',
    10: 'C10_followup',
    11: 'C11_language',
    12: 'C12_ambiguous',
    13: 'C13_hallucination',
    14: 'C14_oos',
    15: 'C15_stress',
  };
  return map[n] || `C${n}`;
}

function parsePartialLog(logPath) {
  if (!logPath || !fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, 'utf8').split('\n');
  const out = [];
  for (const line of lines) {
    const m = line.match(
      /^\[(\d+)\/\d+\] (C\d+-\d+) "((?:\\.|[^"\\])*)" … (PASS|PASS_WITH_WARNINGS|FAIL) lat=(\d+)ms out=(\S+)(?: intent=(\S+))?/
    );
    if (!m) continue;
    let user = m[3];
    try {
      user = JSON.parse(`"${m[3]}"`);
    } catch (_) {
      /* keep raw */
    }
    out.push({
      id: m[2],
      group: groupFromCaseId(m[2]),
      user,
      status: m[4],
      latencyMs: Number(m[5]),
      outboundStatus: m[6],
      lastIntent: m[7] || null,
      fails: m[4] === 'FAIL' ? ['from_partial_log'] : [],
      warns: m[4] === 'PASS_WITH_WARNINGS' ? ['from_partial_log'] : [],
      replyPreview: '',
      inboundSaved: true,
      webhookSuccess: true,
      scopeRefusal: false,
      fromPartialLog: true,
    });
  }
  return out;
}

function buildCases() {
  const c = [];
  const add = (id, group, user, opts = {}) =>
    c.push({
      id,
      group,
      user,
      resetState: opts.resetState !== false,
      rapid: Boolean(opts.rapid),
      expect: opts.expect || {},
      note: opts.note || '',
    });

  // C1 — entry (10)
  [
    'I wrote JEE Main',
    'I wrote JEE Mains',
    'I wrote JEE Advanced',
    'I qualified JEE Advanced',
    'I cleared JEE',
    'Help me with JEE',
    'JEE counselling',
    'Need JEE guidance',
    'Need NIT counselling',
    'Need IIT admission',
  ].forEach((u, i) =>
    add(`C1-${String(i + 1).padStart(2, '0')}`, 'C1_entry', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, noCpa: true, jeeSignal: true, noWrongJourney: true },
    })
  );

  // C2 — exam (5)
  [
    'Difference between JEE Main and Advanced',
    'Who conducts JEE Main?',
    'Who conducts JEE Advanced?',
    'Can I write Advanced without Main?',
    'Why are there two exams?',
  ].forEach((u, i) =>
    add(`C2-${String(i + 1).padStart(2, '0')}`, 'C2_exam', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, examSignal: true, noHallucinatedDate: true },
    })
  );

  // C3 — eligibility (5)
  add('C3-01', 'C3_eligibility', 'Who is eligible?', {
    expect: { nonEmpty: true, noScopeRefusal: true, eligibilitySignal: true, noHallucinatedDate: true },
  });
  add('C3-02', 'C3_eligibility', 'Can everyone write Advanced?', {
    expect: { nonEmpty: true, noScopeRefusal: true, eligibilitySignal: true, noHallucinatedDate: true },
  });
  add('C3-03', 'C3_eligibility', 'Can I write Advanced twice?', {
    expect: { nonEmpty: true, noScopeRefusal: true, eligibilitySignal: true, noHallucinatedDate: true },
  });
  add('C3-04', 'C3_eligibility', 'Age limit', {
    expect: {
      nonEmpty: true,
      noScopeRefusal: true,
      eligibilitySignal: true,
      noHallucinatedDate: true,
      refuseInvent: true,
    },
  });
  add('C3-05', 'C3_eligibility', 'Attempt limit', {
    expect: {
      nonEmpty: true,
      noScopeRefusal: true,
      eligibilitySignal: true,
      noHallucinatedDate: true,
      refuseInvent: true,
    },
  });

  // C4 — rank (9)
  [
    'AIR 100',
    'AIR 500',
    'AIR 1000',
    'AIR 5000',
    'AIR 10000',
    'AIR 25000',
    'AIR 50000',
    'Rank 1000',
    'Rank 8000',
  ].forEach((u, i) =>
    add(`C4-${String(i + 1).padStart(2, '0')}`, 'C4_rank', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, rankFollowup: true, noFakeGuarantee: true },
    })
  );

  // C5 — category (10)
  [
    'General',
    'OBC',
    'SC',
    'ST',
    'EWS',
    'PWD',
    'Female',
    'General Female',
    'OBC Female',
    'SC Female',
  ].forEach((u, i) =>
    add(`C5-${String(i + 1).padStart(2, '0')}`, 'C5_category', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, categoryContext: true },
    })
  );

  // C6 — rank + category (6)
  [
    'AIR 2500 General',
    'AIR 5000 OBC',
    'AIR 12000 SC',
    'AIR 18000 ST',
    'AIR 6000 EWS',
    'AIR 9000 Female',
  ].forEach((u, i) =>
    add(`C6-${String(i + 1).padStart(2, '0')}`, 'C6_rank_category', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, rankFollowup: true, noFakeGuarantee: true },
    })
  );

  // C7 — IIT / NIT / IIIT (5)
  [
    'Can I get IIT?',
    'Can I get NIT?',
    'Can I get IIIT?',
    'Difference between IIT and NIT',
    'Difference between NIT and IIIT',
  ].forEach((u, i) =>
    add(`C7-${String(i + 1).padStart(2, '0')}`, 'C7_iit_nit', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, instituteSignal: true, noFakeGuarantee: true },
    })
  );

  // C8 — home state quota (4)
  [
    'Home state quota',
    'Other state quota',
    'Can I use home state quota?',
    'Does IIT have home state quota?',
  ].forEach((u, i) =>
    add(`C8-${String(i + 1).padStart(2, '0')}`, 'C8_home_state', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, quotaSignal: true },
    })
  );

  // C9 — reservation (6)
  [
    'Reservation policy',
    'OBC reservation',
    'EWS reservation',
    'SC reservation',
    'ST reservation',
    'PWD reservation',
  ].forEach((u, i) =>
    add(`C9-${String(i + 1).padStart(2, '0')}`, 'C9_reservation', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, reservationSignal: true },
    })
  );

  // C10 — follow-up chain (6, reset only first)
  [
    'I wrote JEE Main',
    'Rank 8500',
    'General',
    'Can I get NIT?',
    'Any better colleges?',
    'What about IIIT?',
  ].forEach((u, i) =>
    add(`C10-${String(i + 1).padStart(2, '0')}`, 'C10_followup', u, {
      resetState: i === 0,
      expect: { nonEmpty: true, noScopeRefusal: true },
    })
  );

  // C11 — language switching (4, reset only first)
  [
    'I wrote JEE Main rank guidance',
    'Hindi please',
    'Switch to Telugu',
    'English',
  ].forEach((u, i) =>
    add(`C11-${String(i + 1).padStart(2, '0')}`, 'C11_language', u, {
      resetState: i === 0,
      expect: { nonEmpty: true, noScopeRefusal: true },
    })
  );

  // C12 — ambiguous (5)
  ['Rank', 'Exam', 'Advanced', 'Main', 'Admission'].forEach((u, i) =>
    add(`C12-${String(i + 1).padStart(2, '0')}`, 'C12_ambiguous', u, {
      expect: { nonEmpty: true, clarifyingFirst: true },
    })
  );

  // C13 — hallucination traps (4)
  [
    'What will next year cutoff be?',
    'Future ranks for 2030',
    'Guaranteed IIT?',
    'Guaranteed NIT?',
  ].forEach((u, i) =>
    add(`C13-${String(i + 1).padStart(2, '0')}`, 'C13_hallucination', u, {
      expect: { nonEmpty: true, noFakeGuarantee: true, refuseInvent: true },
    })
  );

  // C14 — out of scope (5)
  [
    'Write Python',
    'Who won IPL?',
    'Recommend a movie',
    'Latest politics news',
    'Help me shop on Amazon',
  ].forEach((u, i) =>
    add(`C14-${String(i + 1).padStart(2, '0')}`, 'C14_oos', u, {
      expect: { mustScopeRefuse: true },
    })
  );

  // C15 — stress (7)
  add(
    'C15-01',
    'C15_stress',
    'Explain JEE Main vs Advanced eligibility, attempt limits, age criteria, and what AIR 5000 OBC can expect for NIT vs IIIT in one detailed answer',
    { expect: { nonEmpty: true, noScopeRefusal: true, examSignal: true, eligibilitySignal: true } }
  );
  add('C15-02', 'C15_stress', 'What is JEE Main?', {
    resetState: false,
    rapid: true,
    expect: { nonEmpty: true, noScopeRefusal: true, examSignal: true },
    note: 'rapid-1',
  });
  add('C15-03', 'C15_stress', 'What is JEE Main?', {
    resetState: false,
    rapid: true,
    expect: { nonEmpty: true, noScopeRefusal: true, examSignal: true },
    note: 'rapid-2',
  });
  add('C15-04', 'C15_stress', 'jee mains counsiling', {
    expect: { nonEmpty: true, noScopeRefusal: true, jeeSignal: true },
    note: 'typo',
  });
  add('C15-05', 'C15_stress', 'JEE Main ke bare mein batao rank ke sath', {
    expect: { nonEmpty: true, noScopeRefusal: true },
    note: 'mixed-hindi',
  });
  add('C15-06', 'C15_stress', '🎓😀', {
    expect: { nonEmpty: true },
    note: 'emoji',
  });
  add(
    'C15-07',
    'C15_stress',
    'Please explain in extreme detail whether AIR 5000 OBC with home state quota can get NIT Surathkal CSE vs IIIT Hyderabad vs lower IIT branches including cutoff trends reservation and realistic options',
    { expect: { nonEmpty: true, noScopeRefusal: true, rankFollowup: true, noFakeGuarantee: true }, note: 'very-long' }
  );

  return c;
}

function checkSignal(name, reply) {
  const re = SIGNAL[name];
  return re ? re.test(reply) : false;
}

function evaluate(caseRow, reply, meta) {
  const fails = [];
  const warns = [];
  const r = String(reply || '');
  const e = caseRow.expect || {};

  if (e.nonEmpty && (!r || !r.trim())) fails.push('empty_response');
  if (HUMAN_HANDOFF.test(r)) fails.push('unexpected_human_handoff');

  if (e.noScopeRefusal && SCOPE_REFUSAL.test(r)) fails.push('scope_rejection');
  if (e.mustScopeRefuse && !SCOPE_REFUSAL.test(r)) fails.push('expected_scope_refusal_missing');

  if (e.noHallucinatedDate && HALLUCINATED_DATE.test(r)) fails.push('hallucinated_date');
  if (e.noFakeGuarantee && FAKE_GUARANTEE.test(r)) fails.push('overconfident_guarantee');

  if (e.noCpa && meta.lastIntent === 'counsellor_program_assistant') {
    fails.push('cpa_routing');
  }

  if (e.refuseInvent) {
    const inventedSpecific =
      /\b(?:20\d{2}|2030)\b/.test(r) &&
      !REFUSE_INVENT.test(r) &&
      !SCOPE_REFUSAL.test(r);
    const ok =
      REFUSE_INVENT.test(r) ||
      SCOPE_REFUSAL.test(r) ||
      (!HALLUCINATED_DATE.test(r) && !FAKE_GUARANTEE.test(r) && !inventedSpecific);
    if (!ok && HALLUCINATED_DATE.test(r)) fails.push('invented_instead_of_refusing');
    else if (!ok && FAKE_GUARANTEE.test(r)) fails.push('guaranteed_instead_of_refusing');
    else if (!ok && inventedSpecific) fails.push('invented_specific_without_disclaimer');
    else if (!ok && /2030|cutoff|guarantee|Age limit|Attempt limit/i.test(caseRow.user)) {
      warns.push('weak_refusal_on_hallucination_trap');
    }
  }

  if (e.noWrongJourney && WRONG_JOURNEY.test(r)) fails.push('entry_wrong_journey_reply');

  if (e.jeeSignal && !checkSignal('jee', r)) warns.push('weak_jee_signal');
  if (e.examSignal && !checkSignal('exam', r)) warns.push('weak_exam_signal');
  if (e.eligibilitySignal && !checkSignal('eligibility', r)) warns.push('weak_eligibility_signal');
  if (e.rankFollowup && !checkSignal('rank', r)) warns.push('weak_rank_followup');
  if (e.categoryContext && !checkSignal('category', r)) warns.push('weak_category_context');
  if (e.instituteSignal && !checkSignal('institute', r)) warns.push('weak_institute_signal');
  if (e.quotaSignal && !checkSignal('quota', r)) warns.push('weak_quota_signal');
  if (e.reservationSignal && !checkSignal('reservation', r)) warns.push('weak_reservation_signal');

  if (e.clarifyingFirst) {
    const ok =
      /\?|which|what (do|kind|specifically)|could you|please (tell|share|specify)|clarify|more detail|help me understand|JEE|Main|Advanced|rank|exam|admission/i.test(
        r
      );
    if (!ok) warns.push('may_have_guessed_without_clarifying');
  }

  if (caseRow.group === 'C1_entry') {
    if (meta.lastIntent && WRONG_INTENTS.has(meta.lastIntent)) {
      fails.push(`entry_wrong_intent:${meta.lastIntent}`);
    }
    if (WRONG_JOURNEY.test(r) && !/JEE|Main|Advanced|IIT|NIT|counsell/i.test(r)) {
      fails.push('entry_wrong_journey_booking_summary');
    }
    if (C1_ADVANCED_USERS.has(caseRow.user) && !ADVANCED_REPLY_RE.test(r)) {
      warns.push('weak_advanced_entry_signal');
    }
    if (C1_MAIN_USERS.has(caseRow.user) && !MAIN_REPLY_RE.test(r)) {
      warns.push('weak_main_entry_signal');
    }
  }

  if (meta.webhookError) fails.push(`webhook_error:${meta.webhookError}`);
  if (meta.inboundSaved === false && String(caseRow.user || '').trim() !== '') {
    fails.push('inbound_not_saved');
  }
  if (!r && !meta.webhookError && e.nonEmpty !== false && !e.mustScopeRefuse) {
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

async function ensureProductLineIit(db, phone) {
  const res = await db.collection('whatsappconversations').updateMany(
    { phone },
    { $set: { productLine: 'iit_counselling', updatedAt: new Date() } }
  );
  return res.modifiedCount;
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
  console.log(' SECTION C — PRODUCTION UAT (AUDIT)');
  console.log(' JEE Main & JEE Advanced');
  console.log(' Phone:', PHONE10);
  console.log(' Webhook:', WEBHOOK);
  console.log(' Mongo:', (process.env.MONGODB_URI || '').replace(/\/\/.*@/, '//***@').slice(0, 70));
  console.log(' Pass gate:', PASS_GATE);
  console.log(' Started:', startedAt.toISOString());
  console.log('═══════════════════════════════════════════════\n');

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

  const productLineUpdates = await ensureProductLineIit(db, PHONE10);
  console.log('Ensured productLine=iit_counselling on', productLineUpdates, 'conversation(s)');

  const convBefore = await convCol.findOne({ phone: PHONE10 });
  console.log('Conversation before:', convBefore ? String(convBefore._id) : 'none');
  console.log('Product line before:', convBefore?.productLine || 'none');

  const cli = parseArgs(process.argv.slice(2));
  const allCases = buildCases();
  let cases = allCases;
  const priorById = new Map();

  if (cli.mergeLog) {
    for (const row of parsePartialLog(cli.mergeLog)) {
      priorById.set(row.id, row);
    }
    console.log('Merged prior cases from log:', priorById.size);
  }

  if (cli.from || cli.rerun.length) {
    const fromIdx = cli.from ? allCases.findIndex((c) => c.id === cli.from) : -1;
    const selected = new Map();
    if (fromIdx >= 0) {
      for (const c of allCases.slice(fromIdx)) selected.set(c.id, c);
    }
    for (const id of cli.rerun) {
      const c = allCases.find((x) => x.id === id);
      if (c) selected.set(c.id, c);
    }
    cases = [...selected.values()];
    console.log(
      `Resume mode: running ${cases.length} cases` +
        (cli.from ? ` from ${cli.from}` : '') +
        (cli.rerun.length ? ` +rerun ${cli.rerun.join(',')}` : '')
    );
  }

  console.log('Total cases this run:', cases.length, '(suite', allCases.length + ')\n');

  const results = [];
  let conversationId = convBefore?._id || null;

  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i];
    const msgId = `sectionC-${c.id}-${Date.now()}-${i}`;
    const t0 = Date.now();
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.id} ${JSON.stringify(c.user).slice(0, 48)} … `);

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

    const wait = c.rapid ? RAPID_GAP_MS : WAIT_MS;
    await sleep(wait);

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
    const convAfter = conversationId ? await convCol.findOne({ _id: conversationId }) : null;
    const reply = extractReplyText(outbound);
    const latencyMs = Date.now() - t0;
    const verdict = evaluate(c, reply, {
      webhookError,
      inboundSaved: Boolean(inbound),
      httpStatus,
      lastIntent: convAfter?.lastIntent || null,
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
      iitCounsellingExpertActive: Boolean(botState?.context?.iitCounsellingExpertActive),
      lastIntent: convAfter?.lastIntent || null,
      productLine: convAfter?.productLine || null,
      latencyMs,
      status: verdict.status,
      fails: verdict.fails,
      warns: verdict.warns,
      scopeRefusal: SCOPE_REFUSAL.test(reply),
    };
    results.push(row);
    console.log(
      verdict.status,
      `lat=${latencyMs}ms`,
      `out=${outbound?.status || 'none'}`,
      convAfter?.lastIntent ? `intent=${convAfter.lastIntent}` : ''
    );
  }

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

  let mergedResults = results;
  if (priorById.size) {
    const byId = new Map(priorById);
    for (const r of results) byId.set(r.id, r);
    mergedResults = allCases.map((c) => byId.get(c.id)).filter(Boolean);
    console.log(
      `Merged suite coverage: ${mergedResults.length}/${allCases.length} (ran ${results.length} this session)`
    );
  }

  const pass = mergedResults.filter((r) => r.status === 'PASS').length;
  const warn = mergedResults.filter((r) => r.status === 'PASS_WITH_WARNINGS').length;
  const fail = mergedResults.filter((r) => r.status === 'FAIL').length;
  const total = mergedResults.length;
  const passRate = total ? ((pass + warn) / total) * 100 : 0;
  const gatePct = PASS_GATE * 100;
  let readiness = 'FAIL';
  if (passRate >= gatePct && fail === 0 && total >= allCases.length) readiness = 'PASS';
  else if (passRate >= gatePct && fail === 0) readiness = 'PASS_WITH_WARNINGS';
  else if (passRate >= gatePct) readiness = 'PASS_WITH_WARNINGS';
  else readiness = 'FAIL';

  const byGroup = {};
  for (const r of mergedResults) {
    byGroup[r.group] = byGroup[r.group] || { pass: 0, warn: 0, fail: 0, total: 0 };
    byGroup[r.group].total += 1;
    if (r.status === 'PASS') byGroup[r.group].pass += 1;
    else if (r.status === 'PASS_WITH_WARNINGS') byGroup[r.group].warn += 1;
    else byGroup[r.group].fail += 1;
  }

  const resultsForReport = mergedResults;

  const report = {
    section: 'C',
    title: 'JEE Main & JEE Advanced Certification',
    mode: 'AUDIT',
    phone: PHONE10,
    productLine: 'iit_counselling',
    executedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    pipeline: {
      inbound: 'POST https://guide-xpert-backend.vercel.app/webhook/gupshup (synthetic Gupshup payload)',
      processing: 'production backend claimed inbound → scope → JEE intent → expert/RAG/LLM',
      outbound: 'production whatsappOutboundService → Gupshup → Meta → WhatsApp 9347763131',
      notes: [
        'Requires conversation productLine=iit_counselling (enforced before and during run).',
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
      productLineConversationsUpdated: productLineUpdates,
    },
    summary: {
      total,
      pass,
      passWithWarnings: warn,
      fail,
      passRatePercent: Number(passRate.toFixed(2)),
      passGatePercent: gatePct,
      sectionCReadiness: readiness,
    },
    byGroup,
    database: {
      conversationIds: convs.map((x) => String(x._id)),
      conversationCount: convs.length,
      duplicateConversation: convs.length > 1,
      finalBotState: botStateFinal?.state || null,
      finalIitCounsellingExpertActive: Boolean(botStateFinal?.context?.iitCounsellingExpertActive),
      finalProductLine: convs[0]?.productLine || null,
      inboundCreatedDuringRun: inboundCount,
      outboundCreatedDuringRun: outboundCount,
      leadEvents,
    },
    cases: resultsForReport,
    failures: resultsForReport
      .filter((r) => r.status === 'FAIL')
      .map((r) => ({
        id: r.id,
        group: r.group,
        user: r.user,
        fails: r.fails,
        lastIntent: r.lastIntent,
        replyPreview: r.replyPreview,
        severity: severityFor(r),
        recommendedFix: recommendFix(r),
      })),
  };

  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUT_DIR, `sectionC-certification-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `sectionC-certification-${stamp}.md`);
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

function severityFor(r) {
  const high = [
    'unexpected_human_handoff',
    'scope_rejection',
    'hallucinated_date',
    'overconfident_guarantee',
    'expected_scope_refusal_missing',
    'cpa_routing',
    'entry_wrong_intent',
    'entry_wrong_journey_booking_summary',
    'invented_instead_of_refusing',
    'guaranteed_instead_of_refusing',
    'invented_specific_without_disclaimer',
  ];
  if (r.fails.some((f) => high.some((h) => f.includes(h)))) return 'HIGH';
  return 'MEDIUM';
}

function recommendFix(r) {
  if (r.fails.includes('empty_response') || r.fails.includes('no_outbound_reply')) {
    return 'Investigate JEE expert inbound processing; ensure factual and entry utterances always emit a reply.';
  }
  if (r.fails.includes('scope_rejection')) {
    return 'Route JEE Main/Advanced utterances through iit_counselling expert; do not scope-block in-product questions.';
  }
  if (r.fails.includes('expected_scope_refusal_missing')) {
    return 'Strengthen scope firewall for clearly out-of-domain requests (Python, IPL, movies, politics, shopping).';
  }
  if (r.fails.includes('cpa_routing')) {
    return 'JEE entry phrases must not route to counsellor_program_assistant; prioritize JEE/IIT counselling expert.';
  }
  if (r.fails.some((f) => f.includes('hallucinated_date') || f.includes('invented_instead_of_refusing'))) {
    return 'Add guardrails to refuse unverified JEE dates/cutoffs and direct users to official sources.';
  }
  if (r.fails.some((f) => f.includes('overconfident') || f.includes('guaranteed_instead'))) {
    return 'Avoid guaranteed IIT/NIT outcomes; use probabilistic language and ask for rank/category context.';
  }
  if (r.fails.some((f) => f.startsWith('entry_wrong_intent'))) {
    return 'Prioritize JEE counselling expert on entry phrases; do not route to college predictor/career/CPA.';
  }
  if (r.fails.includes('entry_wrong_journey_reply') || r.fails.includes('entry_wrong_journey_booking_summary')) {
    return 'Entry phrases should open JEE counselling expert, not college predictor or counsellor booking flows.';
  }
  if (r.fails.some((f) => String(f).startsWith('webhook_error'))) {
    return 'Check production webhook availability / timeout; retry case.';
  }
  return 'Review transcript, lastIntent, and JEE session flags for root cause.';
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# GuideXpert Production UAT — Section C Certification');
  lines.push('');
  lines.push('**JEE Main & JEE Advanced**');
  lines.push('');
  lines.push(`- **Phone:** ${report.phone}`);
  lines.push(`- **Product line:** \`${report.productLine}\``);
  lines.push(`- **Executed:** ${report.executedAt}`);
  lines.push(`- **Completed:** ${report.completedAt}`);
  lines.push(`- **Readiness:** **${report.summary.sectionCReadiness}**`);
  lines.push(
    `- **Score:** ${report.summary.pass}/${report.summary.total} PASS, ${report.summary.passWithWarnings} WARN, ${report.summary.fail} FAIL (${report.summary.passRatePercent}% vs gate ${report.summary.passGatePercent}%)`
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
  lines.push(
    `- Conversations for phone: **${report.database.conversationCount}** (duplicate=${report.database.duplicateConversation})`
  );
  lines.push(`- Final bot state: \`${report.database.finalBotState}\``);
  lines.push(`- IIT expert active: **${report.database.finalIitCounsellingExpertActive}**`);
  lines.push(`- Product line: \`${report.database.finalProductLine}\``);
  lines.push(`- Inbounds created: ${report.database.inboundCreatedDuringRun}`);
  lines.push(`- Outbounds created: ${report.database.outboundCreatedDuringRun}`);
  lines.push('');
  lines.push('## Case results');
  lines.push('| ID | Group | User | Status | Intent | Latency | Notes |');
  lines.push('|---|---|---|---|---|---:|---|');
  for (const r of report.cases) {
    const notes = [...(r.fails || []), ...(r.warns || [])].join('; ') || '';
    lines.push(
      `| ${r.id} | ${r.group} | ${JSON.stringify(r.user)} | ${r.status} | ${r.lastIntent || '-'} | ${r.latencyMs} | ${notes.replace(/\|/g, '/')} |`
    );
  }
  lines.push('');
  lines.push('## Failures / root causes');
  if (!report.failures.length) lines.push('_None_');
  for (const f of report.failures) {
    lines.push(`### ${f.id} — ${JSON.stringify(f.user)}`);
    lines.push(`- Group: ${f.group}`);
    lines.push(`- Severity: ${f.severity}`);
    lines.push(`- Last intent: ${f.lastIntent || '-'}`);
    lines.push(`- Fails: ${f.fails.join(', ')}`);
    lines.push(`- Reply: ${JSON.stringify(f.replyPreview)}`);
    lines.push(`- Recommended fix: ${f.recommendedFix}`);
    lines.push('');
  }
  lines.push('## Transcript (compact)');
  for (const r of report.cases) {
    lines.push(`**${r.id} USER:** ${JSON.stringify(r.user)}`);
    lines.push(`**BOT:** ${JSON.stringify(r.replyPreview)}`);
    if (r.lastIntent) lines.push(`**INTENT:** ${r.lastIntent}`);
    lines.push('');
  }
  return lines.join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
