'use strict';

const { buildSystemPrompt } = require('../../ai/prompts/humanCopilot.system');
const { OpenAiCompatibleProvider } = require('../../ai/providers/OpenAiCompatibleProvider');
const { buildLeadContext } = require('../leadContextService');
const { getConversationTranscript } = require('../chatbotAdminService');
const { getLeadDetails } = require('../leadInsights/leadInsightsService');
const {
  isCopilotSuggestedRepliesEnabled,
} = require('./humanCopilotFlags');

const provider = new OpenAiCompatibleProvider();

function formatTranscriptForPrompt(messages = []) {
  return messages
    .slice(-20)
    .map((m) => {
      const who =
        m.direction === 'in'
          ? 'User'
          : m.senderType === 'agent'
            ? 'Counsellor'
            : 'Assistant';
      const text = String(m.text || '').trim();
      return text ? `${who}: ${text}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

function formatLeadContextBlock(leadDetails, handoff) {
  const parts = [];
  if (handoff?.summaryForAgent) {
    parts.push(`Handoff summary:\n${handoff.summaryForAgent}`);
  }
  if (leadDetails?.name) {
    parts.push(`Name: ${leadDetails.name}`);
  }
  if (leadDetails?.profile) {
    const p = leadDetails.profile;
    if (p.branchInterest) parts.push(`Branch interest: ${p.branchInterest}`);
    if (p.collegeInterest) parts.push(`College interest: ${p.collegeInterest}`);
    if (p.exam) parts.push(`Exam: ${p.exam}`);
    if (p.languagePreference) parts.push(`Language: ${p.languagePreference}`);
  }
  if (leadDetails?.score) {
    const s = leadDetails.score;
    parts.push(`Lead score: ${s.leadScore} (${s.leadStage})`);
    if (Array.isArray(s.scoreReasons) && s.scoreReasons.length) {
      parts.push(`Score reasons: ${s.scoreReasons.join('; ')}`);
    }
  }
  if (Array.isArray(leadDetails?.recentEvents) && leadDetails.recentEvents.length) {
    const ev = leadDetails.recentEvents
      .slice(0, 8)
      .flatMap((row) =>
        (row.events || []).map((e) => `${e.type}: ${e.value || e.evidence || ''}`)
      )
      .filter(Boolean)
      .join('; ');
    if (ev) parts.push(`Recent signals: ${ev}`);
  }
  return parts.join('\n');
}

async function generateSuggestedReplies({ handoff, inboundText = null }) {
  if (!isCopilotSuggestedRepliesEnabled()) {
    return { success: false, error: 'suggested_replies_disabled' };
  }

  const llmKey = String(process.env.LLM_API_KEY || '').trim();
  if (!llmKey) {
    return { success: false, error: 'llm_not_configured' };
  }

  const transcriptData = await getConversationTranscript(handoff.conversationId, 80);
  const messages = transcriptData.messages || [];
  const lastInbound =
    inboundText ||
    [...messages].reverse().find((m) => m.direction === 'in')?.text ||
    handoff.userLastMessage ||
    '';

  const [leadContext, leadDetails] = await Promise.all([
    buildLeadContext({
      phone10: handoff.phone,
      productLine: handoff.productLine,
      formSubmissionId: handoff.formSubmissionId,
      iitCounsellingSubmissionId: handoff.iitCounsellingSubmissionId,
    }),
    getLeadDetails(handoff.phone),
  ]);

  const contextBlock = formatLeadContextBlock(leadDetails, handoff);
  const transcriptBlock = formatTranscriptForPrompt(messages);
  const userBlock = `Last user message to reply to:\n${lastInbound}\n\nConversation transcript:\n${transcriptBlock || '(empty)'}\n\nLead context:\n${contextBlock || '(minimal)'}\n\nProduct line: ${leadContext.productLine || handoff.productLine}`;

  try {
    const completion = await provider.chatCompletion({
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: userBlock },
      ],
      temperature: 0.7,
      maxTokens: 400,
      timeoutMs: Number(process.env.KNOWLEDGE_ASSISTANT_TIMEOUT_MS) || 12000,
    });

    const text = String(completion.text || '').trim().slice(0, 3500);
    if (!text) {
      return { success: false, error: 'empty_suggestion' };
    }

    return {
      success: true,
      suggestions: [{ text, model: completion.model || process.env.LLM_MODEL }],
      contextUsed: {
        hasProfile: Boolean(leadDetails?.profile),
        hasScore: Boolean(leadDetails?.score),
        eventCount: leadDetails?.recentEvents?.length || 0,
      },
    };
  } catch (err) {
    console.error('[humanCopilotSuggest]', err?.message || err);
    return { success: false, error: 'suggestion_failed' };
  }
}

module.exports = {
  generateSuggestedReplies,
  formatTranscriptForPrompt,
  formatLeadContextBlock,
};
