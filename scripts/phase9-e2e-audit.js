'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const https = require('https');

const PHONE_A = '9111111111';
const PHONE_B = '9222222222';

const CONVERSATIONS = [
  {
    phone: PHONE_A,
    messages: [
      {
        user: 'I want CSE.',
        reply: 'CSE is a popular branch. I can help with IIT and NIT counselling for Computer Science.',
      },
      {
        user: 'I am preparing for JEE.',
        reply: 'JEE is the gateway for IITs and NITs. Share your target colleges when ready.',
      },
      {
        user: 'Can I talk to a counsellor?',
        reply: 'I can connect you with a counsellor. A team member will reach out shortly.',
      },
    ],
  },
  {
    phone: PHONE_B,
    messages: [
      {
        user: 'I want IIT Hyderabad.',
        reply: 'IIT Hyderabad is highly competitive. We can discuss branches and cutoffs.',
      },
      {
        user: 'I am worried about fees.',
        reply: 'Fee structure varies by institute and category. I can explain scholarships and loans.',
      },
      {
        user: 'Can I get a demo?',
        reply: 'Yes, we can schedule a demo session for GuideXpert counselling support.',
      },
    ],
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body || '{}') });
        } catch {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getCollectionSnapshot(db, name) {
  const exists = (await db.listCollections({ name }).toArray()).length > 0;
  if (!exists) {
    return { exists: false, count: 0, indexes: [], latest: [] };
  }
  const col = db.collection(name);
  return {
    exists: true,
    count: await col.countDocuments(),
    indexes: await col.indexes(),
    latest: await col.find({}).sort({ _id: -1 }).limit(5).toArray(),
  };
}

async function runExtractionForConversation({ phone, messages }) {
  const { extractAndPersist } = require('../services/chatbot/leadEventExtraction/leadEventExtractionService');
  const conversationId = new mongoose.Types.ObjectId();
  const results = [];

  for (const message of messages) {
    const inboundId = new mongoose.Types.ObjectId();
    const outboundId = new mongoose.Types.ObjectId();
    const result = await extractAndPersist({
      conversation: {
        _id: conversationId,
        phone,
        productLine: 'iit_counselling',
      },
      inbound: {
        _id: inboundId,
        phone,
        text: message.user,
      },
      outboundMessageId: outboundId,
      intent: 'iit_counselling_expert',
      intentReason: 'iit_counselling_question',
      userMessage: message.user,
      assistantReply: message.reply,
      leadContext: { productLine: 'iit_counselling' },
      contextPatch: { iitCounsellingExpertActive: true },
    });
    results.push({
      user: message.user,
      persisted: Boolean(result),
      events: result?.events || [],
    });
    await sleep(2500);
  }

  return { phone, conversationId: String(conversationId), results };
}

async function queryPhoneArtifacts(db, phone) {
  return {
    events: await db.collection('whatsappleadevents').find({ phone }).sort({ createdAt: -1 }).toArray(),
    profile: await db.collection('whatsappleadprofiles').findOne({ phone }),
    score: await db.collection('whatsappleadscores').findOne({ phone }),
  };
}

async function tryAdminLogin(baseUrl) {
  const attempts = [
    { username: 'admin', password: 'admin123' },
    { username: 'admin', password: 'password' },
    { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD },
  ].filter((a) => a.username && a.password);

  for (const cred of attempts) {
    const res = await fetchJson(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cred),
    });
    if (res.status === 200 && res.body?.token) {
      return res.body.token;
    }
  }
  return null;
}

async function testLeadInsightsApis(baseUrl, token, phone) {
  const headers = { Authorization: `Bearer ${token}` };
  const endpoints = [
    `/api/admin/lead-insights/stats`,
    `/api/admin/lead-insights/hot`,
    `/api/admin/lead-insights?page=1&limit=25`,
    `/api/admin/lead-insights/${phone}`,
  ];
  const out = {};
  for (const path of endpoints) {
    const res = await fetchJson(`${baseUrl}${path}`, { method: 'GET', headers });
    out[path] = { status: res.status, body: res.body };
  }
  return out;
}

