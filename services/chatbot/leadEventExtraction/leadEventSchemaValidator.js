'use strict';

const { LEAD_EVENT_TYPE_SET, MIN_CONFIDENCE } = require('./leadEventExtractionConstants');

function stripMarkdownFences(text) {
  const value = String(text || '').trim();
  if (!value.startsWith('```')) return value;
  return value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

function parseExtractionJson(rawText) {
  const cleaned = stripMarkdownFences(rawText);
  if (!cleaned) {
    return { payload: null, rawJson: '', error: 'empty_response' };
  }
  try {
    return { payload: JSON.parse(cleaned), rawJson: cleaned, error: null };
  } catch (error) {
    return { payload: null, rawJson: cleaned, error: error.message };
  }
}

function normalizeEvent(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const type = String(entry.type || '').trim();
  const value = String(entry.value || '').trim();
  const evidence = String(entry.evidence || '').trim();
  const confidence = Number(entry.confidence);

  if (!LEAD_EVENT_TYPE_SET.has(type)) return null;
  if (!value || !evidence) return null;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (confidence < MIN_CONFIDENCE) return null;

  return { type, value, confidence, evidence };
}

function validateExtractedEvents(rawText) {
  const { payload, rawJson, error } = parseExtractionJson(rawText);
  if (error) {
    return { events: [], rawJson, valid: false, reason: 'parse_error' };
  }

  const list = Array.isArray(payload?.events) ? payload.events : [];
  const events = list.map(normalizeEvent).filter(Boolean);

  if (!events.length) {
    return {
      events: [],
      rawJson,
      valid: list.length === 0,
      reason: list.length > 0 ? 'no_valid_events' : 'empty_events',
    };
  }

  return { events, rawJson, valid: true, reason: null };
}

module.exports = {
  stripMarkdownFences,
  parseExtractionJson,
  validateExtractedEvents,
};
