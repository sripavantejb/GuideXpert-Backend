'use strict';

/**
 * Flow V3 — Lead Profile schema (declarative slot registry).
 *
 * Implements GUIDEXPERT_MASTER_FLOW.md (v3) happy path B1→B10.
 * Package path remains `flowV2` / `careerCounsellingFlowV2*` to avoid
 * orchestrator churn; beat IDs follow V3 (qualify → … → book).
 *
 * `readBeats` records which beat(s) check a slot before asking their own
 * question (self-skip), plus any later beat that needs the value as an
 * input signal.
 */

const SLOT_TYPES = Object.freeze(['string', 'number', 'array', 'boolean', 'object']);

/** Beat walk order for `nextSlot()`. Excludes `system` (never "asked"). */
const BEAT_ORDER = Object.freeze([
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'B6',
  'B6.5',
  'B7',
  'B8',
  'B9',
  'B10',
]);

const BEATS = Object.freeze([...BEAT_ORDER, 'system']);
function defaultForType(type) {
  switch (type) {
    case 'array':
      return [];
    // Tri-state (Phase 1.1): boolean/object default to `null` = "not yet
    // determined". `true`/`false` (or a populated object) means
    // "determined" — a `false` answer must be distinguishable from "never
    // asked" so a beat can genuinely gate on a yes/no answer.
    case 'boolean':
    case 'object':
    case 'string':
    case 'number':
    default:
      return null;
  }
}

/**
 * LEAD_PROFILE_SCHEMA — one entry per slot.
 *
 * DESIGN DECISIONS (resolved — see Phase 1.1 corrections):
 *  1. `stage` was removed from this schema (was previously here as a
 *     placeholder). It lives at `context.flowV2.stage` (top-level, sibling
 *     to the profile) once Phase 2's dispatcher exists — keeping a
 *     duplicate `profile.stage` would create two sources of truth for the
 *     same fact.
 *  2. Field names intentionally do NOT reuse the old V2 profile's names
 *     (e.g. `qualification` not `currentQualification`) — this is a
 *     deliberately separate schema. Each slot below with a clear old-V2
 *     equivalent notes it in its description for future bridging
 *     reference only (no functional coupling).
 *  3. The old generic `bridgeAttempted` / `bridgeClosed` pair was
 *     ambiguous — it has been split into two unrelated fork pairs so
 *     Phase 2 can't wire the wrong flag to the wrong fork:
 *       - `coreBridgeAttempted` / `coreBridgeClosed` — B2.2's
 *         core-engineering fork (mechanical/civil/ECE nudge).
 *       - `predictorBridgeShown` / `predictorBridgeChoice` — R4-P's
 *         "show me both routes" honest bridge.
 *  4. `predictedColleges` (raw R4-P/CollegeDost output, rank-gated,
 *     unfiltered), `shortlist` (B5's narrowed, scored, new-age-catalog
 *     list), and `recommendation` (B6's single named pick with
 *     why-bullets) are kept as three distinct slots — confirmed intent,
 *     do not collapse.
 *
 * TRI-STATE POLICY for `boolean`/`object` slots: `null` = "not yet
 * determined", `true`/`false` (or a populated object) = "determined".
 * `nextSlot()` gates on `=== null`, never on falsiness.
 */