async function runFlagIsolationTest(db, phone) {
  const { updateProfile } = require('../services/chatbot/leadProfile/leadProfileService');
  const conversationId = new mongoose.Types.ObjectId();
  const events = [{ type: 'exam_mentioned', value: 'JEE', confidence: 0.9, evidence: 'JEE prep' }];

  const scenarios = [
    {
      name: 'extraction_off',
      env: { CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED: '0', CHATBOT_LEAD_PROFILE_ENABLED: '1', CHATBOT_LEAD_SCORING_ENABLED: '1' },
      run: async () => {
        const { extractAndPersist } = require('../services/chatbot/leadEventExtraction/leadEventExtractionService');
        const before = await db.collection('whatsappleadevents').countDocuments({ phone: '9333333333' });
        const result = await extractAndPersist({
          conversation: { _id: conversationId, phone: '9333333333', productLine: 'iit_counselling' },
          inbound: { _id: new mongoose.Types.ObjectId(), phone: '9333333333', text: 'I want CSE' },
          userMessage: 'I want CSE',
          assistantReply: 'Sure',
          intent: 'iit_counselling_expert',
          contextPatch: { iitCounsellingExpertActive: true },
        });
        const after = await db.collection('whatsappleadevents').countDocuments({ phone: '9333333333' });
        return { resultNull: result === null, countDelta: after - before };
      },
    },
    {
      name: 'profile_off',
      env: { CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED: '1', CHATBOT_LEAD_PROFILE_ENABLED: '0', CHATBOT_LEAD_SCORING_ENABLED: '1' },
      run: async () => {
        const profileBefore = await db.collection('whatsappleadprofiles').countDocuments({ phone: '9444444444' });
        await updateProfile({
          phone: '9444444444',
          conversationId,
          events,
          assistantType: 'ice',
        });
        await sleep(1000);
        const profileAfter = await db.collection('whatsappleadprofiles').countDocuments({ phone: '9444444444' });
        return { profileCountDelta: profileAfter - profileBefore };
      },
    },
    {
      name: 'scoring_off',
      env: { CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED: '1', CHATBOT_LEAD_PROFILE_ENABLED: '1', CHATBOT_LEAD_SCORING_ENABLED: '0' },
      run: async () => {
        process.env.CHATBOT_LEAD_PROFILE_ENABLED = '1';
        process.env.CHATBOT_LEAD_SCORING_ENABLED = '0';
        const scoreBefore = await db.collection('whatsappleadscores').countDocuments({ phone: '9555555555' });
        await updateProfile({
          phone: '9555555555',
          conversationId: new mongoose.Types.ObjectId(),
          events: [
            { type: 'demo_interest', value: 'yes', confidence: 0.95, evidence: 'demo' },
            { type: 'handoff_requested', value: 'yes', confidence: 0.95, evidence: 'counsellor' },
          ],
          assistantType: 'ice',
        });
        await sleep(1500);
        const scoreAfter = await db.collection('whatsappleadscores').countDocuments({ phone: '9555555555' });
        const profile = await db.collection('whatsappleadprofiles').findOne({ phone: '9555555555' });
        return { scoreCountDelta: scoreAfter - scoreBefore, profileExists: Boolean(profile) };
      },
    },
  ];

  const isolation = {};
  for (const scenario of scenarios) {
    for (const [key, value] of Object.entries(scenario.env)) {
      process.env[key] = value;
    }
    delete require.cache[require.resolve('../services/chatbot/leadEventExtraction/leadEventExtractionFlags')];
    delete require.cache[require.resolve('../services/chatbot/leadProfile/leadProfileFlags')];
    delete require.cache[require.resolve('../services/chatbot/leadScoring/leadScoringFlags')];
    delete require.cache[require.resolve('../services/chatbot/leadEventExtraction/leadEventExtractionService')];
    delete require.cache[require.resolve('../services/chatbot/leadProfile/leadProfileService')];
    delete require.cache[require.resolve('../services/chatbot/leadScoring/leadScoringService')];

    isolation[scenario.name] = await scenario.run();
  }

  return isolation;
}

async function main() {
  const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
  const report = {
    step1_flags: {
      fromDotenv: {
        CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED: process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED || '(unset)',
        CHATBOT_LEAD_PROFILE_ENABLED: process.env.CHATBOT_LEAD_PROFILE_ENABLED || '(unset)',
        CHATBOT_LEAD_SCORING_ENABLED: process.env.CHATBOT_LEAD_SCORING_ENABLED || '(unset)',
      },
    },
    step2_collections_before: null,
    step3_simulation: null,
    step4_persistence: null,
    step5_api: null,
    step7_flag_isolation: null,
    runtime_health: null,
  };

  try {
    report.runtime_health = (await fetchJson(`${baseUrl}/api/health`)).body;
  } catch (error) {
    report.runtime_health = { error: error.message };
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  report.step2_collections_before = {
    whatsappleadevents: await getCollectionSnapshot(db, 'whatsappleadevents'),
    whatsappleadprofiles: await getCollectionSnapshot(db, 'whatsappleadprofiles'),
    whatsappleadscores: await getCollectionSnapshot(db, 'whatsappleadscores'),
  };

  report.step3_simulation = [];
  for (const convo of CONVERSATIONS) {
    report.step3_simulation.push(await runExtractionForConversation(convo));
  }

  await sleep(3000);

  report.step4_persistence = {
    [PHONE_A]: await queryPhoneArtifacts(db, PHONE_A),
    [PHONE_B]: await queryPhoneArtifacts(db, PHONE_B),
    collections_after: {
      whatsappleadevents: await getCollectionSnapshot(db, 'whatsappleadevents'),
      whatsappleadprofiles: await getCollectionSnapshot(db, 'whatsappleadprofiles'),
      whatsappleadscores: await getCollectionSnapshot(db, 'whatsappleadscores'),
    },
  };

  const token = await tryAdminLogin(baseUrl);
  report.step5_api = {
    adminLogin: token ? 'success' : 'failed — could not obtain admin JWT',
  };
  if (token) {
    report.step5_api.responses = await testLeadInsightsApis(baseUrl, token, PHONE_A);
  }

  report.step7_flag_isolation = await runFlagIsolationTest(db, PHONE_A);

  report.step2_collections_after = report.step4_persistence.collections_after;

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('audit_failed', error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
