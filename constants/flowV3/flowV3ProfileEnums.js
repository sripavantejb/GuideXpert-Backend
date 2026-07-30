'use strict';

/**
 * Flow V3 — lead-profile enums (LEAD_PROFILE_CONTRACT.md §1-§2).
 *
 * ENFORCEMENT SCOPE: these enums are validated for V3-NEW fields only. The 75
 * legacy `LEAD_PROFILE_SCHEMA` slots keep their live types and their live value
 * space untouched — Flow V2 and the predictor read them, and narrowing a legacy
 * value space here would be a behaviour change to a frozen engine. Where a
 * contract enum disagrees with a live value space (e.g. `entryType`
 * fresher/repeater/transfer vs live regular/lateral/dropper) the contract list
 * is exported as `*_CONTRACT_VALUES` for documentation and is deliberately not
 * enforced.
 */

/** §2 slot meta — the source enum is exact and closed. */
const SLOT_META_SOURCES = Object.freeze([
  'button',
  'typed',
  'extracted',
  'inferred',
  'counsellor',
  'system',
]);

/** RULE A — authoritative sources. */
const AUTHORITATIVE_SOURCES = Object.freeze(['button', 'typed', 'extracted', 'counsellor']);

/** RULE A — non-authoritative sources. An inferred slot still counts as EMPTY. */
const NON_AUTHORITATIVE_SOURCES = Object.freeze(['inferred']);

/** §2 — `confidence` is required when source='inferred'. */
const CONFIDENCE_REQUIRED_SOURCES = Object.freeze(['inferred']);

/** §2 — `verbatimQuote` is required for anything derived from free text. */
const VERBATIM_REQUIRED_SOURCES = Object.freeze(['typed', 'extracted', 'inferred']);

/**
 * Write channels. A channel is WHO is writing, independent of slotMeta.source
 * (which records HOW the value was captured). The allowlist in §5 is a
 * channel-level rule: `llm_tool` is strictly weaker than every other channel.
 */
const WRITE_CHANNELS = Object.freeze(['llm_tool', 'extractor', 'button', 'system', 'counsellor']);
const LLM_WRITE_CHANNEL = 'llm_tool';
const SYSTEM_WRITE_CHANNEL = 'system';

/** §1.C examResults[].status */
const EXAM_RESULT_STATUSES = Object.freeze([
  'planned',
  'appeared',
  'result_awaited',
  'scored',
  'not_qualified',
]);

/** §1.G objections[].type */
const OBJECTION_TYPES = Object.freeze([
  'fee_too_high',
  'brand_unknown',
  'placement_doubt',
  'distance',
  'parent_disagreement',
  'coding_fear',
  'core_branch_preference',
  'accreditation_doubt',
  'competitor_better',
  'trust_deficit',
  'course_content',
  'hostel_safety',
  'roi_doubt',
  'other',
]);

const OBJECTION_STATUSES = Object.freeze([
  'open',
  'addressed',
  'resolved',
  'escalated',
  'unresolved_at_exit',
]);

/** Inferred and therefore non-authoritative (§1.G). */
const OBJECTION_SEVERITIES = Object.freeze(['blocking', 'significant', 'passing']);

/** §1.G competitorsMentioned[].context */
const COMPETITOR_CONTEXTS = Object.freeze([
  'comparing',
  'already_applied',
  'parent_prefers',
  'friend_attending',
  'rejected_it',
]);

/** §1.J shownArtifacts[].kind */
const SHOWN_ARTIFACT_KINDS = Object.freeze([
  'curated_shortlist',
  'predictor_list',
  'comparison',
  'checklist',
  'two_models_frame',
]);

/** §1.J shownArtifacts[].catalog — never both in one entry (P-4 / S-5). */
const SHOWN_ARTIFACT_CATALOGS = Object.freeze(['curated', 'predictor']);

/**
 * §1.I leadStage — MONOTONIC. Array order is the advance order; a write may
 * only move forward. `lost` and `parked` are reachable from any earlier stage
 * (they are outcomes, not progress), which is why the rank check treats them as
 * the highest ranks rather than as a separate lattice.
 */
