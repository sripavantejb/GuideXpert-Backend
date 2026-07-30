'use strict';

/**
 * Flow V3 — extended lead-profile schema (LEAD_PROFILE_CONTRACT.md §1, §5).
 *
 * EXTEND, DO NOT REPLACE. Every one of the 75 live `LEAD_PROFILE_SCHEMA` slots
 * is imported by reference and keeps its live NAME and live TYPE exactly. Flow
 * V2 and the predictor read those slots; a rename or a type change here would
 * be a behaviour change to a frozen engine. This module only:
 *
 *   1. overlays V3 classification metadata (group · sensitivity tier ·
 *      staleness class · write channel) onto the legacy slots, and
 *   2. adds new fields, including the five structured arrays.
 *
 * TYPE CONFLICTS WITH THE CONTRACT — resolved in favour of the live type:
 *
 *   | field               | live type | contract type | resolution                    |
 *   |---------------------|-----------|---------------|-------------------------------|
 *   | parentConstraints   | string    | array         | companion `parentConstraintsList[]` |
 *   | collegeOfInterest   | string    | array         | companion `collegeOfInterestList[]` |
 *   | coreInterest        | string    | bool          | NO companion — boolean derived at read time |
 *   | goalPriority        | array     | enum scalar   | NO companion — `goalPriority[0]` carries scalar semantics |
 *
 * A companion is added only where the contract needs multi-value capture that a
 * string genuinely cannot hold. `coreInterest` already holds the more specific
 * fact (which core field), so a boolean companion would be a second source of
 * truth for the same thing; it is derived instead. `goalPriority` is already an
 * ordered array, so the contract's scalar reading is just its head element.
 */

const {
  SLOT_TYPES,
  LEAD_PROFILE_SCHEMA,
  getSlotKeys,
  defaultForType,
} = require('../careerCounsellingFlowV2Profile');

const {
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
  ACTIVE_HOUR_BUCKETS,
  LEAD_STAGES,
  PARKED_AS_VALUES,
  EXAM_RESULT_STATUSES,
  OBJECTION_TYPES,
  OBJECTION_STATUSES,
  OBJECTION_SEVERITIES,
  COMPETITOR_CONTEXTS,
  SHOWN_ARTIFACT_KINDS,
  SHOWN_ARTIFACT_CATALOGS,
} = require('./flowV3ProfileEnums');

/** Bumped whenever a stored document needs a migration, not on every add. */
const FLOW_V3_PROFILE_SCHEMA_VERSION = 1;

/** `date` is the one type V3 adds; everything else is the live type space. */
const FLOW_V3_SLOT_TYPES = Object.freeze([...SLOT_TYPES, 'date']);

/**
 * Field groups. A-K are the contract's groups; `SYS` classifies legacy
 * pipeline bookkeeping slots that predate the contract and belong to no group
 * in it (router flags, delivery counters, node handoff state). `SYS` is
 * code-owned, exactly like H/I.
 */
const FIELD_GROUPS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'SYS']);

/** §5.2 staleness classes. `V` volatile · `S` stable · `F` soft (180d) · null n/a. */
const STALENESS_CLASSES = Object.freeze(['V', 'S', 'F']);
const SOFT_STALENESS_DAYS = 180;

/** §1 legacy join separator for companion → legacy string mirrors. */
const LEGACY_JOIN_SEPARATOR = ', ';

/**
 * V3 metadata for the 75 live slots. Keys and types are NOT restated here —
 * they come from `LEAD_PROFILE_SCHEMA`. A missing entry is a load-time error, so
 * a future legacy slot cannot silently arrive unclassified.
 *
 *   group        contract group (or SYS, see above)
 *   sens         sensitivity tier §3
 *   stale        staleness class §5.2
 *   llmWritable  false ⇒ the update_lead_profile tool rejects this key (§5)
 *   mirrorOwned  legacy mirror target — recomputed one-way from a V3 field
 *   crisisRecord retention follows the existing crisis handoff policy, not the
 *                Tier-4 6-month purge
 */
