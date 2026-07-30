# Lead Profile Contract — Flow V3

**Status:** Proposed
**Date:** 2026-07-30
**Companion to:** `FLOW_V3_LLM_ARCHITECTURE.md` §5, `TOOL_CONTRACT.md`
**Supersedes:** the 75-slot `LEAD_PROFILE_SCHEMA` (extends it — no existing slot is removed or renamed)

---

## 0. The two rules that govern this whole schema

```
RULE A — STATED AND INFERRED ARE NEVER THE SAME FIELD
├── every slot carries meta { source, confidence, verbatimQuote, setAt, turnId }
├── source ∈ button | typed | extracted | inferred | counsellor | system
├── AUTHORITATIVE   = button · typed · extracted · counsellor
├── NON-AUTHORITATIVE = inferred   (LLM's read of tone, subtext, implication)
└── An inferred slot MAY shape how the bot phrases things.
    An inferred slot MAY NOT:
      ✗ be shown to a counsellor as fact (it renders as "sounds like…", with the quote)
      ✗ gate a recommendation, filter a shortlist, or feed the predictor
      ✗ satisfy nextSlot() — an inferred slot still counts as EMPTY and gets asked
    Rationale: inventing data and collecting data must stay distinguishable. This is the
    fabricated-confidence-tier failure in a different costume.

RULE B — CODE WRITES BEHAVIOUR, THE MODEL WRITES CONTENT
├── every field in group H (engagement) is computed by the pipeline, never by the LLM
└── Rationale: a model scoring its own conversation will flatter it. Latency, turn counts and
    skip patterns are facts the pipeline already knows.
```

---

## 1. Schema

Legend — **Cap**ture: `btn` button · `txt` typed · `ext` regex-extracted · `inf` LLM-inferred ·
`sys` computed · `cns` counsellor. **Auth**: authoritative. **Stale**: `V` volatile (per admission
year) · `S` stable · `F` soft (180d) · `—` n/a. **Sens**: sensitivity tier (§3).

### A. Identity & contact

| Field | Type | Cap | Auth | Stale | Sens |
|---|---|---|---|---|---|
| `phone` | string, unique | sys | ✓ | S | 2 |
| `name` | string | txt | ✓ | S | 2 |
| `preferredName` | string | txt | ✓ | S | 1 |
| `language` | enum | ext/inf | ✓ | F | 1 |
| `altContact` | string | txt | ✓ | S | 2 |
| `callbackNumber` | string | txt | ✓ | S | 2 |
| `isProxy` | bool | ext | ✓ | S | 1 |
| `proxyRelation` | enum: parent·sibling·relative·friend·teacher | txt | ✓ | S | 1 |
| `city` `state` `district` `pincode` | string | txt/ext | ✓ | F | 2 |
| `locality` | enum: metro·tier2·tier3·rural | inf | ✗ | F | 2 |
| `consentAt` | date | sys | ✓ | — | — |
| `consentVersion` | string | sys | ✓ | — | — |
| `isMinor` | bool | sys, derived from `passingYear`/`qualification` | ✓ | V | 3 |

### B. Academic — current

| Field | Type | Cap | Auth | Stale | Sens |
|---|---|---|---|---|---|
| `qualification` | enum (10 existing rows) | btn | ✓ | S | 1 |
| `stream` | enum: pcm·pcb·pcmb·commerce·arts·diploma | btn/ext | ✓ | S | 1 |
| `board` | enum: cbse·icse·state·ib·nios·other | txt | ✓ | S | 1 |
| `boardState` | string | txt | ✓ | S | 1 |
| `medium` | enum: english·hindi·telugu·other | txt/inf | ✓ | S | 1 |
| `schoolName` | string | txt | ✓ | S | 2 |
| `passingYear` | int | txt/ext | ✓ | S | 1 |
| `targetAdmissionYear` | int | txt/sys | ✓ | S | 1 |
| `entryType` | enum: fresher·dropper·repeater·lateral·transfer | btn/ext | ✓ | S | 1 |
| `attemptNumber` | int | txt | ✓ | V | 1 |
| `marks10` | number | txt | ✓ | S | 2 |
| `marks12` | number | txt | ✓ | S | 2 |
| `marks12Status` | enum: final·predicted·awaiting | txt | ✓ | V | 1 |
| `subjectStrengths` | array | txt/inf | ✓ | F | 1 |
| `mathComfort` | enum: strong·ok·weak | txt/inf | ✓ | F | 1 |
| `codingExposure` | enum: none·school·self·bootcamp | txt/inf | ✓ | F | 1 |
| `coachingInstitute` | string | txt | ✓ | S | 2 |

