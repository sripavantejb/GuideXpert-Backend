'use strict';

const { logChatbotEvent } = require('../chatbot/chatbotStructuredLog');

function emitRecoveryEvent(event, fields = {}) {
  try {
    logChatbotEvent(event, {
      pipeline: 'conversation_recovery',
      ...fields,
    });
  } catch (_) {
    // never break recovery for analytics
  }
}

function logRecoveryEligible(fields) {
  emitRecoveryEvent('recovery_eligible', fields);
}
function logRecoveryScheduled(fields) {
  emitRecoveryEvent('recovery_scheduled', fields);
}
function logRecoverySent(fields) {
  emitRecoveryEvent('recovery_sent', fields);
}
function logRecoveryDelivered(fields) {
  emitRecoveryEvent('recovery_delivered', fields);
}
function logRecoveryRead(fields) {
  emitRecoveryEvent('recovery_read', fields);
}
function logRecoveryFailed(fields) {
  emitRecoveryEvent('recovery_failed', fields);
}
function logRecoveryReplied(fields) {
  emitRecoveryEvent('recovery_replied', fields);
}
function logConversationResumed(fields) {
  emitRecoveryEvent('conversation_resumed', fields);
}
function logJourneyResumed(fields) {
  emitRecoveryEvent('journey_resumed', fields);
}
function logJourneyCompletedAfterRecovery(fields) {
  emitRecoveryEvent('journey_completed_after_recovery', fields);
}
function logBookingCompletedAfterRecovery(fields) {
  emitRecoveryEvent('booking_completed_after_recovery', fields);
}
function logRecoveryOptOut(fields) {
  emitRecoveryEvent('recovery_opt_out', fields);
}
function logRecoveryStopped(fields) {
  emitRecoveryEvent('recovery_stopped', fields);
}

module.exports = {
  emitRecoveryEvent,
  logRecoveryEligible,
  logRecoveryScheduled,
  logRecoverySent,
  logRecoveryDelivered,
  logRecoveryRead,
  logRecoveryFailed,
  logRecoveryReplied,
  logConversationResumed,
  logJourneyResumed,
  logJourneyCompletedAfterRecovery,
  logBookingCompletedAfterRecovery,
  logRecoveryOptOut,
  logRecoveryStopped,
};