const LEGACY_FIELD_V3_META = Object.freeze({
  phone: { group: 'A', sens: 2, stale: 'S', llmWritable: false },
  name: { group: 'A', sens: 2, stale: 'S', llmWritable: true },
  language: { group: 'A', sens: 1, stale: 'F', llmWritable: true },
  proxy: { group: 'A', sens: 1, stale: 'S', llmWritable: true },
  source: { group: 'SYS', sens: 1, stale: 'S', llmWritable: false },
  campaign: { group: 'SYS', sens: 1, stale: 'S', llmWritable: false },
  rawFirstMessage: { group: 'SYS', sens: 2, stale: 'S', llmWritable: false },
  createdAt: { group: 'SYS', sens: 1, stale: null, llmWritable: false },
  botState: { group: 'SYS', sens: 1, stale: null, llmWritable: false },
  qualification: { group: 'B', sens: 1, stale: 'S', llmWritable: true },
  stream: { group: 'B', sens: 1, stale: 'S', llmWritable: true },
  entryType: { group: 'B', sens: 1, stale: 'S', llmWritable: true },
  timeline: { group: 'F', sens: 1, stale: 'V', llmWritable: true },
  goal: { group: 'D', sens: 1, stale: 'F', llmWritable: true },
  goalPriority: { group: 'D', sens: 1, stale: 'F', llmWritable: true },
  careerGoal: { group: 'D', sens: 1, stale: 'F', llmWritable: true },
  interests: { group: 'D', sens: 1, stale: 'F', llmWritable: true },
  interestCluster: { group: 'D', sens: 1, stale: 'F', llmWritable: false },
  branchInterest: { group: 'D', sens: 1, stale: 'F', llmWritable: true },
  coreBridgeAttempted: { group: 'D', sens: 1, stale: null, llmWritable: false },
  coreBridgeClosed: { group: 'D', sens: 1, stale: null, llmWritable: false },
  coreInterest: { group: 'D', sens: 1, stale: 'F', llmWritable: true },
  budgetBand: { group: 'F', sens: 2, stale: 'F', llmWritable: true },
  cityPref: { group: 'F', sens: 1, stale: 'F', llmWritable: true },
  city: { group: 'A', sens: 2, stale: 'F', llmWritable: true },
  state: { group: 'A', sens: 2, stale: 'F', llmWritable: true },
  scholarshipFlag: { group: 'F', sens: 1, stale: 'F', llmWritable: true },
  parentConstraints: { group: 'E', sens: 2, stale: 'F', llmWritable: true, mirrorOwned: true },
  isParent: { group: 'A', sens: 1, stale: 'S', llmWritable: true },
  checklistSent: { group: 'SYS', sens: 1, stale: null, llmWritable: false },
  permissionRecommend: { group: 'SYS', sens: 1, stale: null, llmWritable: false },
  frameSent: { group: 'SYS', sens: 1, stale: null, llmWritable: false },
  followupsSent: { group: 'H', sens: 1, stale: null, llmWritable: false },
  bookingFollowup: { group: 'SYS', sens: 1, stale: null, llmWritable: false },
  callbackNumber: { group: 'A', sens: 2, stale: 'S', llmWritable: true },
  honestPassFired: { group: 'J', sens: 1, stale: null, llmWritable: false },
  fitCollege: { group: 'J', sens: 1, stale: null, llmWritable: false },
  fitReason: { group: 'J', sens: 1, stale: null, llmWritable: false },
  shortlistAskDeclined: { group: 'J', sens: 1, stale: null, llmWritable: false },
  niatInterest: { group: 'J', sens: 1, stale: null, llmWritable: false },
  examType: { group: 'C', sens: 1, stale: 'V', llmWritable: true, mirrorOwned: true },
  rank: { group: 'C', sens: 1, stale: 'V', llmWritable: true, mirrorOwned: true },
  percentile: { group: 'C', sens: 1, stale: 'V', llmWritable: true, mirrorOwned: true },
  category: { group: 'C', sens: 3, stale: 'V', llmWritable: false, mirrorOwned: true, inferable: false },
  gender: { group: 'C', sens: 3, stale: 'V', llmWritable: false, mirrorOwned: true, inferable: false },
  quota: { group: 'C', sens: 1, stale: 'V', llmWritable: true, mirrorOwned: true },
  region: { group: 'C', sens: 1, stale: 'V', llmWritable: true, mirrorOwned: true },
  admissionType: { group: 'C', sens: 1, stale: 'V', llmWritable: true, mirrorOwned: true },
  predictorBridgeShown: { group: 'SYS', sens: 1, stale: null, llmWritable: false },
  predictorBridgeChoice: { group: 'SYS', sens: 1, stale: null, llmWritable: false },
  predictedColleges: { group: 'J', sens: 1, stale: 'V', llmWritable: false },
  filtersUsed: { group: 'J', sens: 1, stale: 'V', llmWritable: false },
  collegeOfInterest: { group: 'D', sens: 1, stale: 'F', llmWritable: true, mirrorOwned: true },
  concerns: { group: 'G', sens: 1, stale: 'F', llmWritable: true, mirrorOwned: true },
  hesitations: { group: 'G', sens: 1, stale: 'F', llmWritable: true },
  shortlist: { group: 'J', sens: 1, stale: null, llmWritable: false },
  comparedColleges: { group: 'J', sens: 1, stale: null, llmWritable: false },
  recommendation: { group: 'J', sens: 1, stale: null, llmWritable: false },
  temperature: { group: 'H', sens: 1, stale: null, llmWritable: false },
  door: { group: 'SYS', sens: 1, stale: null, llmWritable: false },
  jumpType: { group: 'SYS', sens: 1, stale: null, llmWritable: false },
  bookingStatus: { group: 'I', sens: 1, stale: null, llmWritable: false },
  doorHistory: { group: 'H', sens: 1, stale: null, llmWritable: false, appendOnly: true },
  crisisLocked: { group: 'I', sens: 4, stale: null, llmWritable: false, crisisRecord: true },
  crisisHandoffId: { group: 'I', sens: 4, stale: null, llmWritable: false, crisisRecord: true },
  optedOut: { group: 'I', sens: 1, stale: null, llmWritable: false },
  spam: { group: 'I', sens: 1, stale: null, llmWritable: false },
  outOfScope: { group: 'I', sens: 1, stale: null, llmWritable: false },
  conflict: { group: 'E', sens: 2, stale: 'F', llmWritable: true },
  escalateHuman: { group: 'I', sens: 1, stale: null, llmWritable: false },
  status: { group: 'I', sens: 1, stale: null, llmWritable: false },
  exitReason: { group: 'I', sens: 1, stale: null, llmWritable: false },
  nudgeSent: { group: 'H', sens: 1, stale: null, llmWritable: false },
  nudgeSentAt: { group: 'H', sens: 1, stale: null, llmWritable: false },
  hostileRedirectIssued: { group: 'H', sens: 1, stale: null, llmWritable: false },
});

/**
 * Structured-array item specs (§1.C, §1.G, §1.J, §1.K, §1.I).
 *
 *   identity   fields whose combined value identifies the same logical entry —
 *              a patch entry matching an existing identity MERGES into it
 *              instead of appending a duplicate
 *   appendOnly identity is ignored; every patch entry is appended
 */
