'use strict';

const { ASSISTANT_TYPES } = require('../leadEventExtraction/leadEventExtractionConstants');

const STRING_FIELD_BY_EVENT_TYPE = Object.freeze({
  branch_preference: 'branchInterest',
  college_preference: 'collegeInterest',
  exam_mentioned: 'exam',
  language_preference: 'languagePreference',
});

const BOOLEAN_FIELD_BY_EVENT_TYPE = Object.freeze({
  price_sensitivity: 'priceSensitive',
  demo_interest: 'demoInterested',
  handoff_requested: 'handoffRequested',
});

function applyEventsToProfileFields(events = []) {
  const fields = {};

  for (const event of events) {
    const type = String(event?.type || '').trim();
    const value = String(event?.value || '').trim();
    const stringField = STRING_FIELD_BY_EVENT_TYPE[type];
    if (stringField && value) {
      fields[stringField] = value;
    }
    const booleanField = BOOLEAN_FIELD_BY_EVENT_TYPE[type];
    if (booleanField) {
      fields[booleanField] = true;
    }
  }

  return fields;
}

function buildProfileUpdateOps({
  phone,
  conversationId,
  events = [],
  assistantType = 'unknown',
  now = new Date(),
} = {}) {
  const eventFields = applyEventsToProfileFields(events);
  const $set = {
    phone,
    conversationId,
    lastInteractionAt: now,
    ...eventFields,
  };
  const $setOnInsert = {
    firstInteractionAt: now,
    metadata: {},
  };
  const update = {
    $set,
    $setOnInsert,
    $inc: { eventCount: events.length },
  };

  if (assistantType && assistantType !== 'unknown') {
    update.$addToSet = { assistantTypesUsed: assistantType };
  }

  return update;
}

module.exports = {
  ASSISTANT_TYPES,
  STRING_FIELD_BY_EVENT_TYPE,
  BOOLEAN_FIELD_BY_EVENT_TYPE,
  applyEventsToProfileFields,
  buildProfileUpdateOps,
};
