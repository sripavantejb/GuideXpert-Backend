'use strict';

const ALERT_TYPES = Object.freeze([
  'hot_lead_inactivity',
  'unassigned_high_value_lead',
  'counsellor_overload',
  'conversion_drop',
  'operational_health',
]);

const ALERT_SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low']);

const ALERT_STATUSES = Object.freeze(['open', 'acknowledged', 'resolved']);

const OPEN_ALERT_STATUSES = Object.freeze(['open', 'acknowledged']);

const HOT_LEAD_INACTIVITY_DAYS = 3;
const COUNSELLOR_OVERLOAD_ASSIGNED_THRESHOLD = 15;
const CONVERSION_DROP_THRESHOLD_PCT = 15;
const OPERATIONAL_ACTIVE_HANDOFF_THRESHOLD = 25;
const OPERATIONAL_SLOW_RESPONSE_MS = 4 * 60 * 60 * 1000;

module.exports = {
  ALERT_TYPES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  OPEN_ALERT_STATUSES,
  HOT_LEAD_INACTIVITY_DAYS,
  COUNSELLOR_OVERLOAD_ASSIGNED_THRESHOLD,
  CONVERSION_DROP_THRESHOLD_PCT,
  OPERATIONAL_ACTIVE_HANDOFF_THRESHOLD,
  OPERATIONAL_SLOW_RESPONSE_MS,
};