const STRUCTURED_ARRAY_SPECS = Object.freeze({
  examResults: Object.freeze({
    identity: Object.freeze(['exam', 'attemptYear']),
    fields: Object.freeze({
      exam: { type: 'string' },
      status: { type: 'string', enumValues: EXAM_RESULT_STATUSES },
      rank: { type: 'number', stale: 'V' },
      percentile: { type: 'number', stale: 'V' },
      score: { type: 'number', stale: 'V' },
      category: { type: 'string', sens: 3, stale: 'V', inferable: false, llmWritable: false },
      quota: { type: 'string', stale: 'V' },
      region: { type: 'string', stale: 'V' },
      admissionType: { type: 'string', stale: 'V' },
      gender: { type: 'string', sens: 3, stale: 'V', inferable: false, llmWritable: false },
      attemptYear: { type: 'number' },
      isPrimary: { type: 'boolean' },
      meta: { type: 'object' },
    }),
    /** Only one entry may carry isPrimary — the exam the student is banking on. */
    exclusiveFlag: 'isPrimary',
    /** category/gender are mandatory + authoritative-only §1.C. */
    requiredForPredictor: Object.freeze(['exam', 'category', 'gender']),
  }),
  objections: Object.freeze({
    identity: Object.freeze(['type', 'raisedAtTurn']),
    fields: Object.freeze({
      type: { type: 'string', enumValues: OBJECTION_TYPES },
      raisedAtTurn: { type: 'number' },
      verbatim: { type: 'string' },
      status: { type: 'string', enumValues: OBJECTION_STATUSES },
      addressedHow: { type: 'string' },
      severity: { type: 'string', enumValues: OBJECTION_SEVERITIES, authoritative: false },
      meta: { type: 'object' },
    }),
  }),
  competitorsMentioned: Object.freeze({
    // Identity is (name, context): the same competitor named again in the same
    // context is one fact, not two. A different context is a different fact.
    identity: Object.freeze(['name', 'context']),
    caseInsensitiveIdentityFields: Object.freeze(['name']),
    fields: Object.freeze({
      name: { type: 'string' },
      context: { type: 'string', enumValues: COMPETITOR_CONTEXTS },
      turnId: { type: 'string' },
      meta: { type: 'object' },
    }),
  }),
  shownArtifacts: Object.freeze({
    identity: Object.freeze(['kind', 'shownAtTurn']),
    fields: Object.freeze({
      kind: { type: 'string', enumValues: SHOWN_ARTIFACT_KINDS },
      catalog: { type: 'string', enumValues: SHOWN_ARTIFACT_CATALOGS },
      rows: { type: 'array' },
      shownAtTurn: { type: 'number' },
      disclosureIncluded: { type: 'boolean' },
      groundingIds: { type: 'array' },
    }),
  }),
  counsellorCorrections: Object.freeze({
    identity: Object.freeze(['slot', 'actualValue']),
    fields: Object.freeze({
      slot: { type: 'string' },
      botValue: { type: 'string' },
      actualValue: { type: 'string' },
      correctedAt: { type: 'date' },
    }),
  }),
  leadStageHistory: Object.freeze({
    appendOnly: true,
    fields: Object.freeze({
      stage: { type: 'string', enumValues: LEAD_STAGES },
      at: { type: 'date' },
      reason: { type: 'string' },
    }),
  }),
});

/**
 * V3-new fields. `authoritative: false` marks the contract's Auth ✗ rows: the
 * field is inferred by nature and can never be treated as stated fact.
 * `inferable: false` marks the inverse — never inferred, authoritative only.
 */