const LEAD_STAGES = Object.freeze([
  'new',
  'engaged',
  'qualified',
  'shortlist_seen',
  'link_sent',
  'booked',
  'attended',
  'enrolled',
  'lost',
  'parked',
]);

/**
 * §1.I bookingStatus — the contract ladder is null → link_sent → done (S-4).
 * Live Flow V2 also writes 'not_started' and 'deferred'; both are rank 0
 * annotations so they can never overwrite a real advance.
 */
const BOOKING_STATUS_RANK = Object.freeze({
  null: 0,
  not_started: 0,
  deferred: 0,
  link_sent: 1,
  done: 2,
});

const EXIT_REASON_CONTRACT_VALUES = Object.freeze([
  'booked',
  'core_exit',
  'honest_pass',
  'out_of_scope',
  'opted_out',
  'silence',
  'crisis',
  'blocked_demographic',
]);

const PARKED_AS_VALUES = Object.freeze(['parked_core', 'parked_warm', 'parked_rank_list']);

const ACTIVE_HOUR_BUCKETS = Object.freeze(['school_hours', 'evening', 'late_night']);

const LOCALITY_VALUES = Object.freeze(['metro', 'tier2', 'tier3', 'rural']);
const PROXY_RELATION_VALUES = Object.freeze(['parent', 'sibling', 'relative', 'friend', 'teacher']);
const BOARD_VALUES = Object.freeze(['cbse', 'icse', 'state', 'ib', 'nios', 'other']);
const MEDIUM_VALUES = Object.freeze(['english', 'hindi', 'telugu', 'other']);
const MARKS12_STATUS_VALUES = Object.freeze(['final', 'predicted', 'awaiting']);
const MATH_COMFORT_VALUES = Object.freeze(['strong', 'ok', 'weak']);
const CODING_EXPOSURE_VALUES = Object.freeze(['none', 'school', 'self', 'bootcamp']);
const GOAL_CLARITY_VALUES = Object.freeze(['clear', 'exploring', 'no_idea']);
const HIGHER_STUDY_INTENT_VALUES = Object.freeze(['none', 'ms_abroad', 'mtech', 'mba', 'unsure']);
const DECISION_MAKER_VALUES = Object.freeze([
  'student',
  'father',
  'mother',
  'both_parents',
  'relative',
  'mentor',
  'joint',
]);
const PAYER_VALUES = Object.freeze(['parents', 'self', 'loan', 'scholarship', 'relative', 'mixed']);
const PARENT_INVOLVEMENT_VALUES = Object.freeze(['high', 'moderate', 'low']);
const PARENT_STANCE_VALUES = Object.freeze([
  'aligned',
  'wants_traditional',
  'wants_nearby',
  'wants_brand',
  'opposed',
  'unknown',
]);
const ADVISOR_INFLUENCE_VALUES = Object.freeze(['coaching', 'school', 'relative', 'online', 'none']);
const BUDGET_BASIS_VALUES = Object.freeze(['per_year', 'total']);
const BUDGET_SCOPE_VALUES = Object.freeze(['tuition_only', 'all_in']);
const BUDGET_FLEXIBILITY_VALUES = Object.freeze(['firm', 'stretchable', 'unknown']);
const LOAN_WILLINGNESS_VALUES = Object.freeze(['yes', 'no', 'maybe', 'unaware']);
const SCHOLARSHIP_DEPENDENCY_VALUES = Object.freeze(['essential', 'helpful', 'not_needed']);
const RELOCATION_WILLINGNESS_VALUES = Object.freeze([
  'anywhere',
  'same_state',
  'within_Nhrs',
  'home_city_only',
]);
const HOSTEL_PREFERENCE_VALUES = Object.freeze(['hostel', 'day_scholar', 'either']);
const TIMELINE_PRESSURE_VALUES = Object.freeze([
  'admissions_open',
  'deadline_weeks',
  'next_year',
  'browsing',
]);

