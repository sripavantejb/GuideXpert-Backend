'use strict';

const COPILOT_AGENT_ROLES = Object.freeze([
  'sr_counsellor',
  'iit_expert',
  'scholarship_expert',
  'general_counsellor',
  'admin',
]);

const COPILOT_AVAILABILITY = Object.freeze(['active', 'away', 'offline']);

const COPILOT_ROUTING_MODES = Object.freeze([
  'manual',
  'round_robin',
  'least_workload',
  'specialty',
]);

const LEGACY_SLOTS = Object.freeze(['sr1', 'sr2']);

const DEFAULT_MAX_CONCURRENT = 5;

const SPECIALTY_TOPIC_MAP = Object.freeze({
  scholarship: 'scholarship',
  college_selection: 'iit',
  rank_guidance: 'iit',
  branch_selection: 'iit',
});

const ROLE_BY_SPECIALTY = Object.freeze({
  iit: 'iit_expert',
  scholarship: 'scholarship_expert',
  general: 'general_counsellor',
});

const FALLBACK_ROLE = 'general_counsellor';

const ROLE_LABELS = Object.freeze({
  sr_counsellor: 'SR Counsellor',
  iit_expert: 'IIT Expert',
  scholarship_expert: 'Scholarship Expert',
  general_counsellor: 'General Counsellor',
  admin: 'Admin',
});

const ROUTING_MODE_LABELS = Object.freeze({
  manual: 'Manual assignment',
  round_robin: 'Round robin',
  least_workload: 'Least workload',
  specialty: 'Specialty routing',
});

module.exports = {
  COPILOT_AGENT_ROLES,
  COPILOT_AVAILABILITY,
  COPILOT_ROUTING_MODES,
  LEGACY_SLOTS,
  DEFAULT_MAX_CONCURRENT,
  SPECIALTY_TOPIC_MAP,
  ROLE_BY_SPECIALTY,
  FALLBACK_ROLE,
  ROLE_LABELS,
  ROUTING_MODE_LABELS,
};