const V3_NEW_FIELDS = Object.freeze({
  // --- A. Identity & contact ---
  preferredName: { type: 'string', group: 'A', sens: 1, stale: 'S', llmWritable: true },
  altContact: { type: 'string', group: 'A', sens: 2, stale: 'S', llmWritable: true },
  isProxy: { type: 'boolean', group: 'A', sens: 1, stale: 'S', llmWritable: true },
  proxyRelation: {
    type: 'string',
    group: 'A',
    sens: 1,
    stale: 'S',
    enumValues: PROXY_RELATION_VALUES,
    llmWritable: true,
  },
  district: { type: 'string', group: 'A', sens: 2, stale: 'F', llmWritable: true },
  pincode: { type: 'string', group: 'A', sens: 2, stale: 'F', llmWritable: true },
  locality: {
    type: 'string',
    group: 'A',
    sens: 2,
    stale: 'F',
    enumValues: LOCALITY_VALUES,
    authoritative: false,
    llmWritable: true,
  },
  // consentAt / consentVersion / isMinor: nullable and write-blocked on EVERY
  // channel, including system. The disclosure line they imply does not exist
  // yet (§3 OPEN) and it is student-facing, so no copy is drafted here.
  // TODO(copy): first-contact consent disclosure line.
  // TODO(decision): DPDP children's-data provisions — parental consent, and
  // whether isMinor===true suppresses group H behavioural profiling entirely.
  // Tier 1 retention, not Tier 2: consent evidence must outlive the 24-month
  // identity anonymisation, otherwise anonymising destroys the proof of consent.
  consentAt: {
    type: 'date',
    group: 'A',
    sens: 1,
    stale: null,
    llmWritable: false,
    systemWriteBlocked: true,
    pending: 'TODO(copy)',
  },
  consentVersion: {
    type: 'string',
    group: 'A',
    sens: 1,
    stale: null,
    llmWritable: false,
    systemWriteBlocked: true,
    pending: 'TODO(copy)',
  },
  isMinor: {
    type: 'boolean',
    group: 'A',
    sens: 3,
    stale: 'V',
    llmWritable: false,
    systemWriteBlocked: true,
    inferable: false,
    pending: 'TODO(decision)',
  },

  // --- B. Academic — current ---
  board: { type: 'string', group: 'B', sens: 1, stale: 'S', enumValues: BOARD_VALUES, llmWritable: true },
  boardState: { type: 'string', group: 'B', sens: 1, stale: 'S', llmWritable: true },
  medium: { type: 'string', group: 'B', sens: 1, stale: 'S', enumValues: MEDIUM_VALUES, llmWritable: true },
  schoolName: { type: 'string', group: 'B', sens: 2, stale: 'S', llmWritable: true },
  passingYear: { type: 'number', group: 'B', sens: 1, stale: 'S', llmWritable: true },
  targetAdmissionYear: { type: 'number', group: 'B', sens: 1, stale: 'S', llmWritable: true },
  attemptNumber: { type: 'number', group: 'B', sens: 1, stale: 'V', llmWritable: true },
  marks10: { type: 'number', group: 'B', sens: 2, stale: 'S', llmWritable: true },
  marks12: { type: 'number', group: 'B', sens: 2, stale: 'S', llmWritable: true },
  marks12Status: {
    type: 'string',
    group: 'B',
    sens: 1,
    stale: 'V',
    enumValues: MARKS12_STATUS_VALUES,
    llmWritable: true,
  },
  subjectStrengths: { type: 'array', group: 'B', sens: 1, stale: 'F', llmWritable: true },
  mathComfort: {
    type: 'string',
    group: 'B',
    sens: 1,
    stale: 'F',
    enumValues: MATH_COMFORT_VALUES,
    llmWritable: true,
  },
  codingExposure: {
    type: 'string',
    group: 'B',
    sens: 1,
    stale: 'F',
    enumValues: CODING_EXPOSURE_VALUES,
    llmWritable: true,
  },
  coachingInstitute: { type: 'string', group: 'B', sens: 2, stale: 'S', llmWritable: true },

  // --- C. Exams (array) ---
  // Tier is declared on the ENTRY subfields, not on the container: the array
  // itself is Tier 1 funnel data and the LLM legitimately writes exam/status/
  // rank, while `category` and `gender` inside each entry are Tier 3 and are
  // blocked for the LLM tool (LLM_BLOCKED_NESTED_PATHS). Marking the container
  // Tier 3 would block the whole array and force the LLM back onto the flat
  // legacy slots — the exact single-exam modelling bug §1.C exists to fix.
  examResults: {
    type: 'array',
    group: 'C',
    sens: 1,
    stale: 'V',
    structured: true,
    containsTier3: true,
    llmWritable: true,
  },

  // --- D. Goals & interests ---
  goalClarity: {
    type: 'string',
    group: 'D',
    sens: 1,
    stale: 'F',
    enumValues: GOAL_CLARITY_VALUES,
    authoritative: false,
    llmWritable: true,
  },
  dreamCollege: { type: 'string', group: 'D', sens: 1, stale: 'F', llmWritable: true },
  collegeOfInterestList: {
    type: 'array',
    group: 'D',
    sens: 1,
    stale: 'F',
    llmWritable: true,
    companionFor: 'collegeOfInterest',
  },
  higherStudyIntent: {
    type: 'string',
    group: 'D',
    sens: 1,
    stale: 'F',
    enumValues: HIGHER_STUDY_INTENT_VALUES,
    llmWritable: true,
  },
  abroadIntent: { type: 'boolean', group: 'D', sens: 1, stale: 'F', llmWritable: true },

  // --- E. Decision-making unit ---
  decisionMaker: {
    type: 'string',
    group: 'E',
    sens: 2,
    stale: 'F',
    enumValues: DECISION_MAKER_VALUES,
    llmWritable: true,
  },
  decisionMakerPresent: {
    type: 'boolean',
    group: 'E',
    sens: 1,
    stale: null,
    authoritative: false,
    llmWritable: true,
  },
  payer: { type: 'string', group: 'E', sens: 2, stale: 'F', enumValues: PAYER_VALUES, llmWritable: true },
  parentInvolvement: {
    type: 'string',
    group: 'E',
    sens: 2,
    stale: 'F',
    enumValues: PARENT_INVOLVEMENT_VALUES,
    authoritative: false,
    llmWritable: true,
  },
  parentStance: {
    type: 'string',
    group: 'E',
    sens: 2,
    stale: 'F',
    enumValues: PARENT_STANCE_VALUES,
    llmWritable: true,
  },
  parentConstraintsList: {
    type: 'array',
    group: 'E',
    sens: 2,
    stale: 'F',
    llmWritable: true,
    companionFor: 'parentConstraints',
  },
  familyPrecedent: { type: 'string', group: 'E', sens: 2, stale: 'F', llmWritable: true },
  firstGenerationCollege: {
    type: 'boolean',
    group: 'E',
    sens: 3,
    stale: 'S',
    llmWritable: false,
    inferable: false,
    volunteeredOnly: true,
  },
  advisorInfluence: {
    type: 'string',
    group: 'E',
    sens: 1,
    stale: 'F',
    enumValues: ADVISOR_INFLUENCE_VALUES,
    llmWritable: true,
  },

  // --- F. Constraints ---
  budgetAmount: { type: 'number', group: 'F', sens: 2, stale: 'F', llmWritable: true },
  budgetBasis: {
    type: 'string',
    group: 'F',
    sens: 2,
    stale: 'F',
    enumValues: BUDGET_BASIS_VALUES,
    llmWritable: true,
  },
  budgetScope: {
    type: 'string',
    group: 'F',
    sens: 2,
    stale: 'F',
    enumValues: BUDGET_SCOPE_VALUES,
    llmWritable: true,
  },
  budgetFlexibility: {
    type: 'string',
    group: 'F',
    sens: 2,
    stale: 'F',
    enumValues: BUDGET_FLEXIBILITY_VALUES,
    llmWritable: true,
  },
  loanWillingness: {
    type: 'string',
    group: 'F',
    sens: 2,
    stale: 'F',
    enumValues: LOAN_WILLINGNESS_VALUES,
    llmWritable: true,
  },
  scholarshipDependency: {
    type: 'string',
    group: 'F',
    sens: 2,
    stale: 'F',
    enumValues: SCHOLARSHIP_DEPENDENCY_VALUES,
    llmWritable: true,
  },
  relocationWillingness: {
    type: 'string',
    group: 'F',
    sens: 1,
    stale: 'F',
    enumValues: RELOCATION_WILLINGNESS_VALUES,
    llmWritable: true,
  },
  maxTravelHours: { type: 'number', group: 'F', sens: 1, stale: 'F', llmWritable: true },
  hostelPreference: {
    type: 'string',
    group: 'F',
    sens: 1,
    stale: 'F',
    enumValues: HOSTEL_PREFERENCE_VALUES,
    llmWritable: true,
  },
  genderConstraint: {
    type: 'boolean',
    group: 'F',
    sens: 3,
    stale: 'F',
    llmWritable: false,
    inferable: false,
  },
  genderConstraintNote: {
    type: 'string',
    group: 'F',
    sens: 3,
    stale: 'F',
    llmWritable: false,
    inferable: false,
  },
  accessibilityNeeds: {
    type: 'string',
    group: 'F',
    sens: 4,
    stale: 'S',
    llmWritable: false,
    inferable: false,
    volunteeredOnly: true,
    neverAsked: true,
  },
  timelinePressure: {
    type: 'string',
    group: 'F',
    sens: 1,
    stale: 'V',
    enumValues: TIMELINE_PRESSURE_VALUES,
    llmWritable: true,
  },

  // --- G. Objections ---
  objections: { type: 'array', group: 'G', sens: 1, stale: null, structured: true, llmWritable: true },
  competitorsMentioned: {
    type: 'array',
    group: 'G',
    sens: 1,
    stale: null,
    structured: true,
    llmWritable: true,
  },

  // --- H. Engagement & behaviour — RULE B: computed by code, never the LLM ---
  turnCount: { type: 'number', group: 'H', sens: 1, stale: null, llmWritable: false },
  sessionCount: { type: 'number', group: 'H', sens: 1, stale: null, llmWritable: false },
  firstSeenAt: { type: 'date', group: 'H', sens: 1, stale: null, llmWritable: false },
  lastSeenAt: { type: 'date', group: 'H', sens: 1, stale: null, llmWritable: false },
  medianResponseSec: { type: 'number', group: 'H', sens: 1, stale: null, llmWritable: false },
  longestGapHours: { type: 'number', group: 'H', sens: 1, stale: null, llmWritable: false },
  typedRatio: { type: 'number', group: 'H', sens: 1, stale: null, llmWritable: false },
  questionsAsked: { type: 'number', group: 'H', sens: 1, stale: null, llmWritable: false },
  beatsCompleted: { type: 'array', group: 'H', sens: 1, stale: null, llmWritable: false },
  beatsSkipped: { type: 'array', group: 'H', sens: 1, stale: null, llmWritable: false },
  dropOffBeat: { type: 'string', group: 'H', sens: 1, stale: null, llmWritable: false },
  interruptsFired: { type: 'array', group: 'H', sens: 1, stale: null, llmWritable: false },
  fallbackTiersHit: { type: 'array', group: 'H', sens: 1, stale: null, llmWritable: false },
  activeHourBucket: {
    type: 'string',
    group: 'H',
    sens: 1,
    stale: null,
    enumValues: ACTIVE_HOUR_BUCKETS,
    llmWritable: false,
  },
  deviceLocale: { type: 'string', group: 'H', sens: 1, stale: null, llmWritable: false },
  messageMediaTypes: { type: 'array', group: 'H', sens: 1, stale: null, llmWritable: false },
  reEngagedAfterFollowup: { type: 'boolean', group: 'H', sens: 1, stale: null, llmWritable: false },
  bookingUrlSentAt: { type: 'date', group: 'H', sens: 1, stale: null, llmWritable: false },
  bookingUrlClicked: { type: 'boolean', group: 'H', sens: 1, stale: null, llmWritable: false },

  // --- I. Funnel state — code-written only ---
  leadStage: {
    type: 'string',
    group: 'I',
    sens: 1,
    stale: null,
    enumValues: LEAD_STAGES,
    monotonic: true,
    llmWritable: false,
  },
  leadStageHistory: {
    type: 'array',
    group: 'I',
    sens: 1,
    stale: null,
    structured: true,
    appendOnly: true,
    llmWritable: false,
  },
  qualifiedAt: { type: 'date', group: 'I', sens: 1, stale: null, llmWritable: false },
  shortlistSeenAt: { type: 'date', group: 'I', sens: 1, stale: null, llmWritable: false },
  parkedAs: {
    type: 'string',
    group: 'I',
    sens: 1,
    stale: null,
    enumValues: PARKED_AS_VALUES,
    llmWritable: false,
  },
  escalatedToHuman: { type: 'boolean', group: 'I', sens: 1, stale: null, llmWritable: false },
  escalationReason: { type: 'string', group: 'I', sens: 1, stale: null, llmWritable: false },

  // --- J. Recommendation record ---
  shownArtifacts: {
    type: 'array',
    group: 'J',
    sens: 1,
    stale: null,
    structured: true,
    llmWritable: false,
  },

  // --- K. Outcome ---
  counsellorAssigned: { type: 'string', group: 'K', sens: 1, stale: null, llmWritable: false },
  sessionScheduledAt: { type: 'date', group: 'K', sens: 1, stale: null, llmWritable: false },
  sessionAttended: { type: 'boolean', group: 'K', sens: 1, stale: null, llmWritable: false },
  counsellorNotes: { type: 'string', group: 'K', sens: 2, stale: null, llmWritable: false },
  counsellorCorrections: {
    type: 'array',
    group: 'K',
    sens: 1,
    stale: null,
    structured: true,
    llmWritable: false,
  },
  enrolledCollege: { type: 'string', group: 'K', sens: 1, stale: null, llmWritable: false },
  enrolledBranch: { type: 'string', group: 'K', sens: 1, stale: null, llmWritable: false },
  enrolledAt: { type: 'date', group: 'K', sens: 1, stale: null, llmWritable: false },
  lostReason: { type: 'string', group: 'K', sens: 1, stale: null, llmWritable: false },
  npsScore: { type: 'number', group: 'K', sens: 1, stale: null, llmWritable: false },
  feedbackVerbatim: { type: 'string', group: 'K', sens: 2, stale: null, llmWritable: false },
});

