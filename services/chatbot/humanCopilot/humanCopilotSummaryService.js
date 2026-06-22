'use strict';

const {
  ensureStructuredSummary,
  formatStructuredSummaryText,
} = require('./humanCopilotSummaryV2Service');

/** @deprecated Use ensureStructuredSummary from humanCopilotSummaryV2Service */
async function ensureCopilotAiSummary(handoff, ctx) {
  const result = await ensureStructuredSummary(handoff, {
    leadDetails: ctx.leadDetails,
    handoff,
    transcript: ctx.transcript || { messages: [] },
    leadContext: ctx.leadContext || null,
    priorHandoffs: ctx.priorHandoffs || [],
    iitExtras: ctx.iitExtras || null,
  });
  return result.aiSummary;
}

module.exports = {
  ensureCopilotAiSummary,
  ensureStructuredSummary,
  formatStructuredSummaryText,
};
