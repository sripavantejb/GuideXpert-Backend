'use strict';

const {
  IIT_CALL_CONNECTED,
  IIT_INTERESTED_STATUSES,
  IIT_DEMO_SCHEDULED,
  IIT_DEMO_ATTENDED,
  IIT_ADMISSION_PAYMENT,
  IIT_ADMISSION_NIAT,
  IIT_ADMISSION_LEAD,
} = require('../../constants/leadLifecycle');

const ACTIVITY_FIELD_MAP = Object.freeze({
  callStatus: 'call_status',
  leadStatus: 'lead_status',
  demoStatus: 'demo_status',
  niatStatus: 'niat_status',
  paymentStatus: 'payment_status',
});

const HISTORY_FIELD_MAP = Object.freeze({
  callStatus: 'callStatus',
  leadStatus: 'leadStatus',
  demoStatus: 'demoStatus',
  niatStatus: 'niatRegistrationStatus',
  paymentStatus: 'paymentStatus',
});

function sortByCreatedAt(rows = []) {
  return [...rows].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/**
 * Find first admin CRM activity transition to one of `toValues`.
 */
function findActivityTransition(activities, field, toValues) {
  const eventType = ACTIVITY_FIELD_MAP[field];
  if (!eventType) return null;
  const allowed = new Set(toValues);
  const hit = sortByCreatedAt(activities).find(
    (a) => a.eventType === eventType && allowed.has(a.toValue)
  );
  if (!hit) return null;
  return {
    at: hit.createdAt,
    proxyField: 'IitCounsellingLeadActivity.createdAt',
    confidence: 'high',
    inferred: false,
  };
}

/**
 * Replay BDA LeadCallHistory snapshots for first time field enters `toValues`.
 */
function findHistoryTransition(history, field, toValues) {
  const key = HISTORY_FIELD_MAP[field];
  if (!key) return null;
  const allowed = new Set(toValues);
  let prev = null;
  for (const row of sortByCreatedAt(history)) {
    const val = row[key] || '';
    if (allowed.has(val) && !allowed.has(prev || '')) {
      return {
        at: row.createdAt,
        proxyField: 'LeadCallHistory.createdAt',
        confidence: 'medium',
        inferred: true,
      };
    }
    prev = val;
  }
  return null;
}

/**
 * Resolve transition timestamp from activity log, call history, or current-state fallback.
 */
function resolveIitTransition({
  field,
  toValues,
  activities = [],
  history = [],
  currentValue,
  fallbackAt,
  fallbackField = 'crmUpdatedAt',
}) {
  const fromActivity = findActivityTransition(activities, field, toValues);
  if (fromActivity) return fromActivity;

  const fromHistory = findHistoryTransition(history, field, toValues);
  if (fromHistory) return fromHistory;

  if (currentValue && toValues.includes(currentValue) && fallbackAt) {
    return {
      at: fallbackAt,
      proxyField: fallbackField,
      confidence: 'low',
      inferred: true,
      note: 'current_state_snapshot',
    };
  }
  return null;
}

function resolveIitQualified(activities, history, callStatus, fallbackAt) {
  return resolveIitTransition({
    field: 'callStatus',
    toValues: IIT_CALL_CONNECTED,
    activities,
    history,
    currentValue: callStatus,
    fallbackAt,
  });
}

function resolveIitInterested(activities, history, leadStatus, fallbackAt) {
  return resolveIitTransition({
    field: 'leadStatus',
    toValues: IIT_INTERESTED_STATUSES,
    activities,
    history,
    currentValue: leadStatus,
    fallbackAt,
  });
}

function resolveIitBooked(activities, history, demoStatus, fallbackAt, slotInstantUtc) {
  const crm = resolveIitTransition({
    field: 'demoStatus',
    toValues: IIT_DEMO_SCHEDULED,
    activities,
    history,
    currentValue: demoStatus,
    fallbackAt,
  });
  if (crm) return crm;
  if (slotInstantUtc) {
    return {
      at: slotInstantUtc,
      proxyField: 'counsellingSlotInstantUtc',
      confidence: 'medium',
      inferred: true,
    };
  }
  return null;
}

function resolveIitAttended(activities, history, demoStatus, fallbackAt) {
  return resolveIitTransition({
    field: 'demoStatus',
    toValues: IIT_DEMO_ATTENDED,
    activities,
    history,
    currentValue: demoStatus,
    fallbackAt,
  });
}

function resolveIitAdmission({
  activities,
  history,
  leadStatus,
  paymentStatus,
  niatStatus,
  fallbackAt,
}) {
  const payment = resolveIitTransition({
    field: 'paymentStatus',
    toValues: IIT_ADMISSION_PAYMENT,
    activities,
    history,
    currentValue: paymentStatus,
    fallbackAt,
  });
  if (payment) return { ...payment, admissionKind: 'payment' };

  const niat = resolveIitTransition({
    field: 'niatStatus',
    toValues: IIT_ADMISSION_NIAT,
    activities,
    history,
    currentValue: niatStatus,
    fallbackAt,
  });
  if (niat) return { ...niat, admissionKind: 'niat' };

  const converted = resolveIitTransition({
    field: 'leadStatus',
    toValues: IIT_ADMISSION_LEAD,
    activities,
    history,
    currentValue: leadStatus,
    fallbackAt,
  });
  if (converted) return { ...converted, admissionKind: 'converted' };

  return null;
}

module.exports = {
  findActivityTransition,
  findHistoryTransition,
  resolveIitTransition,
  resolveIitQualified,
  resolveIitInterested,
  resolveIitBooked,
  resolveIitAttended,
  resolveIitAdmission,
};