/**
 * §1.C legacy mirror map — legacy flat slot ← field on the isPrimary
 * examResults entry. ONE-DIRECTIONAL: written on every examResults write,
 * never read back into examResults.
 */
const EXAM_LEGACY_MIRROR_MAP = Object.freeze({
  examType: 'exam',
  rank: 'rank',
  percentile: 'percentile',
  category: 'category',
  gender: 'gender',
  quota: 'quota',
  region: 'region',
  admissionType: 'admissionType',
});

/** Companion array → legacy string slot. ONE-DIRECTIONAL (join, never split). */
const COMPANION_FIELDS = Object.freeze({
  parentConstraintsList: 'parentConstraints',
  collegeOfInterestList: 'collegeOfInterest',
});

/**
 * Deliberately NOT given companions — see the header table. Exported so the
 * decision is discoverable from code, not only from a doc.
 */
const COMPANION_DELIBERATELY_OMITTED = Object.freeze({
  coreInterest: 'boolean sense is derived at read time (deriveCoreInterest)',
  goalPriority: 'scalar sense is goalPriority[0] (getGoalPriorityScalar)',
});

/** §1.G legacy mirror — objections[].type → concerns[] (append + dedupe, one-way). */
const OBJECTION_LEGACY_MIRROR_TARGET = 'concerns';