/** Contract value spaces that disagree with a live legacy field — not enforced. */
const ENTRY_TYPE_CONTRACT_VALUES = Object.freeze([
  'fresher',
  'dropper',
  'repeater',
  'lateral',
  'transfer',
]);
const STREAM_CONTRACT_VALUES = Object.freeze([
  'pcm',
  'pcb',
  'pcmb',
  'commerce',
  'arts',
  'diploma',
]);

/** Rank of a leadStage value, or -1 when unknown. */
function leadStageRank(stage) {
  return LEAD_STAGES.indexOf(stage);
}

/**
 * §1.I monotonic guard. Equal stages are allowed (idempotent re-write); an
 * unknown target is never allowed.
 */
function canAdvanceLeadStage(fromStage, toStage) {
  const to = leadStageRank(toStage);
  if (to < 0) return false;
  const from = leadStageRank(fromStage);
  if (from < 0) return true; // unset / unknown current stage — any known stage is an advance
  return to >= from;
}

/** Rank of a bookingStatus value (unknown values rank 0 — annotation only). */
function bookingStatusRank(status) {
  const key = status === null || status === undefined ? 'null' : String(status);
  return Object.prototype.hasOwnProperty.call(BOOKING_STATUS_RANK, key)
    ? BOOKING_STATUS_RANK[key]
    : 0;
}

/** S-4: bookingStatus may only advance. */
function canAdvanceBookingStatus(fromStatus, toStatus) {
  return bookingStatusRank(toStatus) >= bookingStatusRank(fromStatus);
}

function isAuthoritativeSource(source) {
  return AUTHORITATIVE_SOURCES.includes(source);
}

function isNonAuthoritativeSource(source) {
  return NON_AUTHORITATIVE_SOURCES.includes(source);
}

module.exports = {
  SLOT_META_SOURCES,
  AUTHORITATIVE_SOURCES,
  NON_AUTHORITATIVE_SOURCES,
  CONFIDENCE_REQUIRED_SOURCES,
  VERBATIM_REQUIRED_SOURCES,
  WRITE_CHANNELS,
  LLM_WRITE_CHANNEL,
  SYSTEM_WRITE_CHANNEL,
  EXAM_RESULT_STATUSES,
  OBJECTION_TYPES,
  OBJECTION_STATUSES,
  OBJECTION_SEVERITIES,
  COMPETITOR_CONTEXTS,
  SHOWN_ARTIFACT_KINDS,
  SHOWN_ARTIFACT_CATALOGS,
  LEAD_STAGES,
  BOOKING_STATUS_RANK,
  EXIT_REASON_CONTRACT_VALUES,
  PARKED_AS_VALUES,
  ACTIVE_HOUR_BUCKETS,
  LOCALITY_VALUES,
  PROXY_RELATION_VALUES,
  BOARD_VALUES,
  MEDIUM_VALUES,
  MARKS12_STATUS_VALUES,
  MATH_COMFORT_VALUES,
  CODING_EXPOSURE_VALUES,
  GOAL_CLARITY_VALUES,
  HIGHER_STUDY_INTENT_VALUES,
  DECISION_MAKER_VALUES,
  PAYER_VALUES,
  PARENT_INVOLVEMENT_VALUES,
  PARENT_STANCE_VALUES,
  ADVISOR_INFLUENCE_VALUES,
  BUDGET_BASIS_VALUES,
  BUDGET_SCOPE_VALUES,
  BUDGET_FLEXIBILITY_VALUES,
  LOAN_WILLINGNESS_VALUES,
  SCHOLARSHIP_DEPENDENCY_VALUES,
  RELOCATION_WILLINGNESS_VALUES,
  HOSTEL_PREFERENCE_VALUES,
  TIMELINE_PRESSURE_VALUES,
  ENTRY_TYPE_CONTRACT_VALUES,
  STREAM_CONTRACT_VALUES,
  leadStageRank,
  canAdvanceLeadStage,
  bookingStatusRank,
  canAdvanceBookingStatus,
  isAuthoritativeSource,
  isNonAuthoritativeSource,
};