const LEAD_PROFILE_SCHEMA = Object.freeze({
  // Identity/source metadata from Part 13. These are persistent profile
  // slots but not conversational questions, so they are system-owned and
  // deliberately excluded from BEAT_ORDER/nextSlot gating.
  phone: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Canonical WhatsApp phone number for the lead.',
  }),
  name: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['B1', 'B10', 'system'],
    description: 'Accepted first/display name used by B1 QUALIFY; null until known confidently.',
  }),
  language: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Detected/preferred conversation language.',
  }),
  proxy: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Who the conversation is on behalf of, when not the student.',
  }),
  source: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Lead source such as campaign, form, or organic WhatsApp.',
  }),
  campaign: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Campaign identifier when present.',
  }),
  rawFirstMessage: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'First inbound message stored verbatim, including when a list row is also tapped.',
  }),
  createdAt: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Lead creation timestamp in a serializable form.',
  }),
  botState: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Persisted bot-state identifier; Flow v2 stage remains context.flowV2.stage.',
  }),
  qualification: Object.freeze({
    type: 'string',
    askable: true,
    writeBeats: ['B1'],
    readBeats: ['B1', 'B2', 'B8'],
    description:
      "Student's current qualification/class (e.g. 'Class 12', 'Diploma', 'B.Tech 2nd year'). Written at B1 QUALIFY.",
  }),
  stream: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['B1', 'B2'],
    description: 'Qualification stream such as PCM, PCB, Commerce, or Arts.',
  }),
  entryType: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['B1', 'B8'],
    description: 'regular, lateral, or dropper entry context.',
  }),
  timeline: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['B1', 'B8'],
    description: 'Planning timeline such as next_year.',
  }),
  /** V3 B2 GOAL — branch_fit | career_scope | college_fit */
  goal: Object.freeze({
    type: 'string',
    askable: true,
    writeBeats: ['B2'],
    readBeats: ['B2', 'B4', 'B8'],
    description: 'B2 GOAL tap: branch_fit | career_scope | college_fit.',
  }),
  /**
   * V3 B4 PRIORITY list (was v2 B1 goalPriority). Kept as goalPriority for
   * backward-compatible merges; writers may also set `priority` synonym via merge.
   */
  goalPriority: Object.freeze({
    type: 'array',
    askable: true,
    writeBeats: ['B4'],
    readBeats: ['B4', 'B5', 'B8', 'B9'],
    description:
      "Ordered list of what matters most (e.g. ['placements','fees']). V3 B4 PRIORITY.",
  }),
  careerGoal: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['B2', 'B3', 'B8'],
    description: 'Career outcome stated by the student; intentionally distinct from goal / goalPriority.',
  }),
  /** V3 B3 INTEREST multi-select */
  interests: Object.freeze({
    type: 'array',
    askable: true,
    writeBeats: ['B3'],
    readBeats: ['B3', 'B3.2', 'B5', 'B8'],
    description: 'Interest rows selected at B3 (cap 4).',
  }),
  interestCluster: Object.freeze({
    type: 'string',
    writeBeats: ['B3'],
    readBeats: ['B3', 'B5', 'B8'],
    description: 'Derived cluster: software | data_ai | infra_security | core | undecided.',
  }),
  branchInterest: Object.freeze({
    type: 'string',
    writeBeats: ['B3'],
    readBeats: ['B3', 'B8'],
    description:
      'Preferred branch/course of study (e.g. CSE, ECE). Derived from interests or free text.',
  }),
  coreBridgeAttempted: Object.freeze({
    type: 'boolean',
    writeBeats: ['B3'],
    readBeats: ['B3'],
    description:
      "B3.2 core-engineering fork: whether the nudge has been offered. Do not confuse with predictorBridgeShown.",
  }),
  coreBridgeClosed: Object.freeze({
    type: 'boolean',
    writeBeats: ['B3'],
    readBeats: ['B3'],
    description: 'B3.2 core-engineering fork: whether the nudge has been resolved/closed.',
  }),
  coreInterest: Object.freeze({
    type: 'string',
    writeBeats: ['B3'],
    readBeats: ['B3', 'B8'],
    description: 'B3.2: specific core field (mechanical/civil/ece) for the fork.',
  }),
  budgetBand: Object.freeze({
    type: 'string',
    askable: true,
    writeBeats: ['B6.5'],
    readBeats: ['B6.5', 'B8'],
    description:
      "Coarse budget bucket (e.g. 'under_2l', '2_5l'). Asked at B6.5 after permission.",
  }),
  cityPref: Object.freeze({
    type: 'string',
    askable: true,
    writeBeats: ['B6.5'],
    readBeats: ['B6.5', 'B8'],
    description: 'Preferred city/location or relocation stance. Asked at B6.5.',
  }),
  city: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['B6.5', 'B8'],
    description: 'Specific city named by the lead when distinct from relocation stance.',
  }),
  state: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['B6.5', 'B8'],
    description: 'Specific state named by the lead.',
  }),
  scholarshipFlag: Object.freeze({
    type: 'boolean',
    writeBeats: ['B4', 'B6.5'],
    readBeats: ['B4', 'B6.5', 'B8'],
    description: 'Whether the student indicated scholarship / financial-aid need.',
  }),
  parentConstraints: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system', 'B8'],
    description:
      "I-3 family interrupt: 'nearby' | 'known_brand' | 'student_call' — only set when the student raises parents.",
  }),
  isParent: Object.freeze({
    type: 'boolean',
    writeBeats: ['system'],
    readBeats: ['system', 'B8'],
    description: 'Whether the person chatting is a parent/guardian rather than the student.',
  }),
  checklistSent: Object.freeze({
    type: 'boolean',
    writeBeats: ['B5'],
    readBeats: ['B5', 'B6', 'system'],
    description: 'B5 CHECKLIST delivered; blocks re-send on return (R13).',
  }),
  permissionRecommend: Object.freeze({
    type: 'boolean',
    writeBeats: ['B6'],
    readBeats: ['B6', 'B6.5', 'B8'],
    description: 'B6 PERMISSION gate: true = yes show colleges; false = not right now.',
  }),
  frameSent: Object.freeze({
    type: 'boolean',
    writeBeats: ['B7'],
    readBeats: ['B7', 'B8'],
    description: 'B7 TWO MODELS framing bubble delivered.',
  }),
  followupsSent: Object.freeze({
    type: 'number',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'B10-F nudge count (0 | 1 | 2 | 3).',
  }),
  bookingFollowup: Object.freeze({
    type: 'object',
    writeBeats: ['B10', 'system'],
    readBeats: ['B10', 'system'],
    description: 'Maybe Later follow-up schedule: declinedAt + sentLevels for +30m/+1h/+3h.',
  }),
  callbackNumber: Object.freeze({
    type: 'string',
    writeBeats: ['B10'],
    readBeats: ['B10'],
    description: 'Alternate callback number collected at B10.3 when distinct from WA.',
  }),
  honestPassFired: Object.freeze({
    type: 'boolean',
    writeBeats: ['B9'],
    readBeats: ['B9', 'system'],
    description: 'B9 FIT honest-pass path was taken (fit below threshold).',
  }),
  fitCollege: Object.freeze({
    type: 'string',
    writeBeats: ['B9'],
    readBeats: ['B9', 'B10'],
    description: 'B9 FIT named college when narrowed.',
  }),
  fitReason: Object.freeze({
    type: 'string',
    writeBeats: ['B9'],
    readBeats: ['B9', 'B10'],
    description: 'B9 FIT reason line for the named college.',
  }),
  examType: Object.freeze({
    type: 'string',
    writeBeats: ['B4'],
    readBeats: ['B4'],
    description: 'Entrance exam identifier (e.g. AP_EAMCET, JEE_MAIN). Old profile equivalent: profile.exam.',
  }),
  rank: Object.freeze({
    type: 'number',
    writeBeats: ['B4'],
    readBeats: ['B4'],
    description: 'Exam rank. Old profile equivalent: profile.rank.',
  }),
  percentile: Object.freeze({
    type: 'number',
    writeBeats: ['B4'],
    readBeats: ['B4'],
    description:
      'Exam percentile, used instead of rank for percentile-based exams (e.g. MHT-CET). No old-profile equivalent (old profile only stores rank).',
  }),
  category: Object.freeze({
    type: 'string',
    writeBeats: ['B4'],
    readBeats: ['B4'],
    description: 'Reservation/category label (e.g. OC, BC-A, SC, ST). Old profile equivalent: profile.category.',
  }),
  gender: Object.freeze({
    type: 'string',
    writeBeats: ['B4'],
    readBeats: ['B4'],
    description: 'Gender, where required for category resolution. Old profile equivalent: profile.gender.',
  }),
  quota: Object.freeze({
    type: 'string',
    writeBeats: ['B4'],
    readBeats: ['B4'],
    description: 'Quota selection (e.g. WBJEE home/other-state quota). Old profile equivalent: profile.reservationCategory (loosely).',
  }),
  region: Object.freeze({
    type: 'string',
    writeBeats: ['B4'],
    readBeats: ['B4'],
    description: 'Region selection (e.g. AP AU/SVU). Old profile equivalent: profile.region.',
  }),
  admissionType: Object.freeze({
    type: 'string',
    writeBeats: ['B4'],
    readBeats: ['B4'],
    description:
      "R4-P Stage 2 addition (not in the original Phase 1 schema — KCET/MHT-CET's slot order needs it as its own gated question before category, discovered while implementing slotOrderForExam()'s SLOT_ADMISSION_TYPE step; added additively, no existing field repurposed). Admission-type selection (e.g. KCET 'GENERAL'/'HK'; MHT-CET 'STATE_LEVEL'/'HOME_UNIVERSITY'/'OTHER_THAN_HOME_UNIVERSITY'). Old profile equivalent: profile.admissionType (collegePredictorSlots.js ctx.admissionType).",
  }),
  predictorBridgeShown: Object.freeze({
    type: 'boolean',
    writeBeats: ['B4'],
    readBeats: ['B4'],
    description:
      "R4-P predictor fork: whether the 'show me both routes' honest bridge message has been sent to this student yet. null = not yet shown; true/false = shown and whether it applied. Unrelated to coreBridgeAttempted/coreBridgeClosed (a different fork).",
  }),
  predictorBridgeChoice: Object.freeze({
    type: 'string',
    writeBeats: ['B4'],
    readBeats: ['B4'],
    description:
      "R4-P predictor fork: the student's choice after predictorBridgeShown — 'both' | 'rank_only' | null (not yet chosen).",
  }),
  predictedColleges: Object.freeze({
    type: 'array',
    writeBeats: ['B4'],
    readBeats: ['B4', 'B5'],
    description:
      "Raw eligible colleges returned by the predictor for this profile, before narrowing. See judgment call #4 above (old profile equivalent: profile.recommendedColleges, which conflates raw + narrowed). BEAT LABEL NOTE (Phase 6): 'B4' here refers to the not-yet-built R4-P predictor-bridge sub-flow ('show me both routes' honest bridge — see predictorBridgeShown/predictorBridgeChoice below), NOT the already-built b4Bridge.js 'B4 Bridge' node (Phase 5's plain transition message, which writes no slots at all). These are two different things that happen to share the letter B4 in this schema's provisional beat mapping — left as-is rather than guessing at the predictor sub-flow's eventual real beat placement.",
  }),
  filtersUsed: Object.freeze({
    type: 'array',
    writeBeats: ['B4'],
    readBeats: ['B4'],
    description:
      "Filters the student applied to narrow predictedColleges (e.g. district, branch). No direct old-profile equivalent. Same BEAT LABEL NOTE as predictedColleges above — belongs to the not-yet-built R4-P predictor-bridge sub-flow, not to the already-built b4Bridge.js node.",
  }),
  collegeOfInterest: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['B5', 'B6'],
    description: 'Named college the student asked about or pinned for comparison.',
  }),
  concerns: Object.freeze({
    type: 'array',
    writeBeats: ['system'],
    readBeats: ['system', 'B6'],
    description: 'Append/dedupe list of volunteered concern categories.',
  }),
  hesitations: Object.freeze({
    type: 'array',
    writeBeats: ['system'],
    readBeats: ['system', 'B7'],
    description: 'Append/dedupe list of volunteered hesitation categories.',
  }),
  shortlist: Object.freeze({
    type: 'array',
    writeBeats: ['B8'],
    readBeats: ['B8', 'B9'],
    description:
      'Narrowed set of colleges shown at B8 SHORTLIST. Interim Phase 1 legacy shortlist node may still write this before Phase 2 remaps file names.',
  }),
  comparedColleges: Object.freeze({
    type: 'array',
    writeBeats: ['B9'],
    readBeats: ['B9'],
    description: 'Subset of shortlist selected for side-by-side comparison (B9 FIT on-tap).',
  }),
  recommendation: Object.freeze({
    type: 'string',
    writeBeats: ['B9'],
    readBeats: ['B9', 'B10'],
    description: 'Single best-fit college from B9 FIT.',
  }),
  temperature: Object.freeze({
    type: 'string',
    writeBeats: ['B6', 'system'],
    readBeats: ['B6', 'B10'],
    description: "Lead heat signal (e.g. 'hot', 'warm', 'cold').",
  }),
  door: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system', 'B10'],
    description: "Entry door / bucket (e.g. 'booking_intent', R-bucket).",
  }),
  jumpType: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description:
      "R4 jump-ahead subtype when door = jumps_ahead: 'rank' | 'college' | 'money' | 'goal' | 'best' | 'admission' | 'vs'.",
  }),
  bookingStatus: Object.freeze({
    type: 'string',
    writeBeats: ['B10', 'system'],
    readBeats: ['B10', 'system'],
    description: "Status of the booking/handoff step (e.g. 'not_started', 'link_sent', 'deferred').",
  }),
  doorHistory: Object.freeze({
    type: 'array',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Append-only log of turn-level entries for analytics.',
  }),

  // --- Router bookkeeping slots (Phase 3 — added for classifyReply()/handlers,
  // not owned by any B1-B7 beat, hence writeBeats/readBeats: ['system']). ---

  crisisLocked: Object.freeze({
    type: 'boolean',
    writeBeats: ['system'],
    readBeats: ['system'],
    description:
      "R7 Tier-2 permanent lock. null = never triggered; true = a crisis/self-harm signal was detected and this conversation must never be auto-resumed by Flow v2 bot logic again (see flowV2Dispatcher's crisis-lock check, which runs before Node 0). Never set to false once true.",
  }),
  crisisHandoffId: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description:
      "WhatsAppAgentHandoff ticket id created when crisisLocked was set to true, for traceability back to the real admin-visible ticket (reason: 'crisis_escalation'). null until crisisLocked fires.",
  }),
  optedOut: Object.freeze({
    type: 'boolean',
    writeBeats: ['system'],
    readBeats: ['system'],
    description:
      "R6 deflect bucket: whether the student explicitly opted out ('not interested' / 'stop' / \"don't message me\"). null = not opted out; true = opted out, no further retention attempts.",
  }),
  spam: Object.freeze({
    type: 'boolean',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Permanent spam/vendor close flag.',
  }),
  outOfScope: Object.freeze({
    type: 'boolean',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Whether the requested path is outside automated Flow v2 scope.',
  }),
  conflict: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system', 'B7'],
    description: 'Volunteered conflict such as parental pressure.',
  }),
  escalateHuman: Object.freeze({
    type: 'boolean',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Whether a non-crisis route requires human escalation.',
  }),
  status: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Current lead lifecycle status.',
  }),
  exitReason: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Terminal/park reason from Part 14.',
  }),
  nudgeSent: Object.freeze({
    type: 'boolean',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Global lifetime one-nudge gate; true prevents every later timeout nudge.',
  }),
  nudgeSentAt: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['system'],
    description: 'Timestamp of the single allowed timeout nudge.',
  }),
  hostileRedirectIssued: Object.freeze({
    type: 'boolean',
    writeBeats: ['system'],
    readBeats: ['system'],
    description:
      'R12 hostile/testing bucket: whether the one-time joke-and-redirect reply has already been sent to this student. null/false = not yet sent (send the full redirect); true = already sent once, so any further R12 hit gets the short line only, never the joke+buttons again.',
  }),
});