/**
 * §3 DO NOT BUILD. Enforced at load time: a field whose name matches any of
 * these may not exist in this schema. Deliberate exclusions, not omissions.
 */
const EXCLUDED_FIELD_CATEGORIES = Object.freeze([
  'inferred personality / emotional-state profiling',
  'persuasion-vulnerability or urgency-susceptibility scoring',
  'inferred caste, religion or socioeconomic class',
  'inferred family income (stated budget only)',
  'desperation / pressure-susceptibility scoring',
  'Tier 3 or Tier 4 fields in an LLM prompt beyond the current turn',
]);

const EXCLUDED_FIELD_NAME_PATTERNS = Object.freeze([
  /personality/i,
  /emotional[_-]?state/i,
  /desperation/i,
  /easily[_-]?pressured/i,
  /persuasion/i,
  /urgency[_-]?suscept/i,
  /vulnerab/i,
  /caste/i,
  /religion/i,
  /socio[_-]?economic/i,
  /affluence/i,
  /(family|estimated)[_-]?income/i,
  /anxious|anxiety/i,
  /low[_-]?confidence/i,
]);

const LEGACY_SLOT_KEYS = Object.freeze(getSlotKeys());
const V3_NEW_FIELD_KEYS = Object.freeze(Object.keys(V3_NEW_FIELDS));

/** Load-time contract self-checks — a violation here is a build error, not a runtime surprise. */
(function assertSchemaContract() {
  const missing = LEGACY_SLOT_KEYS.filter((key) => !LEGACY_FIELD_V3_META[key]);
  if (missing.length) {
    throw new Error(`flowV3LeadProfileSchema: unclassified legacy slots: ${missing.join(', ')}`);
  }
  const extra = Object.keys(LEGACY_FIELD_V3_META).filter((key) => !LEAD_PROFILE_SCHEMA[key]);
  if (extra.length) {
    throw new Error(`flowV3LeadProfileSchema: meta for unknown legacy slots: ${extra.join(', ')}`);
  }
  const collisions = V3_NEW_FIELD_KEYS.filter((key) => key in LEAD_PROFILE_SCHEMA);
  if (collisions.length) {
    throw new Error(`flowV3LeadProfileSchema: new fields collide with legacy slots: ${collisions.join(', ')}`);
  }
  for (const key of V3_NEW_FIELD_KEYS) {
    const def = V3_NEW_FIELDS[key];
    if (!FLOW_V3_SLOT_TYPES.includes(def.type)) {
      throw new Error(`flowV3LeadProfileSchema: ${key} has unsupported type ${def.type}`);
    }
    if (!FIELD_GROUPS.includes(def.group)) {
      throw new Error(`flowV3LeadProfileSchema: ${key} has unknown group ${def.group}`);
    }
  }
  const banned = [...LEGACY_SLOT_KEYS, ...V3_NEW_FIELD_KEYS].filter((key) =>
    EXCLUDED_FIELD_NAME_PATTERNS.some((pattern) => pattern.test(key))
  );
  if (banned.length) {
    throw new Error(`flowV3LeadProfileSchema: §3 DO NOT BUILD fields present: ${banned.join(', ')}`);
  }
})();

/**
 * The V3 schema. Legacy entries are the live definition spread verbatim (type,
 * askable, writeBeats, readBeats, description all preserved) plus the V3
 * overlay; new entries are declared above.
 */
