'use strict';

const COPILOT_STATES = Object.freeze([
  'pending',
  'assigned',
  'active',
  'resolved',
  'reopened',
]);

const COPILOT_REPLY_STATUSES = Object.freeze([
  'draft',
  'sending',
  'submitted',
  'sent',
  'delivered',
  'read',
  'failed',
  'simulated',
]);

const COPILOT_REPLY_SOURCES = Object.freeze(['manual', 'ai_used', 'ai_edited']);

const COPILOT_AUDIT_ACTIONS = Object.freeze([
  'assigned',
  'reassigned',
  'released',
  'replied',
  'reply_failed',
  'reply_retried',
  'reply_delivered',
  'reply_read',
  'resolved',
  'reopened',
  'note_added',
  'suggest_requested',
  'followup_suggested',
  'followup_sent',
  'followup_skipped',
  'followup_replied',
  'auto_assigned',
  'routing_skipped',
  'routing_overload',
]);

/** Allowed copilotState transitions */
const COPILOT_STATE_TRANSITIONS = Object.freeze({
  pending: ['assigned', 'active', 'resolved'],
  assigned: ['active', 'resolved'],
  active: ['resolved'],
  resolved: ['reopened', 'pending'],
  reopened: ['assigned', 'active', 'resolved'],
});

const COPILOT_QUEUE_STATES = Object.freeze(['pending', 'assigned', 'active', 'reopened']);

const ALERT_REASONS = Object.freeze([
  'human_requested',
  'low_confidence',
  'hot_lead',
  'reopened',
]);

function canTransitionCopilotState(from, to) {
  if (!from) return COPILOT_STATES.includes(to);
  const allowed = COPILOT_STATE_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function inferCopilotState(handoff) {
  if (!handoff) return 'pending';
  if (handoff.copilotState && COPILOT_STATES.includes(handoff.copilotState)) {
    return handoff.copilotState;
  }
  if (handoff.status === 'resolved') return 'resolved';
  if (handoff.isReopened || handoff.reason === 'reopened') return 'reopened';
  if (handoff.status === 'claimed' && handoff.lastAgentMessageAt) return 'active';
  if (handoff.assignedSrCounsellor) return 'assigned';
  return 'pending';
}

module.exports = {
  COPILOT_STATES,
  COPILOT_REPLY_STATUSES,
  COPILOT_REPLY_SOURCES,
  COPILOT_AUDIT_ACTIONS,
  COPILOT_STATE_TRANSITIONS,
  COPILOT_QUEUE_STATES,
  ALERT_REASONS,
  canTransitionCopilotState,
  inferCopilotState,
};
