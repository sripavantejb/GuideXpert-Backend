'use strict';

/** Canonical lifecycle stages (ordered). */
const LIFECYCLE_STAGES = Object.freeze([
  'lead',
  'qualified',
  'interested',
  'booked',
  'attended',
  'admission',
]);

const STAGE_RANK = Object.freeze(
  LIFECYCLE_STAGES.reduce((acc, stage, index) => {
    acc[stage] = index;
    return acc;
  }, {})
);

const PRODUCT_LINES = Object.freeze([
  'registration',
  'oneOnOne',
  'iit',
  'whatsapp',
  'copilot',
]);

const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);

/** Registration (FormSubmission) */
const REGISTRATION_SLOT_BOOKED_OR = Object.freeze([
  { isRegistered: true },
  { 'step3Data.selectedSlot': { $exists: true, $nin: [null, ''] } },
  { selectedSlot: { $exists: true, $nin: [null, ''] } },
]);

/** One-on-one */
const ONE_ON_ONE_CONTACTED_STATUSES = Object.freeze([
  'Contacted',
  'Demo Booked',
  'Counseling Done',
  'Converted',
]);

const ONE_ON_ONE_ATTENDED_STATUSES = Object.freeze(['Counseling Done', 'Converted']);

/** IIT CRM */
const IIT_CALL_CONNECTED = Object.freeze(['call_connected', 'connected']);

const IIT_INTERESTED_STATUSES = Object.freeze(['interested', 'maybe']);

const IIT_DEMO_SCHEDULED = Object.freeze(['demo_scheduled', 'scheduled', 'rescheduled']);

const IIT_DEMO_ATTENDED = Object.freeze(['attended']);

const IIT_ADMISSION_PAYMENT = Object.freeze(['amount_paid', 'paid', 'partially_paid']);

const IIT_ADMISSION_NIAT = Object.freeze(['registered']);

const IIT_ADMISSION_LEAD = Object.freeze(['converted']);

/** WhatsApp scoring */
const WHATSAPP_WARM_STAGES = Object.freeze(['warm', 'hot']);

const WHATSAPP_HOT_STAGES = Object.freeze(['hot']);

/** Copilot handoff */
const COPILOT_ASSIGNED_STATES = Object.freeze(['assigned', 'active']);

function rankStage(stage) {
  return STAGE_RANK[stage] ?? -1;
}

function maxStage(stages = []) {
  let best = null;
  let bestRank = -1;
  for (const stage of stages) {
    const r = rankStage(stage);
    if (r > bestRank) {
      bestRank = r;
      best = stage;
    }
  }
  return best;
}

function stageAtOrAbove(current, target) {
  return rankStage(current) >= rankStage(target);
}

module.exports = {
  LIFECYCLE_STAGES,
  STAGE_RANK,
  PRODUCT_LINES,
  CONFIDENCE_LEVELS,
  REGISTRATION_SLOT_BOOKED_OR,
  ONE_ON_ONE_CONTACTED_STATUSES,
  ONE_ON_ONE_ATTENDED_STATUSES,
  IIT_CALL_CONNECTED,
  IIT_INTERESTED_STATUSES,
  IIT_DEMO_SCHEDULED,
  IIT_DEMO_ATTENDED,
  IIT_ADMISSION_PAYMENT,
  IIT_ADMISSION_NIAT,
  IIT_ADMISSION_LEAD,
  WHATSAPP_WARM_STAGES,
  WHATSAPP_HOT_STAGES,
  COPILOT_ASSIGNED_STATES,
  rankStage,
  maxStage,
  stageAtOrAbove,
};
