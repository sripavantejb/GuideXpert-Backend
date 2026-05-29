const { maskPhoneTail } = require('../../utils/chatbotPhone');

const SECRET_KEY_PATTERN = /secret|token|password|apikey|api_key|authorization/i;

/**
 * Structured chatbot log line (JSON). Never pass secrets or full phone numbers.
 * @param {string} event
 * @param {object} fields
 */
function logChatbotEvent(event, fields = {}) {
  const payload = {
    event: String(event || 'chatbot'),
    conversationId: fields.conversationId != null ? String(fields.conversationId) : null,
    phoneTail: fields.phoneTail ?? (fields.phone10 ? maskPhoneTail(fields.phone10) : null),
    intent: fields.intent ?? null,
    botState: fields.botState ?? null,
    productLine: fields.productLine ?? null,
    predictorExam: fields.predictorExam ?? null,
    upstreamStatus: fields.upstreamStatus ?? null,
    durationMs: fields.durationMs ?? null,
  };

  if (fields.errMessage) {
    payload.errMessage = String(fields.errMessage).slice(0, 500);
  }

  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    if (key in payload) continue;
    if (key === 'phone10') continue;
    if (value == null) continue;
    if (typeof value === 'object') continue;
    payload[key] = value;
  }

  console.info('[chatbot:structured]', JSON.stringify(payload));
}

function extractPredictorExam(contextPatch = {}) {
  if (contextPatch.college?.exam) return contextPatch.college.exam;
  if (contextPatch.rank?.examId) return contextPatch.rank.examId;
  return null;
}

module.exports = {
  logChatbotEvent,
  extractPredictorExam,
};
