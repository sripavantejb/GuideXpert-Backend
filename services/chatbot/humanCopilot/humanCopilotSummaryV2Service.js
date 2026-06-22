'use strict';

const crypto = require('crypto');
const WhatsAppAgentHandoff = require('../../../models/WhatsAppAgentHandoff');
const { OpenAiCompatibleProvider } = require('../../ai/providers/OpenAiCompatibleProvider');
const { buildSummarySystemPrompt } = require('../../ai/prompts/humanCopilotSummary.system');
const { isCopilotSuggestedRepliesEnabled } = require('./humanCopilotFlags');

const provider = new OpenAiCompatibleProvider();

const UNKNOWN = 'Unknown';
const NOT_COLLECTED = 'Not yet collected';

function pick(value, fallback = NOT_COLLECTED) {
  const s = String(value || '').trim();
  return s || fallback;
}

function flattenEventRows(recentEvents = []) {
  const rows = [];
  for (const row of recentEvents) {
    const nested = Array.isArray(row?.events) ? row.events : [row];
    for (const e of nested) {
      if (e?.type) {
        rows.push({
          type: e.type,
          value: e.value || '',
          confidence: e.confidence,
          createdAt: row.createdAt || e.createdAt,
        });
      }
    }
  }
  return rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function latestEventValue(events, type) {
  const hit = events.find((e) => e.type === type);
  return hit?.value ? String(hit.value).trim() : null;
}

function buildSummaryCacheKey({
  handoffId,
  transcript,
  internalNotesCount = 0,
  leadScore,
  eventCount = 0,
}) {
  const messages = transcript?.messages || [];
  const last = messages.length ? messages[messages.length - 1] : null;
  const payload = [
    String(handoffId),
    String(last?.id || ''),
    String(last?.at || ''),
    String(messages.length),
    String(internalNotesCount),
    String(leadScore?.lastScoredAt || leadScore?.leadScore || ''),
    String(eventCount),
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 64);
}

function emptyFacts() {
  return {
    state: NOT_COLLECTED,
    language: NOT_COLLECTED,
    stream: NOT_COLLECTED,
    rank: NOT_COLLECTED,
    budget: NOT_COLLECTED,
    parentInvolvement: UNKNOWN,
    preferredColleges: NOT_COLLECTED,
    previousBookings: NOT_COLLECTED,
  };
}

function buildStudentGoal({ handoff, profile, events, leadContext }) {
  const branch =
    latestEventValue(events, 'branch_preference') ||
    latestEventValue(events, 'program_interest') ||
    profile?.branchInterest;
  if (branch) return `${branch} admission guidance`;
  if (profile?.exam) return `${profile.exam} counselling support`;
  if (handoff?.productLine === 'iit_counselling') return 'IIT counselling';
  if (handoff?.reason === 'reopened' || handoff?.isReopened) return 'Follow-up on prior counselling request';
  if (handoff?.reason === 'user_requested') return 'Speak with a counsellor';
  return pick(handoff?.summaryForAgent?.split('\n')[0], NOT_COLLECTED);
}

function buildCurrentConcern({ handoff, events, transcript }) {
  if (handoff?.reason === 'low_confidence') return 'Needs clarification; bot had low confidence';
  if (latestEventValue(events, 'handoff_requested') || handoff?.reason === 'user_requested') {
    return 'Counsellor call / human agent request';
  }
  if (latestEventValue(events, 'price_sensitivity') || profilePriceSensitive(events)) {
    return 'Fee affordability / scholarship interest';
  }
  const messages = transcript?.messages || [];
  const lastInbound = [...messages].reverse().find((m) => m.direction === 'in');
  if (lastInbound?.text) return String(lastInbound.text).trim().slice(0, 200);
  if (handoff?.userLastMessage) return String(handoff.userLastMessage).trim().slice(0, 200);
  return NOT_COLLECTED;
}

function profilePriceSensitive(events) {
  return events.some((e) => e.type === 'price_sensitivity');
}

function buildImportantFacts({ profile, events, leadContext, iitExtras }) {
  const facts = emptyFacts();
  facts.language =
    pick(profile?.languagePreference, NOT_COLLECTED) !== NOT_COLLECTED
      ? pick(profile.languagePreference)
      : pick(leadContext?.iit?.preferredLanguage, NOT_COLLECTED);

  facts.state = pick(iitExtras?.city || leadContext?.iit?.city, NOT_COLLECTED);
  facts.stream = pick(iitExtras?.stream, NOT_COLLECTED);
  facts.rank = pick(latestEventValue(events, 'rank_mentioned'), NOT_COLLECTED);
  facts.budget = profile?.priceSensitive ? 'Price sensitive (mentioned)' : NOT_COLLECTED;

  const studentOrParent = iitExtras?.studentOrParent;
  facts.parentInvolvement = studentOrParent === 'Parent' ? 'Parent involved' : studentOrParent === 'Student' ? 'Student direct' : UNKNOWN;

  const college =
    latestEventValue(events, 'college_preference') || profile?.collegeInterest || iitExtras?.topColleges;
  facts.preferredColleges = pick(college, NOT_COLLECTED);

  const bookings = [];
  if (leadContext?.iit?.slotBooking) bookings.push(`IIT slot: ${leadContext.iit.slotBooking}`);
  if (leadContext?.gx?.slotDateLabel) {
    bookings.push(`GX demo: ${leadContext.gx.slotDateLabel} ${leadContext.gx.slotTimeLabel || ''}`.trim());
  }
  facts.previousBookings = bookings.length ? bookings.join('; ') : NOT_COLLECTED;

  return facts;
}

function buildLeadQualitySection(score) {
  if (!score || score.leadScore == null) {
    return {
      score: NOT_COLLECTED,
      stage: NOT_COLLECTED,
      confidence: NOT_COLLECTED,
    };
  }
  const conf =
    score.confidence != null && !Number.isNaN(Number(score.confidence))
      ? `${Math.round(Number(score.confidence) * 100)}%`
      : NOT_COLLECTED;
  return {
    score: String(score.leadScore),
    stage: pick(score.leadStage, NOT_COLLECTED),
    confidence: conf,
  };
}

function buildPreviousInteractions({ priorHandoffs = [], internalNotes = [], auditTrail = [] }) {
  const parts = [];
  const resolved = priorHandoffs.filter((h) => h.status === 'resolved');
  if (resolved.length) {
    parts.push(`${resolved.length} prior resolved handoff(s) on this lead`);
  }
  const reopened = priorHandoffs.filter((h) => h.isReopened || h.reason === 'reopened');
  if (reopened.length) {
    parts.push('Previously reopened conversation');
  }
  const noteSnippet = (internalNotes || [])
    .slice(-2)
    .map((n) => String(n.text || '').trim())
    .filter(Boolean);
  if (noteSnippet.length) {
    parts.push(`Internal notes: ${noteSnippet.join('; ').slice(0, 180)}`);
  }
  const auditBits = (auditTrail || [])
    .filter((a) => ['resolved', 'reopened', 'replied'].includes(a.action))
    .slice(-3)
    .map((a) => a.action);
  if (auditBits.length) {
    parts.push(`Recent activity: ${auditBits.join(', ')}`);
  }
  return parts.length ? parts.join('. ') + '.' : NOT_COLLECTED;
}

function buildRecommendedNextAction({ concern, leadQuality, handoff, profile }) {
  const stage = String(leadQuality?.stage || '').toLowerCase();
  const concernLower = String(concern || '').toLowerCase();

  if (concernLower.includes('counsellor') || concernLower.includes('human') || handoff?.reason === 'user_requested') {
    return 'Arrange counsellor call and acknowledge wait time';
  }
  if (concernLower.includes('scholarship') || concernLower.includes('fee') || profile?.priceSensitive) {
    return 'Discuss scholarship options and fee structure';
  }
  if (concernLower.includes('hostel')) {
    return 'Explain hostel facilities and next steps';
  }
  if (stage === 'hot') {
    return 'Prioritize personal follow-up and schedule counsellor call';
  }
  if (handoff?.reason === 'low_confidence') {
    return 'Clarify student question and provide accurate guidance';
  }
  if (handoff?.status === 'resolved' || handoff?.copilotState === 'resolved') {
    return 'Continue normal chatbot flow unless student asks again';
  }
  return 'Respond to latest message and confirm next step with student';
}

function buildStructuredSummaryFromRules(ctx) {
  const {
    handoff = {},
    leadDetails = {},
    transcript = {},
    leadContext = null,
    priorHandoffs = [],
    iitExtras = null,
  } = ctx;

  const profile = leadDetails.profile || null;
  const score = leadDetails.score || null;
  const events = flattenEventRows(leadDetails.recentEvents || []);

  const studentGoal = buildStudentGoal({ handoff, profile, events, leadContext });
  const currentConcern = buildCurrentConcern({ handoff, events, transcript, profile });
  const importantFacts = buildImportantFacts({ profile, events, leadContext, iitExtras });
  const leadQuality = buildLeadQualitySection(score);
  const previousInteractions = buildPreviousInteractions({
    priorHandoffs,
    internalNotes: handoff.internalNotes,
    auditTrail: handoff.auditTrail,
  });
  const recommendedNextAction = buildRecommendedNextAction({
    concern: currentConcern,
    leadQuality,
    handoff,
    profile,
  });

  return {
    studentGoal: pick(studentGoal, NOT_COLLECTED),
    currentConcern: pick(currentConcern, NOT_COLLECTED),
    importantFacts,
    leadQuality,
    previousInteractions,
    recommendedNextAction,
    source: 'rules',
    generatedAt: new Date(),
  };
}

function formatStructuredSummaryText(summary) {
  if (!summary) return '';
  const f = summary.importantFacts || emptyFacts();
  const lq = summary.leadQuality || {};
  const lines = [
    `Student Goal:\n${summary.studentGoal || NOT_COLLECTED}`,
    `Current Concern:\n${summary.currentConcern || NOT_COLLECTED}`,
    'Important Facts:',
    `State: ${f.state}`,
    `Language: ${f.language}`,
    `Stream: ${f.stream}`,
    `Rank: ${f.rank}`,
    `Budget: ${f.budget}`,
    `Parent involvement: ${f.parentInvolvement}`,
    `Preferred colleges: ${f.preferredColleges}`,
    `Previous bookings: ${f.previousBookings}`,
    `Lead Quality:\nScore ${lq.score || NOT_COLLECTED} (${lq.stage || NOT_COLLECTED}), Confidence ${lq.confidence || NOT_COLLECTED}`,
    `Previous Interactions:\n${summary.previousInteractions || NOT_COLLECTED}`,
    `Recommended Next Action:\n${summary.recommendedNextAction || NOT_COLLECTED}`,
  ];
  return lines.join('\n\n').slice(0, 4000);
}

function parseLlmSummaryJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function mergeLlmSummary(rulesSummary, llmParsed) {
  if (!llmParsed || typeof llmParsed !== 'object') return rulesSummary;
  const facts = { ...rulesSummary.importantFacts, ...(llmParsed.importantFacts || {}) };
  const lq = { ...rulesSummary.leadQuality, ...(llmParsed.leadQuality || {}) };
  return {
    studentGoal: pick(llmParsed.studentGoal, rulesSummary.studentGoal),
    currentConcern: pick(llmParsed.currentConcern, rulesSummary.currentConcern),
    importantFacts: facts,
    leadQuality: lq,
    previousInteractions: pick(llmParsed.previousInteractions, rulesSummary.previousInteractions),
    recommendedNextAction: pick(llmParsed.recommendedNextAction, rulesSummary.recommendedNextAction),
    source: 'llm',
    generatedAt: new Date(),
  };
}

async function enhanceWithLlm(rulesSummary, ctx) {
  if (!isCopilotSuggestedRepliesEnabled() || !String(process.env.LLM_API_KEY || '').trim()) {
    return null;
  }

  const contextBlock = JSON.stringify(
    {
      rulesSummary,
      summaryForAgent: ctx.handoff?.summaryForAgent,
      userLastMessage: ctx.handoff?.userLastMessage,
      productLine: ctx.handoff?.productLine,
      profile: ctx.leadDetails?.profile,
      score: ctx.leadDetails?.score,
      recentEvents: flattenEventRows(ctx.leadDetails?.recentEvents || []).slice(0, 12),
      transcript: (ctx.transcript?.messages || []).slice(-15),
      priorHandoffs: (ctx.priorHandoffs || []).slice(0, 5),
    },
    null,
    0
  ).slice(0, 12000);

  try {
    const completion = await provider.chatCompletion({
      messages: [
        { role: 'system', content: buildSummarySystemPrompt() },
        { role: 'user', content: `Improve this counsellor briefing using only the context below.\n\n${contextBlock}` },
      ],
      temperature: 0.4,
      maxTokens: 700,
      timeoutMs: 8000,
    });
    const parsed = parseLlmSummaryJson(completion.text);
    if (!parsed) return null;
    return mergeLlmSummary(rulesSummary, parsed);
  } catch (err) {
    console.warn('[humanCopilotSummaryV2] LLM enhance failed', err?.message || err);
    return null;
  }
}

async function persistSummary(handoffId, summary, cacheKey) {
  const text = formatStructuredSummaryText(summary);
  await WhatsAppAgentHandoff.updateOne(
    { _id: handoffId },
    {
      $set: {
        copilotStructuredSummary: summary,
        copilotSummaryCacheKey: cacheKey,
        copilotAiSummary: text,
      },
    }
  );
}

async function loadPriorHandoffs(phone, excludeHandoffId, limit = 5) {
  return WhatsAppAgentHandoff.find({
    phone,
    route: 'admin_pool',
    _id: { $ne: excludeHandoffId },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('status reason resolvedAt isReopened createdAt summaryForAgent')
    .lean();
}

async function ensureStructuredSummary(handoff, ctx) {
  const eventRows = flattenEventRows(ctx.leadDetails?.recentEvents || []);
  const cacheKey = buildSummaryCacheKey({
    handoffId: handoff._id,
    transcript: ctx.transcript,
    internalNotesCount: (handoff.internalNotes || []).length,
    leadScore: ctx.leadDetails?.score,
    eventCount: eventRows.length,
  });

  if (
    handoff.copilotStructuredSummary &&
    handoff.copilotSummaryCacheKey === cacheKey
  ) {
    return {
      structuredSummary: handoff.copilotStructuredSummary,
      summarySource: handoff.copilotStructuredSummary.source || 'rules',
      summaryCached: true,
      aiSummary: handoff.copilotAiSummary || formatStructuredSummaryText(handoff.copilotStructuredSummary),
    };
  }

  const rulesSummary = buildStructuredSummaryFromRules(ctx);
  let finalSummary = rulesSummary;

  const llmSummary = await enhanceWithLlm(rulesSummary, ctx);
  if (llmSummary) {
    finalSummary = llmSummary;
  }

  await persistSummary(handoff._id, finalSummary, cacheKey);

  return {
    structuredSummary: finalSummary,
    summarySource: finalSummary.source || 'rules',
    summaryCached: false,
    aiSummary: formatStructuredSummaryText(finalSummary),
  };
}

module.exports = {
  UNKNOWN,
  NOT_COLLECTED,
  buildSummaryCacheKey,
  flattenEventRows,
  buildStructuredSummaryFromRules,
  enhanceWithLlm,
  ensureStructuredSummary,
  formatStructuredSummaryText,
  loadPriorHandoffs,
};