### C. Exams — **now an array** (fixes a real modelling bug)

The existing schema holds ONE `examType` + `rank`. Students routinely sit JEE Main **and** a state
CET **and** BITSAT; the second result currently overwrites the first.

```
examResults[]  — one entry per exam sat or planned
├── exam ............ enum (existing exam constants)
├── status .......... planned | appeared | result_awaited | scored | not_qualified
├── rank ............ number            [V]
├── percentile ...... number            [V]
├── score ........... number            [V]
├── category ........ enum — REQUIRED by CollegeDost, not optional      [Sens 3]
├── quota ........... enum              [V]
├── region .......... enum              [V]
├── admissionType ... enum              [V]
├── gender .......... enum — REQUIRED by the AP-OC-male gate (S-1)       [Sens 3]
├── attemptYear ..... int
├── isPrimary ....... bool — which exam the student is actually banking on
└── meta ............ { source, confidence, verbatimQuote, setAt, turnId }

LEGACY MIRROR (do not remove — Flow V2 and the predictor read these)
├── examType · rank · percentile · category · gender · quota · region · admissionType
└── mirrored from the isPrimary entry on every write, one-directional, never read back
```

`category` and `gender` are **mandatory and authoritative-only** — never inferred. They are the
inputs to the AP-OC-male block (S-1) and to every cutoff computation. An inferred value here
produces a confidently wrong rank list, which is the exact harm S-1 exists to prevent.

### D. Goals & interests

| Field | Type | Cap | Auth | Stale | Sens |
|---|---|---|---|---|---|
| `goal` | enum | btn | ✓ | F | 1 |
| `goalPriority` | enum | btn | ✓ | F | 1 |
| `careerGoal` | string | txt | ✓ | F | 1 |
| `goalClarity` | enum: clear·exploring·no_idea | inf | ✗ | F | 1 |
| `interests[]` | array, cap 4 | btn | ✓ | F | 1 |
| `branchInterest` | enum | btn/ext | ✓ | F | 1 |
| `interestCluster` | enum | sys | ✓ | F | 1 |
| `coreInterest` | bool | btn | ✓ | F | 1 |
| `coreBridgeAttempted` `coreBridgeClosed` | bool | sys | ✓ | — | 1 |
| `dreamCollege` | string | txt | ✓ | F | 1 |
| `collegeOfInterest[]` | array | txt/ext | ✓ | F | 1 |
| `higherStudyIntent` | enum: none·ms_abroad·mtech·mba·unsure | txt/inf | ✓ | F | 1 |
| `abroadIntent` | bool | txt | ✓ | F | 1 |

### E. Decision-making unit — *who you are actually selling to*

| Field | Type | Cap | Auth | Stale | Sens |
|---|---|---|---|---|---|
| `decisionMaker` | enum: student·father·mother·both_parents·relative·mentor·joint | txt/inf | ✓ | F | 2 |
| `decisionMakerPresent` | bool — is the decider in this chat | inf | ✗ | — | 1 |
| `payer` | enum: parents·self·loan·scholarship·relative·mixed | txt | ✓ | F | 2 |
| `parentInvolvement` | enum: high·moderate·low | inf | ✗ | F | 2 |
| `parentStance` | enum: aligned·wants_traditional·wants_nearby·wants_brand·opposed·unknown | txt/inf | ✓ | F | 2 |
| `parentConstraints[]` | array | txt | ✓ | F | 2 |
| `familyPrecedent` | string — "cousin went to X" | txt | ✓ | F | 2 |
| `firstGenerationCollege` | bool — **only if volunteered** | txt | ✓ | S | 3 |
| `advisorInfluence` | enum: coaching·school·relative·online·none | txt/inf | ✓ | F | 1 |

