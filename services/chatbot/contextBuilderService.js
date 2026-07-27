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
  const booking = leadContext.bookingContext || leadContext.booking || {};

  const crmContext = {
    name: cleanValue(booking.fullName) || cleanValue(iit.fullName) || cleanValue(gx.fullName),
    productLine: cleanValue(leadContext.productLine),
    hasActiveBooking: booking.exists || leadContext.hasBooking ? 'true' : 'false',
    bookingId: cleanValue(booking.bookingId),
    bookingStatus: cleanValue(booking.bookingStatus),
    sessionSlot: cleanValue(booking.sessionSlotLabel) || cleanValue(iit.slotBooking),
    sessionDate: cleanValue(booking.sessionDate),
    sessionTime: cleanValue(booking.sessionTime),
    sessionDateTime:
      cleanValue(booking.sessionInstantLabel) || cleanValue(iit.slotInstantLabel),
    meetingLink: cleanValue(booking.meetingLink) || cleanValue(leadContext.meetingLink),
    counsellingStatus:
      cleanValue(booking.demoStatusLabel) ||
      cleanValue(iit.callStatusLabel) ||
      cleanValue(iit.demoStatusLabel) ||
      cleanValue(iit.currentStep) ||
      cleanValue(gx.currentStep),
    assignedCounsellor:
      cleanValue(booking.assignedCounsellor) || cleanValue(iit.assignedBdaName),
    lifecycleStage:
      cleanValue(booking.lifecycleStage) || cleanValue(booking.leadStatusLabel),
    preferredCollege: cleanValue(booking.preferredCollege),
    preferredBranch: cleanValue(booking.preferredBranch),
    state: cleanValue(booking.state) || cleanValue(booking.city),
    examRegistration: cleanValue(booking.exam),
    rankSubmitted: cleanValue(booking.rank),
    categorySelected: cleanValue(booking.category),
    humanCopilotActive: booking.humanCopilot?.active ? 'true' : 'false',
    rankPredictorStatus: gx.rankPredictorLead ? 'available' : null,
    collegePredictorStatus: leadContext.collegePredictorStatus ? 'available' : null,
    websiteBookingOnly:
      'Counselling bookings are created on the GuideXpert website only. Never confirm or create bookings in chat unless hasActiveBooking is true.',
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

function formatUnifiedContext(context, options = {}) {
  const includeConversationContext = options.includeConversationContext !== false;
  const knowledgeContext =
    context.knowledgeContext ||
    'No relevant knowledge entries were found for this question.';

  const sections = [
    'Unified Context',
    '',
    'CRM Context:',
    formatCrmContext(context.crmContext),
  ];

  if (includeConversationContext) {
    const conversationContext = context.conversationContext || 'No previous conversation context.';
    sections.push('', 'Conversation Context:', conversationContext);
  }

  sections.push('', 'Knowledge Context:', knowledgeContext);
  return sections.join('\n');
}

module.exports = {
  buildContext,
  buildCrmContext,
  buildConversationContext,
  formatUnifiedContext,
};
