'use strict';

const { isLeadEventExtractionEnabled } = require('../services/chatbot/leadEventExtraction/leadEventExtractionFlags');

function getLeadEventExtractionConfigStatus() {
  const enabled = isLeadEventExtractionEnabled();
  const llmKeyPresent = Boolean(String(process.env.LLM_API_KEY || '').trim());
  const llmBaseUrlPresent = Boolean(String(process.env.LLM_BASE_URL || '').trim());
  const llmModelPresent = Boolean(String(process.env.LLM_MODEL || '').trim());
  const ready = enabled && llmKeyPresent && llmBaseUrlPresent && llmModelPresent;

  return {
    enabled,
    ready,
  };
}

function logLeadEventExtractionConfigStatus() {
  const status = getLeadEventExtractionConfigStatus();
  console.log({
    leadEventExtractionEnabled: process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED,
    leadEventExtractionReady: status.ready,
  });
  if (status.enabled && !status.ready) {
    console.warn(
      '[env] Lead event extraction not ready — set CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED=1 and LLM_API_KEY, LLM_BASE_URL, LLM_MODEL'
    );
  }
}

module.exports = {
  getLeadEventExtractionConfigStatus,
  logLeadEventExtractionConfigStatus,
};
