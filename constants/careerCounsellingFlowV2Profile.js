'use strict';

/**
 * Flow v2 — Lead Profile schema (declarative slot registry).
 *
 * Standalone module for the new "Flow v2" track (7 beats, B1-B7, ~6 student
 * turns). Intentionally isolated from the existing Career Counselling V2
 * profile (`careerCounsellingV2DiscoveryEngine.js#emptyProfile`) and its
 * dispatcher chain — no shared imports either direction.
 *
 * Beat ids used below (`entry`, `B1`-`B7`, `system`) follow the audit's
 * provisional beat mapping (B1 GOAL, B2 BRANCH, B3 CONSTRAINTS,
 * B4 PREDICT/SHORTLIST, B5 COMPARE/EXPLAIN, B6 DECIDE/CTA, B7 BOOK/HANDOFF).
 * This mapping has not yet been checked against the full Flow v2 spec doc —
 * treat `writeBeats`/`readBeats` as easy to adjust once that doc lands.
 *
 * `readBeats` records which beat(s) check a slot before asking their own
 * question (self-skip), plus any later beat that needs the value as an
 * input signal.
 */

const SLOT_TYPES = Object.freeze(['string', 'number', 'array', 'boolean', 'object']);

/** Beat walk order for `nextSlot()`. Excludes `system` (never "asked"). */
const BEAT_ORDER = Object.freeze(['entry', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']);

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
    readBeats: ['entry', 'system'],
    description: 'Accepted first/display name used by Node E; null until known confidently.',
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
    writeBeats: ['entry'],
    readBeats: ['entry', 'B1', 'B4'],
    description:
      "Student's current qualification/class (e.g. 'Class 12', 'Diploma', 'B.Tech 2nd year'). Old profile equivalent: profile.currentQualification.",
  }),
  stream: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['entry', 'B1'],
    description: 'Qualification stream such as PCM, PCB, Commerce, or Arts.',
  }),
  entryType: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['entry', 'B5'],
    description: 'regular, lateral, or dropper entry context.',
  }),
  timeline: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['B1', 'B5'],
    description: 'Planning timeline such as next_year.',
  }),
  goalPriority: Object.freeze({
    type: 'array',
    askable: true,
    writeBeats: ['B1'],
    readBeats: ['B1', 'B5'],
    description:
      "Ordered list of what matters most for the student's goal (e.g. ['placements','budget']). Old profile equivalent: profile.evaluationPriorities / profile.studentPriorities.",
  }),
  careerGoal: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['B1', 'B2', 'B5'],
    description: 'Career outcome stated by the student; intentionally distinct from goalPriority.',
  }),
  branchInterest: Object.freeze({
    type: 'string',
    askable: true,
    writeBeats: ['B2'],
    readBeats: ['B2', 'B4'],
    description:
      'Preferred branch/course of study (e.g. CSE, ECE). Old profile equivalent: profile.preferredCourse.',
  }),
  coreBridgeAttempted: Object.freeze({
    type: 'boolean',
    writeBeats: ['B2'],
    readBeats: ['B2'],
    description:
      "B2.2 core-engineering fork: whether the mechanical/civil/ECE 'core engineering' nudge has been offered to this student yet. null = not yet offered; true/false = offered and outcome known. Do not confuse with predictorBridgeShown (a different, unrelated fork).",
  }),
  coreBridgeClosed: Object.freeze({
    type: 'boolean',
    writeBeats: ['B2'],
    readBeats: ['B2'],
    description:
      'B2.2 core-engineering fork: whether the core-engineering nudge (see coreBridgeAttempted) has been resolved/closed out for this student. null = not yet resolved.',
  }),
  coreInterest: Object.freeze({
    type: 'string',
    writeBeats: ['B2'],
    readBeats: ['B2'],
    description:
      "B2.2 core-engineering fork: the specific core field (mechanical/civil/ece) the fork's evidence-bubble ('tell me more') sub-flow addresses. Corrected in Phase 4 from an earlier provisional writeBeats:['B1'] — this slot is actually written by the B2.2 core fork (services/chatbot/flowV2/nodes/b2CoreFork.js), never by B1 · Goal, once the real fork spec landed. No direct old-profile equivalent; closest is free-text profile.careerGoal.",
  }),
  budgetBand: Object.freeze({
    type: 'string',
    askable: true,
    writeBeats: ['B3'],
    readBeats: ['B3', 'B4'],
    description:
      "Coarse budget bucket (e.g. 'under_2l', '2_4l'). Old profile equivalent: profile.budgetPreference (free text there; banded here).",
  }),
  cityPref: Object.freeze({
    type: 'string',
    askable: true,
    writeBeats: ['B3'],
    readBeats: ['B3', 'B4'],
    description: 'Preferred city/location or relocation stance. Old profile equivalent: profile.preferredLocation.',
  }),
  city: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['B3', 'B5'],
    description: 'Specific city named by the lead when distinct from relocation stance.',
  }),
  state: Object.freeze({
    type: 'string',
    writeBeats: ['system'],
    readBeats: ['B3', 'B5'],
    description: 'Specific state named by the lead.',
  }),
  scholarshipFlag: Object.freeze({
    type: 'boolean',
    writeBeats: ['B3'],
    readBeats: ['B3', 'B4'],
    description:
      'Whether the student indicated scholarship / financial-aid need. No direct old-profile equivalent.',
  }),
  isParent: Object.freeze({
    type: 'boolean',
    writeBeats: ['B3'],
    readBeats: ['B3', 'B6'],
    description:
      'Whether the person chatting is a parent/guardian rather than the student. No direct old-profile equivalent (old profile only has free-text profile.parentPreferences).',
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
    writeBeats: ['B5'],
    readBeats: ['B5', 'B6'],
    description:
      'Narrowed set of colleges the student is actively considering. See judgment call #4 above (old profile equivalent: profile.preferredColleges / profile.recommendedColleges). BEAT LABEL CORRECTED in Phase 6 from an earlier provisional writeBeats:[\'B4\']/readBeats:[\'B4\',\'B5\'] — this slot is actually written by B5 · Shortlist (services/chatbot/flowV2/nodes/b5Shortlist.js) once that beat was actually built; B4 · Bridge (built in Phase 5) writes no slots at all.',
  }),
  comparedColleges: Object.freeze({
    type: 'array',
    writeBeats: ['B6'],
    readBeats: ['B6'],
    description:
      'Subset of shortlist selected for side-by-side comparison. Old profile equivalent: profile.comparedColleges (same name, same meaning). BEAT LABEL CORRECTED in Phase 6 from an earlier provisional writeBeats/readBeats:[\'B5\'] — this slot is actually written by B6 · The Case (services/chatbot/flowV2/nodes/b6TheCase.js) once that beat was actually built; B5 · Shortlist owns the narrowing step, not the compare step.',
  }),
  recommendation: Object.freeze({
    type: 'string',
    writeBeats: ['B6'],
    readBeats: ['B6', 'B7'],
    description:
      'Single best-fit college/branch the engine settled on for this student. See judgment call #4 above (old profile equivalent: profile.preferredCollege). BEAT LABEL CORRECTED in Phase 6 from an earlier provisional writeBeats:[\'B5\']/readBeats:[\'B5\',\'B6\'] — this slot is actually written by B6 · The Case (services/chatbot/flowV2/nodes/b6TheCase.js) once that beat was actually built.',
  }),
  temperature: Object.freeze({
    type: 'string',
    writeBeats: ['B6'],
    readBeats: ['B6'],
    description:
      "Lead-qualification heat signal (e.g. 'hot', 'warm', 'cold') derived from engagement/hesitation. New Flow v2 concept — no old-profile equivalent.",
  }),
  door: Object.freeze({
    type: 'string',
    writeBeats: ['B6'],
    readBeats: ['B6', 'B7'],
    description:
      "Which exit path ('door') the student is routed through at decision time (e.g. 'book_now', 'one_on_one', 'information_only'). New Flow v2 concept — no old-profile equivalent.",
  }),
  bookingStatus: Object.freeze({
    type: 'string',
    writeBeats: ['B6', 'B7'],
    readBeats: ['B6', 'B7'],
    description:
      "Status of the booking/handoff step (e.g. 'not_started', 'cta_presented', 'deferred', 'completed'). Old profile equivalent: profile.phase13Outcome / profile.phase13Service (loosely).",
  }),
  doorHistory: Object.freeze({
    type: 'array',
    writeBeats: ['system'],
    readBeats: ['B6'],
    description:
      'Append-only log of turn-level entries (door/beat/timestamp) for analytics on which R-bucket/door each turn passed through. New Flow v2 concept — no old-profile equivalent.',
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