`decisionMaker` is the field most likely to change how a counsellor opens the call, and it is
almost never captured today. Note it is capturable as **stated** — ask "who's helping you decide?"
rather than inferring it from who typed.

### F. Constraints — budget disambiguated

One `budgetBand` field currently hides a ~4x range (₹2L/year tuition vs ₹2L all-in total).

| Field | Type | Cap | Auth | Stale | Sens |
|---|---|---|---|---|---|
| `budgetBand` | enum (legacy, keep) | btn | ✓ | F | 2 |
| `budgetAmount` | number | txt | ✓ | F | 2 |
| `budgetBasis` | enum: **per_year · total** | txt | ✓ | F | 2 |
| `budgetScope` | enum: **tuition_only · all_in** | txt | ✓ | F | 2 |
| `budgetFlexibility` | enum: firm·stretchable·unknown | txt/inf | ✓ | F | 2 |
| `loanWillingness` | enum: yes·no·maybe·unaware | txt | ✓ | F | 2 |
| `scholarshipDependency` | enum: essential·helpful·not_needed | txt | ✓ | F | 2 |
| `scholarshipFlag` | bool (legacy) | ext | ✓ | F | 1 |
| `cityPref` | string | btn/txt | ✓ | F | 1 |
| `relocationWillingness` | enum: anywhere·same_state·within_Nhrs·home_city_only | txt | ✓ | F | 1 |
| `maxTravelHours` | number | txt | ✓ | F | 1 |
| `hostelPreference` | enum: hostel·day_scholar·either | txt | ✓ | F | 1 |
| `genderConstraint` | bool + note — family limits on distance/hostel | txt | ✓ | F | 3 |
| `accessibilityNeeds` | string — **only if volunteered, never asked** | txt | ✓ | S | 4 |
| `timelinePressure` | enum: admissions_open·deadline_weeks·next_year·browsing | txt/inf | ✓ | V | 1 |

### G. Objections — structured, replacing free-text `concerns[]`

```
objections[]
├── type ........ fee_too_high | brand_unknown | placement_doubt | distance |
│                 parent_disagreement | coding_fear | core_branch_preference |
│                 accreditation_doubt | competitor_better | trust_deficit |
│                 course_content | hostel_safety | roi_doubt | other
├── raisedAtTurn . int
├── verbatim ..... string — the student's own words, always stored
├── status ....... open | addressed | resolved | escalated | unresolved_at_exit
├── addressedHow . string — which tool result or argument was used
└── severity ..... blocking | significant | passing        [inf, non-authoritative]

competitorsMentioned[]
├── name ......... string — verbatim as the student said it
├── context ...... comparing | already_applied | parent_prefers | friend_attending | rejected_it
└── turnId
LEGACY: concerns[] · hesitations[] retained and mirrored — Flow V2 reads them.
```

`competitorsMentioned` is high-value market intelligence that is currently discarded entirely.

### H. Engagement & behaviour — **computed by code, never by the LLM**

| Field | Type | Notes |
|---|---|---|
| `turnCount` `sessionCount` | int | |
| `firstSeenAt` `lastSeenAt` | date | |
| `medianResponseSec` `longestGapHours` | number | latency is an intent signal |
| `typedRatio` | 0–1 | typed > button ⇒ higher engagement |
| `questionsAsked` | int | student-initiated questions |
| `beatsCompleted[]` `beatsSkipped[]` | array | where attention drops |
| `dropOffBeat` | string | last beat before silence |
| `interruptsFired[]` | array | I-1…I-9 |
| `fallbackTiersHit[]` | array | tier-2/3 fallbacks this lead experienced |
| `activeHourBucket` | enum: school_hours·evening·late_night | *who is holding the phone* |
| `deviceLocale` | string | |
| `messageMediaTypes[]` | array | image/voice attempts (no OCR today — G-9/R9) |
| `reEngagedAfterFollowup` | bool | |
| `bookingUrlSentAt` `bookingUrlClicked` | date/bool | requires UTM on the booking URL |