const FLOW_V3_PROFILE_SCHEMA = Object.freeze(
  Object.fromEntries([
    ...LEGACY_SLOT_KEYS.map((key) => [
      key,
      Object.freeze({
        ...LEAD_PROFILE_SCHEMA[key],
        ...LEGACY_FIELD_V3_META[key],
        legacy: true,
        structured: false,
      }),
    ]),
    ...V3_NEW_FIELD_KEYS.map((key) => [
      key,
      Object.freeze({
        writeBeats: Object.freeze([]),
        readBeats: Object.freeze([]),
        structured: false,
        ...V3_NEW_FIELDS[key],
        legacy: false,
      }),
    ]),
  ])
);

const ALL_FIELD_KEYS = Object.freeze(Object.keys(FLOW_V3_PROFILE_SCHEMA));

function fieldsWhere(predicate) {
  return Object.freeze(ALL_FIELD_KEYS.filter((key) => predicate(FLOW_V3_PROFILE_SCHEMA[key], key)));
}

const STRUCTURED_ARRAY_FIELDS = Object.freeze(Object.keys(STRUCTURED_ARRAY_SPECS));
const SCALAR_ARRAY_FIELDS = fieldsWhere(
  (def, key) => def.type === 'array' && !STRUCTURED_ARRAY_FIELDS.includes(key)
);
const APPEND_ONLY_ARRAY_FIELDS = fieldsWhere((def) => def.appendOnly === true);
const VOLATILE_FIELDS = fieldsWhere((def) => def.stale === 'V');
const STABLE_FIELDS = fieldsWhere((def) => def.stale === 'S');
const SOFT_FIELDS = fieldsWhere((def) => def.stale === 'F');
const TIER1_FIELDS = fieldsWhere((def) => def.sens === 1);
const TIER2_FIELDS = fieldsWhere((def) => def.sens === 2);
const TIER3_FIELDS = fieldsWhere((def) => def.sens === 3);
const TIER4_FIELDS = fieldsWhere((def) => def.sens === 4);
const CRISIS_RECORD_FIELDS = fieldsWhere((def) => def.crisisRecord === true);
const NON_AUTHORITATIVE_FIELDS = fieldsWhere((def) => def.authoritative === false);
const NEVER_INFERRED_FIELDS = fieldsWhere((def) => def.inferable === false);
const SYSTEM_WRITE_BLOCKED_FIELDS = fieldsWhere((def) => def.systemWriteBlocked === true);
const MIRROR_OWNED_FIELDS = fieldsWhere((def) => def.mirrorOwned === true);
const MONOTONIC_FIELDS = fieldsWhere((def) => def.monotonic === true);

/**
 * §5 tool-level allowlist. The LLM may not write group H, group I, code-owned
 * J/K, consentAt/consentVersion/isMinor, leadStage, bookingStatus, crisisLocked
 * or any Tier 3/4 field. Derived from the per-field flags plus the group and
 * tier rules so the two can never drift apart.
 */
const LLM_BLOCKED_GROUPS = Object.freeze(['H', 'I', 'J', 'K', 'SYS']);
const LLM_BLOCKED_FIELDS = fieldsWhere(
  (def) =>
    def.llmWritable === false ||
    LLM_BLOCKED_GROUPS.includes(def.group) ||
    def.sens === 3 ||
    def.sens === 4 ||
    def.systemWriteBlocked === true
);
const LLM_WRITABLE_FIELDS = Object.freeze(
  ALL_FIELD_KEYS.filter((key) => !LLM_BLOCKED_FIELDS.includes(key))
);

function nestedPathsWhere(predicate) {
  return Object.freeze(
    STRUCTURED_ARRAY_FIELDS.flatMap((arrayField) => {
      const spec = STRUCTURED_ARRAY_SPECS[arrayField];
      return Object.entries(spec.fields || {})
        .filter(([itemField, itemDef]) => predicate(itemDef, itemField, arrayField))
        .map(([itemField]) => `${arrayField}.${itemField}`);
    })
  );
}

/** Nested Tier-3 paths inside structured arrays — blocked for the LLM tool too. */
const LLM_BLOCKED_NESTED_PATHS = nestedPathsWhere(
  (itemDef) => itemDef.llmWritable === false || itemDef.sens === 3 || itemDef.sens === 4
);

/** §1.C category/gender: Tier 3, mandatory, authoritative-only, never inferred. */
const TIER3_NESTED_PATHS = nestedPathsWhere((itemDef) => itemDef.sens === 3);
const TIER4_NESTED_PATHS = nestedPathsWhere((itemDef) => itemDef.sens === 4);
const NEVER_INFERRED_NESTED_PATHS = nestedPathsWhere((itemDef) => itemDef.inferable === false);
const NON_AUTHORITATIVE_NESTED_PATHS = nestedPathsWhere((itemDef) => itemDef.authoritative === false);

(function assertAllowlistContract() {
  const mustBeBlocked = [
    'consentAt',
    'consentVersion',
    'isMinor',
    'leadStage',
    'bookingStatus',
    'crisisLocked',
    'category',
    'gender',
    'accessibilityNeeds',
  ];
  const leaked = mustBeBlocked.filter((key) => !LLM_BLOCKED_FIELDS.includes(key));
  if (leaked.length) {
    throw new Error(`flowV3LeadProfileSchema: allowlist leak — LLM could write ${leaked.join(', ')}`);
  }
  // The array must stay writable while its Tier-3 entry fields stay blocked.
  if (LLM_BLOCKED_FIELDS.includes('examResults')) {
    throw new Error('flowV3LeadProfileSchema: examResults must remain LLM-writable (§1.C)');
  }
  for (const path of ['examResults.category', 'examResults.gender']) {
    if (!LLM_BLOCKED_NESTED_PATHS.includes(path)) {
      throw new Error(`flowV3LeadProfileSchema: allowlist leak — LLM could write ${path}`);
    }
  }
})();

function getFieldDef(field) {
  return FLOW_V3_PROFILE_SCHEMA[field] || null;
}

