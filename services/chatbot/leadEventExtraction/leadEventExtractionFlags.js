'use strict';

function isLeadEventExtractionEnabled() {
  return String(process.env.CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED || '').trim() === '1';
}

module.exports = {
  isLeadEventExtractionEnabled,
};