### I. Funnel state — code-written only

| Field | Type | Notes |
|---|---|---|
| `leadStage` | enum: `new · engaged · qualified · shortlist_seen · link_sent · booked · attended · enrolled · lost · parked` | **monotonic**, code-written; the LLM cannot advance it |
| `leadStageHistory[]` | `{stage, at, reason}` | append-only |
| `qualifiedAt` `shortlistSeenAt` | date | |
| `bookingStatus` | enum: null → `link_sent` → `done` | existing state machine, unchanged (S-4) |
| `exitReason` | enum: booked·core_exit·honest_pass·out_of_scope·opted_out·silence·crisis·blocked_demographic | |
| `parkedAs` | enum: parked_core·parked_warm·parked_rank_list | |
| `escalatedToHuman` `escalationReason` | bool/enum | |
| `crisisLocked` | bool | permanent, never unset (S-2) |
| `optedOut` `spam` `outOfScope` `conflict` | bool | legacy, retained |

### J. Recommendation record — what the student was actually shown

Auditability: if a student says "you told me X", this proves what was sent.

```
shownArtifacts[]
├── kind ......... curated_shortlist | predictor_list | comparison | checklist | two_models_frame
├── catalog ...... curated | predictor        ← never both in one entry (P-4 / S-5)
├── rows[] ....... { id, name, sourceToolCallId }
├── shownAtTurn .. int
├── disclosureIncluded  bool                 ← V-6 audit trail
└── groundingIds[] array
fitCollege · fitReason · shortlistAskDeclined · honestPassFired · niatInterest   (legacy, kept)
```

### K. Outcome — closes the learning loop

| Field | Type | Cap |
|---|---|---|
| `counsellorAssigned` `sessionScheduledAt` `sessionAttended` | mixed | cns/sys |
| `counsellorNotes` | string | cns |
| `counsellorCorrections[]` | `{slot, botValue, actualValue}` | cns — **this is your extraction eval set** |
| `enrolledCollege` `enrolledBranch` `enrolledAt` | mixed | cns |
| `lostReason` | enum | cns |
| `npsScore` `feedbackVerbatim` | mixed | txt |

`counsellorCorrections[]` is the highest-leverage field in this schema: every correction is a
labelled example of the extractor or the LLM getting a slot wrong. Without it you have no ground
truth on capture quality.

---

## 2. Slot meta — attached to every field

```
slotMeta: { <fieldPath>: {
  source ......... button | typed | extracted | inferred | counsellor | system
  confidence ..... 0–1        (required when source='inferred')
  verbatimQuote .. string     (required when source ∈ typed | extracted | inferred)
  setAt .......... date
  turnId ......... string
  academicYear ... int        (volatile fields only — drives staleness)
  supersededBy ... turnId     (set when a later turn corrects this)
  history[] ...... prior values, append-only
} }
```

`verbatimQuote` is mandatory on anything derived from free text. It is what lets a counsellor see
*what the student actually said* rather than the bot's compression of it — and what lets you debug
a bad extraction after the fact.

---

## 3. Sensitivity tiers, retention, access

Most of this profile now describes a **minor**. Tiering is a design requirement, not paperwork.

