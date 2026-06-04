'use strict';

const { buildKnowledgeContext } = require('./knowledgeContextBuilder');

function cleanValue(value) {
  const text = String(value || '').trim();
  return text || null;
}

function buildCrmContext(leadContext) {
  if (!leadContext || typeof leadContext !== 'object') {
    return null;
  }

  const iit = leadContext.iit || {};
  const gx = leadContext.gx || {};

  const crmContext = {
    name: cleanValue(iit.fullName) || cleanValue(gx.fullName),
    productLine: cleanValue(leadContext.productLine),
    counsellingStatus:
      cleanValue(iit.callStatusLabel) ||
      cleanValue(iit.demoStatusLabel) ||
      cleanValue(iit.currentStep) ||
      cleanValue(gx.currentStep),
    assignedCounsellor: cleanValue(iit.assignedBdaName),
    rankPredictorStatus: gx.rankPredictorLead ? 'available' : null,
    collegePredictorStatus: leadContext.collegePredictorStatus ? 'available' : null,
  };

  const filtered = Object.fromEntries(
    Object.entries(crmContext).filter(([, value]) => value !== null && value !== undefined)
  );
  return Object.keys(filtered).length ? filtered : null;
}

function buildConversationContext(history = []) {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }

  return history
    .slice(-10)
    .map((message) => {
      const role = message.role === 'assistant' ? 'Assistant' : 'User';
      const content = cleanValue(message.content);
      if (!content) return null;
      return `${role}: ${content}`;
    })
    .filter(Boolean)
    .join('\n');
}

function buildContext({ leadContext, knowledgeResults, history } = {}) {
  return {
    crmContext: buildCrmContext(leadContext),
    conversationContext: buildConversationContext(history),
    knowledgeContext: buildKnowledgeContext(knowledgeResults),
  };
}

function formatCrmContext(crmContext) {
  if (!crmContext) {
    return 'No CRM context available.';
  }

  return Object.entries(crmContext)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function formatUnifiedContext(context) {
  const knowledgeContext =
    context.knowledgeContext ||
    'No relevant knowledge entries were found for this question.';
  const conversationContext = context.conversationContext || 'No previous conversation context.';

  return [
    'Unified Context',
    '',
    'CRM Context:',
    formatCrmContext(context.crmContext),
    '',
    'Conversation Context:',
    conversationContext,
    '',
    'Knowledge Context:',
    knowledgeContext,
  ].join('\n');
}

module.exports = {
  buildContext,
  buildCrmContext,
  buildConversationContext,
  formatUnifiedContext,
};
