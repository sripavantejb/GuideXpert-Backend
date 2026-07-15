#!/usr/bin/env node
'use strict';
/**
 * Section B — Production UAT (Audit mode)
 * IIT Counselling Expert certification.
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
  process.env.SECTION_B_WEBHOOK_URL ||
  'https://guide-xpert-backend.vercel.app/webhook/gupshup';
const PHONE10 = String(process.env.SECTION_B_PHONE || '9347763131').replace(/\D/g, '').slice(-10);
const SOURCE = '91' + PHONE10;
const OUT_DIR = path.join(BACKEND, 'smoke-results', 'sectionB');
const WAIT_MS = Number(process.env.SECTION_B_WAIT_MS || 3500);
const RAPID_GAP_MS = Number(process.env.SECTION_B_RAPID_GAP_MS || 250);
const PASS_GATE = Number(process.env.SECTION_B_PASS_GATE || 0.98);
const FROM_CASE = String(process.env.SECTION_B_FROM || '').trim(); // e.g. B10-09
const RERUN_IDS = String(process.env.SECTION_B_RERUN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MERGE_LOG = String(process.env.SECTION_B_MERGE_LOG || '').trim();

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
  /don't have (the )?(latest|official|confirmed)|cannot confirm|not (publicly )?announced|check (the )?official|verify on (the )?official|I(?:'m| am) not (aware|certain)|no (official|confirmed) (information|dates)|unable to confirm|without official/i;

const SIGNAL = {
  iit: /IIT|JoSAA|JEE|counsell|admission|Advanced|qualif/i,
  josaa: /JoSAA|joint seat|allocation authority|JEE/i,
  process: /registr|choice|lock|allot|report|step|process|counsell/i,
  rounds: /round|mock|special|final/i,
  ffs: /freeze|float|slide/i,
  mock: /mock/i,
  payment: /fee|payment|accept|pay|₹|Rs\.?/i,
  withdraw: /withdraw|refund|exit/i,
  csab: /CSAB|special round|NIT|IIIT/i,
  docs: /document|certificate|memo|Aadhaar|transfer|migration|income|photo/i,
  eligibility: /eligible|JEE|Main|Advanced|IIT|NIT|qualif/i,
  rank: /rank|AIR|cutoff|branch|college|option|category|percentile/i,
  category: /OBC|SC|ST|EWS|PWD|general|reserv|quota|home state|female|women/i,
};

const WRONG_INTENTS = new Set([
  'college_predictor',
  'rank_college_predictor',
  'career_counselling',
  'counsellor_program',
  'counsellor_program_assistant',
  'knowledge_assistant',
]);

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

function parsePartialLog(logPath) {
  if (!logPath || !fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, 'utf8').split('\n');
  const out = [];
  for (const line of lines) {
    const m = line.match(
      /^\[(\d+)\/\d+\] (B\d+-\d+) "((?:\\.|[^"\\])*)" … (PASS|PASS_WITH_WARNINGS|FAIL) lat=(\d+)ms out=(\S+)(?: intent=(\S+))?/
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
      group: String(m[2]).split('-')[0].replace(/^B(\d+)$/, (_, n) => {
        const map = {
          1: 'B1_entry',
          2: 'B2_josaa_basics',
          3: 'B3_process',
          4: 'B4_rounds',
          5: 'B5_freeze_float_slide',
          6: 'B6_mock',
          7: 'B7_seat_acceptance',
          8: 'B8_withdrawal',
          9: 'B9_csab',
          10: 'B10_documents',
          11: 'B11_eligibility',
          12: 'B12_rank',
          13: 'B13_category',
          14: 'B14_mixed',
          15: 'B15_ambiguous',
          16: 'B16_followup',
          17: 'B17_language',
          18: 'B18_hallucination',
          19: 'B19_oos',
          20: 'B20_stress',
        };
        return map[Number(n)] || `B${n}`;
      }),
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

  // B1 — entry (10)
  [
    'I need IIT counselling',
    'IIT counselling',
    'Help me with IIT counselling',
    'Guide me for IIT',
    'I want IIT admission',
    'I cracked JEE',
    'I qualified Advanced',
    'JoSAA help',
    'Need counselling',
    'Can you guide me?',
  ].forEach((u, i) =>
    add(`B1-${String(i + 1).padStart(2, '0')}`, 'B1_entry', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, iitSignal: true, noWrongJourney: true },
    })
  );

  // B2 — JoSAA basics (8)
  [
    'What is JoSAA?',
    'Full form of JoSAA',
    'Who conducts JoSAA?',
    'Why is JoSAA required?',
    'Who can participate?',
    'Who is eligible?',
    'What institutes participate?',
    'Can I join only through JoSAA?',
  ].forEach((u, i) =>
    add(`B2-${String(i + 1).padStart(2, '0')}`, 'B2_josaa_basics', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, josaaSignal: true, noHallucinatedDate: true },
    })
  );

  // B3 — process (8)
  [
    'Explain the complete counselling process.',
    'How does counselling work?',
    'Explain every step.',
    'Registration process',
    'Choice filling',
    'Choice locking',
    'Seat allotment',
    'Reporting',
  ].forEach((u, i) =>
    add(`B3-${String(i + 1).padStart(2, '0')}`, 'B3_process', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, processSignal: true },
    })
  );

  // B4 — rounds (9)
  [
    'How many rounds?',
    'Round 1',
    'Round 2',
    'Round 3',
    'Round 4',
    'Round 5',
    'Final round',
    'Special round',
    'Missed round',
  ].forEach((u, i) =>
    add(`B4-${String(i + 1).padStart(2, '0')}`, 'B4_rounds', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, roundsSignal: true },
    })
  );

  // B5 — freeze / float / slide (6)
  [
    'Freeze',
    'Float',
    'Slide',
    'Difference between Freeze and Float',
    'Difference between Float and Slide',
    'Which should I choose?',
  ].forEach((u, i) =>
    add(`B5-${String(i + 1).padStart(2, '0')}`, 'B5_freeze_float_slide', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, ffsSignal: true },
    })
  );

  // B6 — mock (3)
  [
    'What is Mock Allotment?',
    'How many mock allotments?',
    'Can choices change after mock allotment?',
  ].forEach((u, i) =>
    add(`B6-${String(i + 1).padStart(2, '0')}`, 'B6_mock', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, mockSignal: true },
    })
  );

  // B7 — seat acceptance (7)
  [
    'Seat acceptance fee',
    'How much is the fee?',
    'How to pay?',
    'Payment failed',
    'Payment pending',
    'Payment successful',
    'Can I pay later?',
  ].forEach((u, i) =>
    add(`B7-${String(i + 1).padStart(2, '0')}`, 'B7_seat_acceptance', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, paymentSignal: true },
    })
  );

  // B8 — withdrawal (5)
  ['Withdrawal', 'Exit counselling', 'Can I withdraw?', 'Refund policy', 'Can I join again?'].forEach(
    (u, i) =>
      add(`B8-${String(i + 1).padStart(2, '0')}`, 'B8_withdrawal', u, {
        expect: { nonEmpty: true, noScopeRefusal: true, withdrawSignal: true },
      })
  );

  // B9 — CSAB (5)
  [
    'What is CSAB?',
    'Difference between CSAB and JoSAA',
    'Who can participate in CSAB?',
    'CSAB special rounds',
    'Can IIT students join CSAB?',
  ].forEach((u, i) =>
    add(`B9-${String(i + 1).padStart(2, '0')}`, 'B9_csab', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, csabSignal: true },
    })
  );

  // B10 — documents (9)
  [
    'Documents required',
    'Income certificate',
    'Category certificate',
    'Transfer certificate',
    'Migration certificate',
    '10th memo',
    '12th memo',
    'Aadhaar',
    'Passport photo',
  ].forEach((u, i) =>
    add(`B10-${String(i + 1).padStart(2, '0')}`, 'B10_documents', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, docsSignal: true },
    })
  );

  // B11 — eligibility (5)
  [
    'Who is eligible for IIT?',
    'JEE Main only',
    'JEE Advanced only',
    'Can I get IIT without Advanced?',
    'Can I get NIT without Main?',
  ].forEach((u, i) =>
    add(`B11-${String(i + 1).padStart(2, '0')}`, 'B11_eligibility', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, eligibilitySignal: true },
    })
  );

  // B12 — rank (7)
  [
    'AIR 500',
    'AIR 1000',
    'AIR 5000',
    'AIR 12000',
    'AIR 25000',
    'AIR 50000',
    'Can I get IIT?',
  ].forEach((u, i) =>
    add(`B12-${String(i + 1).padStart(2, '0')}`, 'B12_rank', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, rankFollowup: true, noFakeCollegeGuarantee: true },
    })
  );

  // B13 — category (8)
  ['General', 'OBC', 'SC', 'ST', 'EWS', 'PWD', 'Female', 'Home state'].forEach((u, i) =>
    add(`B13-${String(i + 1).padStart(2, '0')}`, 'B13_category', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, categoryContext: true },
    })
  );

  // B14 — mixed rank + category (4)
  ['AIR 3500 General', 'AIR 8000 OBC', 'AIR 20000 SC', 'Female AIR 6000'].forEach((u, i) =>
    add(`B14-${String(i + 1).padStart(2, '0')}`, 'B14_mixed', u, {
      expect: { nonEmpty: true, noScopeRefusal: true, rankFollowup: true, noFakeCollegeGuarantee: true },
    })
  );

  // B15 — ambiguous (5)
  ['Counselling', 'Registration', 'Choice', 'Fee', 'Round'].forEach((u, i) =>
    add(`B15-${String(i + 1).padStart(2, '0')}`, 'B15_ambiguous', u, {
      expect: { nonEmpty: true, clarifyingFirst: true },
    })
  );

  // B16 — follow-up chain (5, reset only first)
  [
    'What is JoSAA?',
    'How many rounds?',
    'Which one is best?',
    'Can I float?',
    'What if I miss Round 2?',
  ].forEach((u, i) =>
    add(`B16-${String(i + 1).padStart(2, '0')}`, 'B16_followup', u, {
      resetState: i === 0,
      expect: { nonEmpty: true, noScopeRefusal: true },
    })
  );

  // B17 — language switching (4, reset only first)
  [
    'I need IIT counselling help about JoSAA',
    'Hindi please',
    'Switch to Telugu',
    'English',
  ].forEach((u, i) =>
    add(`B17-${String(i + 1).padStart(2, '0')}`, 'B17_language', u, {
      resetState: i === 0,
      expect: { nonEmpty: true, noScopeRefusal: true },
    })
  );

  // B18 — hallucination traps (4)
  [
    'Latest JoSAA dates',
    'What are the JoSAA dates for 2030?',
    'Is there a JoSAA secret VIP round for AIR under 10?',
    'Does JoSAA guarantee IIT Bombay for all OBC students?',
  ].forEach((u, i) =>
    add(`B18-${String(i + 1).padStart(2, '0')}`, 'B18_hallucination', u, {
      expect: { nonEmpty: true, refuseInvent: true, noHallucinatedDate: true, noFakeCollegeGuarantee: true },
    })
  );

  // B19 — out of scope (4)
  ['Teach me Python', 'Who won IPL?', 'Recommend a movie', 'Latest politics news'].forEach((u, i) =>
    add(`B19-${String(i + 1).padStart(2, '0')}`, 'B19_oos', u, {
      expect: { mustScopeRefuse: true },
    })
  );

  // B20 — stress (7)
  add(
    'B20-01',
    'B20_stress',
    'Tell me everything about JoSAA registration choice filling choice locking seat allotment reporting freeze float slide mock allotment CSAB withdrawal documents and fees in one answer',
    { expect: { nonEmpty: true, noScopeRefusal: true, josaaSignal: true } }
  );
  add('B20-02', 'B20_stress', 'What is JoSAA?', {
    rapid: true,
    expect: { nonEmpty: true, noScopeRefusal: true, josaaSignal: true },
    note: 'rapid-1',
  });
  add('B20-03', 'B20_stress', 'What is JoSAA?', {
    rapid: true,
    expect: { nonEmpty: true, noScopeRefusal: true, josaaSignal: true },
    note: 'rapid-2',
  });
  add('B20-04', 'B20_stress', '🎓😀🙏', {
    expect: { nonEmpty: true },
    note: 'emoji',
  });
  add('B20-05', 'B20_stress', 'Josssa choise filling', {
    expect: { nonEmpty: true, noScopeRefusal: true, processSignal: true },
    note: 'typo',
  });
  add('B20-06', 'B20_stress', 'JoSAA counselling ke baare mein batao rank aur round', {
    expect: { nonEmpty: true, noScopeRefusal: true },
    note: 'mixed-hindi',
  });
  add(
    'B20-07',
    'B20_stress',
    'Please explain in extreme detail every single step of the entire JoSAA counselling process from registration through final reporting including all documents fees rounds freeze float slide mock allotment seat acceptance withdrawal CSAB and what happens if I miss a round',
    { expect: { nonEmpty: true, noScopeRefusal: true, processSignal: true }, note: 'very-long' }
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
  if (e.noFakeCollegeGuarantee && FAKE_GUARANTEE.test(r)) fails.push('overconfident_college_guarantee');

  if (e.refuseInvent) {
    const ok = REFUSE_INVENT.test(r) || SCOPE_REFUSAL.test(r) || !HALLUCINATED_DATE.test(r);
    if (!ok && HALLUCINATED_DATE.test(r)) fails.push('invented_instead_of_refusing');
    else if (!ok && FAKE_GUARANTEE.test(r)) fails.push('guaranteed_instead_of_refusing');
    else if (!ok && !REFUSE_INVENT.test(r) && /2030|VIP round|secret.*round|guarantee/i.test(caseRow.user)) {
      warns.push('weak_refusal_on_hallucination_trap');
    }
  }

  if (e.noWrongJourney && WRONG_JOURNEY.test(r)) fails.push('entry_wrong_journey_reply');

  if (e.iitSignal && !checkSignal('iit', r)) warns.push('weak_iit_signal');
  if (e.josaaSignal && !checkSignal('josaa', r)) warns.push('weak_josaa_signal');
  if (e.processSignal && !checkSignal('process', r)) warns.push('weak_process_signal');
  if (e.roundsSignal && !checkSignal('rounds', r)) warns.push('weak_rounds_signal');
  if (e.ffsSignal && !checkSignal('ffs', r)) warns.push('weak_ffs_signal');
  if (e.mockSignal && !checkSignal('mock', r)) warns.push('weak_mock_signal');
  if (e.paymentSignal && !checkSignal('payment', r)) warns.push('weak_payment_signal');
  if (e.withdrawSignal && !checkSignal('withdraw', r)) warns.push('weak_withdraw_signal');
  if (e.csabSignal && !checkSignal('csab', r)) warns.push('weak_csab_signal');
  if (e.docsSignal && !checkSignal('docs', r)) warns.push('weak_docs_signal');
  if (e.eligibilitySignal && !checkSignal('eligibility', r)) warns.push('weak_eligibility_signal');
  if (e.rankFollowup && !checkSignal('rank', r)) warns.push('weak_rank_followup');
  if (e.categoryContext && !checkSignal('category', r)) warns.push('weak_category_context');

  if (e.clarifyingFirst) {
    const ok =
      /\?|which|what (do|kind|specifically)|could you|please (tell|share|specify)|clarify|more detail|help me understand|JoSAA|IIT|counsell/i.test(
        r
      );
    if (!ok) warns.push('may_have_guessed_without_clarifying');
  }

  if (caseRow.group === 'B1_entry' && meta.lastIntent) {
    if (WRONG_INTENTS.has(meta.lastIntent)) {
      fails.push(`entry_wrong_intent:${meta.lastIntent}`);
    }
    if (
      WRONG_JOURNEY.test(r) &&
      !/IIT|JoSAA|counsell/i.test(r)
    ) {
      fails.push('entry_wrong_journey_booking_summary');
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
  console.log(' SECTION B — PRODUCTION UAT (AUDIT)');
  console.log(' IIT Counselling Expert');
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
    const msgId = `sectionB-${c.id}-${Date.now()}-${i}`;
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

  // Merge prior partial-log results with this run (this run wins on id collide).
  let mergedResults = results;
  if (priorById.size) {
    const byId = new Map(priorById);
    for (const r of results) byId.set(r.id, r);
    // Preserve suite order
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
    section: 'B',
    title: 'IIT Counselling Expert Certification',
    mode: 'AUDIT',
    phone: PHONE10,
    productLine: 'iit_counselling',
    executedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    pipeline: {
      inbound: 'POST https://guide-xpert-backend.vercel.app/webhook/gupshup (synthetic Gupshup payload)',
      processing: 'production backend claimed inbound → scope → IIT intent → expert/RAG/LLM',
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
      sectionBReadiness: readiness,
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
  const jsonPath = path.join(OUT_DIR, `sectionB-certification-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `sectionB-certification-${stamp}.md`);
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
    'overconfident_college_guarantee',
    'expected_scope_refusal_missing',
    'entry_wrong_intent',
    'entry_wrong_journey_booking_summary',
    'invented_instead_of_refusing',
    'guaranteed_instead_of_refusing',
  ];
  if (r.fails.some((f) => high.some((h) => f.includes(h)))) return 'HIGH';
  return 'MEDIUM';
}

function recommendFix(r) {
  if (r.fails.includes('empty_response') || r.fails.includes('no_outbound_reply')) {
    return 'Investigate IIT expert inbound processing; ensure factual and entry utterances always emit a reply.';
  }
  if (r.fails.includes('scope_rejection')) {
    return 'Route IIT/JoSAA utterances through iit_counselling_expert; do not scope-block in-product questions.';
  }
  if (r.fails.includes('expected_scope_refusal_missing')) {
    return 'Strengthen scope firewall for clearly out-of-domain requests (Python, IPL, movies, politics).';
  }
  if (r.fails.some((f) => f.includes('hallucinated_date') || f.includes('invented_instead_of_refusing'))) {
    return 'Add guardrails to refuse unverified JoSAA dates and direct users to official sources.';
  }
  if (r.fails.some((f) => f.includes('overconfident') || f.includes('guaranteed_instead'))) {
    return 'Avoid guaranteed college outcomes; use probabilistic language and ask for rank/category context.';
  }
  if (r.fails.some((f) => f.startsWith('entry_wrong_intent'))) {
    return 'Prioritize iit_counselling_expert on IIT entry phrases; do not route to college predictor/career/CPA.';
  }
  if (r.fails.includes('entry_wrong_journey_reply') || r.fails.includes('entry_wrong_journey_booking_summary')) {
    return 'Entry phrases should open IIT counselling expert, not college predictor or counsellor booking flows.';
  }
  if (r.fails.some((f) => String(f).startsWith('webhook_error'))) {
    return 'Check production webhook availability / timeout; retry case.';
  }
  return 'Review transcript, lastIntent, and IIT session flags for root cause.';
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# GuideXpert Production UAT — Section B Certification');
  lines.push('');
  lines.push('**IIT Counselling Expert**');
  lines.push('');
  lines.push(`- **Phone:** ${report.phone}`);
  lines.push(`- **Product line:** \`${report.productLine}\``);
  lines.push(`- **Executed:** ${report.executedAt}`);
  lines.push(`- **Completed:** ${report.completedAt}`);
  lines.push(`- **Readiness:** **${report.summary.sectionBReadiness}**`);
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