function isKnownField(field) {
  return Object.prototype.hasOwnProperty.call(FLOW_V3_PROFILE_SCHEMA, field);
}

function getFieldTier(field) {
  const def = getFieldDef(field);
  return def && def.sens != null ? def.sens : null;
}

function getFieldGroup(field) {
  const def = getFieldDef(field);
  return def ? def.group : null;
}

function getStalenessClass(field) {
  const def = getFieldDef(field);
  return def && def.stale ? def.stale : null;
}

function isStructuredArrayField(field) {
  return STRUCTURED_ARRAY_FIELDS.includes(field);
}

function getStructuredArraySpec(field) {
  return STRUCTURED_ARRAY_SPECS[field] || null;
}

function isLlmWritableField(field) {
  return isKnownField(field) && !LLM_BLOCKED_FIELDS.includes(field);
}

/**
 * Path-aware LLM write gate used by update_lead_profile preflight.
 * Top-level keys use LLM_BLOCKED_FIELDS; nested paths use LLM_BLOCKED_NESTED_PATHS
 * (and a conservative `.category`/`.gender` suffix rule for examResults.N.category).
 */
function canLlmWriteField(fieldPath) {
  const path = String(fieldPath || '').trim();
  if (!path) return { allowed: false, reason: 'empty_path' };

  if (LLM_BLOCKED_NESTED_PATHS.includes(path) || /\.(category|gender)$/.test(path)) {
    return { allowed: false, reason: 'tier3_protected' };
  }

  const top = path.split('.')[0];
  if (!isKnownField(top)) return { allowed: false, reason: 'not_on_allowlist' };
  if (LLM_BLOCKED_FIELDS.includes(top)) return { allowed: false, reason: 'deny_list' };

  // Structured arrays: the array itself may be writable while Tier-3 entry
  // fields stay blocked (already handled above). Other nested keys under a
  // writable array are allowed through; the write policy sanitizes per entry.
  if (path.includes('.') && !isStructuredArrayField(top)) {
    return { allowed: false, reason: 'not_on_allowlist' };
  }
  return { allowed: true };
}

/** Conversation-volatile age-out window (§5.2). Soft ('F') uses SOFT_STALENESS_DAYS. */
const VOLATILE_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function listLiveSlotNames() {
  return [...LEGACY_SLOT_KEYS];
}

function isSystemWriteBlockedField(field) {
  return SYSTEM_WRITE_BLOCKED_FIELDS.includes(field);
}

function isNeverInferredField(field) {
  return NEVER_INFERRED_FIELDS.includes(field);
}

function isNonAuthoritativeField(field) {
  return NON_AUTHORITATIVE_FIELDS.includes(field);
}

function isVolatileField(field) {
  return getStalenessClass(field) === 'V';
}

function isSoftField(field) {
  return getStalenessClass(field) === 'F';
}

/**
 * Fresh V3 profile: every legacy slot at its live default (arrays `[]`,
 * everything else `null`), plus every new field at the same type default.
 */
function emptyFlowV3Profile() {
  const profile = {};
  for (const key of ALL_FIELD_KEYS) {
    profile[key] = defaultForType(FLOW_V3_PROFILE_SCHEMA[key].type);
  }
  return profile;
}

module.exports = {
  FLOW_V3_PROFILE_SCHEMA_VERSION,
  FLOW_V3_SLOT_TYPES,
  FIELD_GROUPS,
  STALENESS_CLASSES,
  SOFT_STALENESS_DAYS,
  LEGACY_JOIN_SEPARATOR,
  FLOW_V3_PROFILE_SCHEMA,
  LEGACY_FIELD_V3_META,
  V3_NEW_FIELDS,
  LEGACY_SLOT_KEYS,
  V3_NEW_FIELD_KEYS,
  ALL_FIELD_KEYS,
  STRUCTURED_ARRAY_SPECS,
  STRUCTURED_ARRAY_FIELDS,
  SCALAR_ARRAY_FIELDS,
  APPEND_ONLY_ARRAY_FIELDS,
  EXAM_LEGACY_MIRROR_MAP,
  COMPANION_FIELDS,
  COMPANION_DELIBERATELY_OMITTED,
  OBJECTION_LEGACY_MIRROR_TARGET,
  EXCLUDED_FIELD_CATEGORIES,
  EXCLUDED_FIELD_NAME_PATTERNS,
  VOLATILE_FIELDS,
  STABLE_FIELDS,
  SOFT_FIELDS,
  TIER1_FIELDS,
  TIER2_FIELDS,
  TIER3_FIELDS,
  TIER4_FIELDS,
  CRISIS_RECORD_FIELDS,
  NON_AUTHORITATIVE_FIELDS,
  NEVER_INFERRED_FIELDS,
  SYSTEM_WRITE_BLOCKED_FIELDS,
  MIRROR_OWNED_FIELDS,
  MONOTONIC_FIELDS,
  LLM_BLOCKED_GROUPS,
  LLM_BLOCKED_FIELDS,
  LLM_WRITABLE_FIELDS,
  LLM_BLOCKED_NESTED_PATHS,
  TIER3_NESTED_PATHS,
  TIER4_NESTED_PATHS,
  NEVER_INFERRED_NESTED_PATHS,
  NON_AUTHORITATIVE_NESTED_PATHS,
  getFieldDef,
  isKnownField,
  getFieldTier,
  getFieldGroup,
  getStalenessClass,
  isStructuredArrayField,
  getStructuredArraySpec,
  isLlmWritableField,
  canLlmWriteField,
  isSystemWriteBlockedField,
  isNeverInferredField,
  isNonAuthoritativeField,
  isVolatileField,
  isSoftField,
  emptyFlowV3Profile,
  VOLATILE_STALE_MS,
  listLiveSlotNames,
};
