'use strict';

const { logChatbotEvent } = require('../chatbotStructuredLog');

function maskBearerToken(token) {
  if (!token) return null;
  const s = String(token).trim();
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function previewText(text, max = 240) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function classifyPredictorError(err) {
  if (!err) return 'unknown';
  const status = err.http_status_code ?? err.statusCode ?? null;
  const code = err.res_status || err.code || null;
  if (status === 401 || status === 403 || code === 'UNAUTHORIZED') return 'authentication_error';
  if (status === 400 || code === 'INVALID_INPUT_FORMAT' || code === 'INVALID_ENTRANCE_EXAM') {
    return 'payload_error';
  }
  if (err.code === 'ECONNABORTED' || /timed out/i.test(String(err.message || ''))) return 'timeout';
  if (status === 503 || code === 'SERVICE_UNAVAILABLE') return 'upstream_unavailable';
  if (status != null && status >= 400) return 'upstream_api_error';
  if (/format|parse/i.test(String(err.message || ''))) return 'parser_error';
  return 'predictor_error';
}

function logPredictorPipeline(event, fields = {}) {
  const payload = { pipeline: 'college_predictor', ...fields };
  if (payload.authorizationMasked == null && payload.accessTokenMasked != null) {
    payload.authorizationMasked = payload.accessTokenMasked;
    delete payload.accessTokenMasked;
  }
  logChatbotEvent(event, payload);
}

module.exports = {
  maskBearerToken,
  previewText,
  classifyPredictorError,
  logPredictorPipeline,
};