```
TIER 1  FUNNEL      goal · interests · priority · engagement · leadStage
├── retention .... indefinite
└── access ....... bot · counsellor · analytics (aggregate)

TIER 2  IDENTITY    name · phone · school · city · marks · budget · family stance
├── retention .... 24 months from lastSeenAt, then anonymise (hash phone, drop name/school)
└── access ....... bot · assigned counsellor · admin. NOT in aggregate exports.

TIER 3  PROTECTED   category · gender · genderConstraint · firstGenerationCollege · isMinor
├── retention .... purpose-bound — required for cutoff computation and the S-1 gate, nothing else
├── access ....... predictor tool + assigned counsellor only
└── NEVER inferred · NEVER used for segmentation, targeting or messaging variation

TIER 4  VOLUNTEERED accessibilityNeeds · health mentions · crisis context
├── retention .... crisis records per existing handoff policy; the rest 6 months
├── access ....... assigned counsellor only; excluded from every export and every LLM prompt
└── NEVER asked for — stored only when the student volunteers it unprompted

DO NOT BUILD  (deliberate exclusions, not omissions)
├── ✗ inferred personality / emotional-state profiling
│     e.g. anxious · low_confidence · easily_pressured · responds_to_urgency · desperation_score
│     A field named "easily pressured" has exactly one use, and it contradicts the product's
│     honest-exit design. Excluded on purpose.
├── ✗ persuasion-vulnerability or urgency-susceptibility scoring
├── ✗ inferred caste, religion, or socioeconomic class
│     `category` is captured because CollegeDost requires it for cutoffs. Nothing beyond that.
├── ✗ inferred family income (capture STATED budget, not estimated affluence)
└── ✗ any Tier 3 or Tier 4 field in an LLM prompt beyond what the current turn strictly needs

OPEN — needs legal review before Phase 2
├── DPDP children's-data provisions: parental consent and limits on behavioural profiling of
│   minors. The retention tiers above are a defensible default, not a compliance opinion.
├── consentAt / consentVersion imply a first-contact disclosure line that does not exist yet →
│   TODO(copy), and it is student-facing, so I am not drafting it.
└── decide whether `isMinor === true` should suppress group H behavioural profiling entirely
```

---

## 4. Counsellor brief — generated, not stored

A counsellor should not read 150 fields. The brief is generated on demand from the profile and
**must visibly separate stated from inferred**.

```
buildCounsellorBrief(profile) → {
  header ......... name · qualification · primary exam + rank + category · city · leadStage
  stated[] ....... authoritative slots only, each with its verbatimQuote
  inferred[] ..... non-authoritative, rendered as "sounds like…" + quote + confidence
                    NEVER rendered as fact
  shown[] ........ exactly which colleges/artifacts the bot displayed, from shownArtifacts
  objections[] ... type · verbatim · status
  competitors[] .. names + context
  openSlots[] .... what the bot did NOT get, so the counsellor knows what to ask
  doNotSay[] ..... derived from gates: blocked demographic · crisis history · unresolved
                    pricing sensitivity · out-of-scope areas already refused
  transcriptLink . the turn log
}
```

`doNotSay[]` matters: a counsellor calling a student the bot correctly refused to predict for must
not open by quoting a rank list.

---

## 5. Implementation notes for M-1

```
├── EXTEND, DO NOT REPLACE. Import LEAD_PROFILE_SCHEMA from
│   constants/careerCounsellingFlowV2Profile.js and add to it. All 75 existing slot names keep
│   their names and semantics — Flow V2 and the predictor read them.
├── LEGACY MIRRORS are one-directional: examResults[isPrimary] → flat examType/rank/category/…
│   Write the mirror on every examResults write. Never read the mirror back into examResults.
├── flowV2ProfileMerge.js semantics still apply to the extension: unknown keys dropped, nulls
│   never clobber, arrays concat+dedupe, append-only history. Extend it for nested paths;
│   do not fork it.
├── nextSlot() must treat as EMPTY: (a) an unset slot, (b) a stale volatile slot,
│   (c) a slot whose only value is source='inferred'.
├── update_lead_profile(patch) requires source + verbatimQuote per key. A patch key with
│   source='inferred' and no confidence is REJECTED by the tool, not silently accepted.
├── The LLM may NOT write: group H, group I, consentAt, isMinor, leadStage, bookingStatus,
│   crisisLocked, any Tier 3 field. Enforce as a tool-level allowlist, not a prompt instruction.
└── Prompt payload is a PROJECTION, not the whole profile: non-null Tier 1–2 fields relevant to
    the current beat, plus open slots. Tier 3 only when the predictor needs it. Tier 4 never.
```

---

## 6. Field count

```
existing ....................  75  (all retained, unchanged)
new scalar fields ...........  ~78
new structured arrays .......   5  (examResults · objections · competitorsMentioned ·
                                     shownArtifacts · counsellorCorrections)
per-field meta ..............   ×1 slotMeta entry each
deliberately excluded .......   6 categories (§3 DO NOT BUILD)
```