/** All slot keys, in schema declaration order. */
function getSlotKeys() {
  return Object.keys(LEAD_PROFILE_SCHEMA);
}

/** Slot keys writable by a given beat, in schema declaration order. */
function getSlotsForBeat(beat) {
  return getSlotKeys().filter((key) => LEAD_PROFILE_SCHEMA[key].writeBeats.includes(beat));
}

/** Slot keys readable (for skip/input logic) by a given beat, in schema declaration order. */
function getSlotsReadByBeat(beat) {
  return getSlotKeys().filter((key) => LEAD_PROFILE_SCHEMA[key].readBeats.includes(beat));
}

/**
 * Fresh Flow v2 profile with every schema slot initialized to its
 * type-appropriate empty default: string/number/boolean/object -> null
 * ("not yet determined"), array -> [].
 */
function emptyFlowV2Profile() {
  const profile = {};
  for (const key of getSlotKeys()) {
    profile[key] = defaultForType(LEAD_PROFILE_SCHEMA[key].type);
  }
  return profile;
}

module.exports = {
  SLOT_TYPES,
  BEATS,
  BEAT_ORDER,
  LEAD_PROFILE_SCHEMA,
  getSlotKeys,
  getSlotsForBeat,
  getSlotsReadByBeat,
  emptyFlowV2Profile,
  defaultForType,
};
