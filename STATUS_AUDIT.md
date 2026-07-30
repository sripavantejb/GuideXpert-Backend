# STATUS_AUDIT.md

Read-only audit of the GuideXpert chatbot counselling codebase. No code was modified.

- **Repo:** `/Users/guidexper/GuideXpert/GuideXpert-Backend`
- **Branch / HEAD:** `main` @ `f8135bd`
- **Working tree:** NOT clean — `guidedFlowOrchestrator.js` modified and
  `test/guidedFlowSpacing.test.js` deleted, uncommitted (see G-7). Claims below are stated
  against HEAD unless the tree differs, in which case both are given.
- **Date:** 2026-07-30
- **Method:** static read of source + `require`-graph tracing. Test suite was **not** run.

> **HEADLINE FINDING — read before planning any rewrite**
>
> There are **two independent counselling engines** in this repo, and the one all the frozen
> baseline docs describe is **no longer the live path for new students**.
>
> ```
> guidedFlowRegistry.js:49-60
> ├── career_counselling_flow_v2   → flowV2Dispatcher     ← LIVE for all new conversations
> └── career_counselling_journey   → careerCounsellingJourneyEngine (V1)  ← resume-only
> ```
>
> The `careerCounsellingV2*.js` Phase 1-14 chain (17,291 lines) has **zero external
> requirers** for its entry point (`careerCounsellingV2DiscoveryEngine.js`). Verified:
> `rg -l careerCounsellingV2DiscoveryEngine` returns no file outside itself.
> Only three of its modules are reachable from production, and only as **data libraries**
> imported by Flow V2 (see §1.3).

---

## 1. FILE INVENTORY

### 1.1 `services/chatbot/careerCounselling/careerCounsellingV2*.js` — 44 files, 13,988 lines

```
careerCounselling/
├── ENTRY + ORCHESTRATION
│   ├── careerCounsellingV2DiscoveryEngine.js ......... 643  Phase 1 Discovery slots; intended V2 entry — NO EXTERNAL REQUIRERS
│   ├── careerCounsellingV2PhaseOrchestrator.js ....... 418  Roadmap metadata only (ROADMAP_PHASE, NEXT_PHASE); does not dispatch turns
│   ├── careerCounsellingV2ResponseOptimizer.js ....... 225  Counselor envelope + 4-5 line cap (10 for educational)
│   ├── careerCounsellingV2ResponseParser.js .......... 245  Shared cross-phase skip/correction/greeting parser
│   └── careerCounsellingV2Analytics.js ............... 507  Structured logs, pipeline: 'career_counselling_v2'
│
├── PHASE ENGINES (turn state machine + profile writes + analytics)
│   ├── careerCounsellingV2EvaluationEngine.js ........ 610  Phase 3 priorities + framework permission
│   ├── careerCounsellingV2ModernEducationEngine.js ... 636  Phase 4 modern-education bridge (condensed + legacy multi-step)
│   ├── careerCounsellingV2ExploreModernCollegesEngine.js 230 Phase 5 curated 10-college showcase (never Earlywave)
│   ├── careerCounsellingV2PersonalizationEngine.js ... 920  Phase 6 career/location/budget/family/concerns
│   ├── careerCounsellingV2ShortlistingEngine.js ...... 914  Phase 7 exam/rank slots → eligibility → matrix → shortlist
│   ├── careerCounsellingV2ComparisonEngine.js ........ 512  Phase 8 side-by-side comparison
│   ├── careerCounsellingV2ConcernResolutionEngine.js . 543  Objection/concern branch off comparison
│   ├── careerCounsellingV2PersonalizedRecommendationEngine.js 247 Phase 9 synthesis (no re-rank)
│   ├── careerCounsellingV2FuturePathVisionEngine.js .. 224  Phase 10 confidence/vision copy
│   ├── careerCounsellingV2FinalDecisionHesitationEngine.js 539 Phase 11 hesitation + OOO escalation
│   ├── careerCounsellingV2CounselingExperienceSelectionEngine.js 304 Phase 12 service select (no URLs)
│   ├── careerCounsellingV2CounselingInvitationEngine.js 352 Legacy Section E invitation CTA
│   ├── careerCounsellingV2BookingOrchestratorEngine.js 614  Phase 13 booking CTA + registry URL
│   └── careerCounsellingV2JourneyCompletionEngine.js . 184  Phase 14 closure + platformHandoffPayload
│
├── CORE (pure deterministic synthesis, no turn loop)
│   ├── careerCounsellingV2ComparisonCore.js .......... 348  runComparison() — also used by Flow V2 b6TheCase
│   ├── careerCounsellingV2ConcernResolutionCore.js ... 233
│   ├── careerCounsellingV2PersonalizedRecommendationCore.js 405
│   ├── careerCounsellingV2FuturePathVisionCore.js .... 156
│   ├── careerCounsellingV2FinalDecisionHesitationCore.js 268  assertNoGuarantees + assertEscalationGuardrails
│   ├── careerCounsellingV2CounselingExperienceSelectionCore.js 281  Phase 12 skip gate + guardrails
│   ├── careerCounsellingV2BookingOrchestratorCore.js . 128  URL-before-Book-Now guardrail + skip gate
│   └── careerCounsellingV2JourneyCompletionCore.js ... 193
│
├── PARSER (inbound intent/slot classification, per phase)
│   ├── careerCounsellingV2EvaluationParser.js ........ 200
│   ├── careerCounsellingV2PersonalizationParser.js ... 236
│   ├── careerCounsellingV2ComparisonParser.js ........ 162
│   ├── careerCounsellingV2ModernEducationParser.js ... 120
│   ├── careerCounsellingV2FinalDecisionHesitationParser.js 108
│   ├── careerCounsellingV2ConcernResolutionParser.js . 107
│   ├── careerCounsellingV2ShortlistingParser.js ...... 104
│   ├── careerCounsellingV2BookingOrchestratorParser.js  92
│   ├── careerCounsellingV2FuturePathVisionParser.js ..  62
│   ├── careerCounsellingV2CounselingExperienceSelectionParser.js 37
│   ├── careerCounsellingV2CounselingInvitationParser.js  34
│   ├── careerCounsellingV2PersonalizedRecommendationParser.js 32
│   └── careerCounsellingV2JourneyCompletionParser.js .  12
│
└── SUPPORT SERVICES
    ├── careerCounsellingV2RecommendationMatrix.js .... 386  Score/tier/confidence — USED BY LIVE FLOW V2
    ├── careerCounsellingV2EligibilityService.js ...... 158  CollegeDost eligibility fetch + AP-OC-male gate
    ├── careerCounsellingV2NiatInterestService.js ..... 164  NIAT One-on-One funnel — NOT called by any engine
    └── careerCounsellingV2PostBookingAssist.js .......  99  Post-"Done" Q&A — NO EXTERNAL REQUIRERS
```

### 1.2 `constants/careerCounselling*V2*.js` — 19 files, 3,303 lines

```
constants/
├── FLOW V2 (live engine)
│   ├── careerCounsellingFlowV2Profile.js ............. 609  LEAD_PROFILE_SCHEMA — 75 slots, BEAT_ORDER
│   ├── careerCounsellingFlowV2Guardrails.js ..........  98  GUARANTEE_FORBIDDEN + URL_FORBIDDEN (canonical union)
│   └── careerCounsellingFlowV2BusinessDefaults.js ....  85  9 unconfirmed business assumptions, all defaultApplied:true
│
└── PHASE 1-14 (resume-only engine)
    ├── careerCounsellingV2ModernEducation.js ......... 312
    ├── careerCounsellingV2Personalization.js ......... 258
    ├── careerCounsellingV2Evaluation.js .............. 246
    ├── careerCounsellingV2Comparison.js .............. 218  COMPARISON_ENGINE_VERSION v1.1.0
    ├── careerCounsellingV2Discovery.js ............... 198  STAGES — canonical stage-id list
    ├── careerCounsellingV2BookingOrchestrator.js ..... 192  BOOKING_SERVICE_REGISTRY, PHASE13 v1.0.0
    ├── careerCounsellingV2FinalDecisionHesitation.js . 192  PHASE11 v1.1.0
    ├── careerCounsellingV2ConcernResolution.js ....... 182  CONCERN v1.0.0
    ├── careerCounsellingV2Shortlisting.js ............ 174  RECOMMENDATION_MATRIX_VERSION v1.0.0
    ├── careerCounsellingV2ExploreModernColleges.js ... 158  CURATED_MODERN_CATALOG (10 rows)
    ├── careerCounsellingV2PersonalizedRecommendation.js 115  PHASE9 v1.1.0
    ├── careerCounsellingV2CounselingExperienceSelection.js 112  PHASE12 v1.0.0
    ├── careerCounsellingV2JourneyCompletion.js ....... 106  PHASE14 v1.0.0
    ├── careerCounsellingV2CounselingInvitation.js .... 105  INVITATION v1.0.0
    ├── careerCounsellingV2FuturePathVision.js .........  97  PHASE10 v1.0.0
    └── careerCounsellingV2NiatInterest.js ............  89  ONE_ON_ONE_SESSION_URL
```

### 1.3 Reachability from production

```
REACHABLE (imported by live Flow V2)
├── careerCounsellingV2RecommendationMatrix.js ....... flowV2/nodes/b5Shortlist.js:34
├── careerCounsellingV2ComparisonCore.js ............. flowV2/nodes/b6TheCase.js:15
└── constants/careerCounsellingV2ExploreModernColleges.js  flowV2/nodes/b5Shortlist.js:35 (CURATED_MODERN_CATALOG)

REACHABLE (resume-only, via career_counselling_journey)
└── careerCounsellingJourneyEngine.js (V1, 271 lines) .. careerCounsellingJourneyService.js:3-8
                                                          ← guidedFlowProcessors.js:266-275

UNREACHABLE from any production entry point
├── careerCounsellingV2DiscoveryEngine.js ............ 0 external requirers (entry point of the whole chain)
├── the 16 downstream phase engines .................. reachable only from DiscoveryEngine's chain
├── careerCounsellingV2PostBookingAssist.js ......... 0 external requirers
├── careerCounsellingV2NiatInterestService.js ....... only self + scripts/niatInterestOneOnOneCertification.js
├── careerCounsellingV2PhaseOrchestrator.js ......... only scripts/ + test/
└── careerCounsellingV2ResponseOptimizer.js ......... only scripts/ + test/
```

---

## 2. PHASE / NODE MAP

### 2.1 LIVE ENGINE — Flow V2/V3 (`services/chatbot/flowV2/**`, 9,618 lines)

Turn pipeline, in execution order (`flowV2Dispatcher.js:412-662`):

```
processFlowV2Turn
├── 1. crisisLocked === true → locked reply, nextState human_handoff ......... :419
├── 2. isTier2Crisis(text) → handleR7Tier2  [BEFORE Node 0, before extraction]  :429
├── 3. extractFlowV2Slots(text) once; skip if stage=greeting_awaiting_name ... :442
├── 4. I-7 fee interrupt (beats Node 0) ..................................... :457
├── 5. Node 0 booking-intent override (skipped on b7_* stages) .............. :477
├── 6. Entry stages (greeting_*/entry_*) → R10 vs greeting .................. :495
├── 7. Pending interrupt resume (I-1/I-2 resolve; I-3/I-4/I-6 handle) ....... :547
├── 8. Stage-owned bypass (core fork, permission, B8 ask, B9) → treat as R1 .. :581
├── 9. detectNonDistressInterrupt → startNonDistressInterrupt ............... :594
├── 10. classifyReply → R1..R12 ............................................ :597
├── 11. R7 tier2 → crisis;  R7 tier1 → empathy prefix + fallthrough ......... :607
├── 12. WIRED_HANDLERS: R5,R6,R8,R9,R10,R11,R12 ............................ :630
├── 13. R4 → handleR4 ...................................................... :636
├── 14. R1-R3 → runStageFallthrough ........................................ :641
└── 15. drainAwaitingEntryStages — chains *_awaiting_entry parks, max 12 .... :176
```

#### Node 0 — booking-intent override

```
node0Override.js (475 lines)
├── TRIGGER ... detectOverrideIntent(): book / call me / counsellor / session / human  :36-57
│               Runs on EVERY turn except b7_* stages (dispatcher :481)
├── DOES ...... live slots via guidanceBookingService.getAvailableActiveSlots → list picker
│               slot reply → official website URL + backfill buttons              :367-410
├── HANDS OFF . node0_awaiting_slot → node0_awaiting_backfill → b7_awaiting_done
└── GUARD ..... stage=node0_awaiting_backfill && bookingStatus='link_sent' → no duplicate URL  :486
```

#### R1-R13 reply-class router (`router/classifyReply.js`, first match wins)

```
classifyReply
├── R7-t2 .. isTier2Crisis()                                          :218  → r7Tier2Handler   → crisisLocked, human_handoff
├── R7-t1 .. failed / less marks / parents forcing / giving up        :225  → r7Tier1Handler   → empathy prefix, no stage change
├── R12 .... ChatGPT / ignore instructions / act as / write poem      :230  → r12Handler       → joke+buttons once, then short line
├── R11 .... mbbs / nursing / law / mba / CA / abroad-only / phd      :235  → r11Handler       → out-of-scope + Book/Tell-me
├── R8 ..... my son|daughter|friend|wrong number → third_party        :240  → r8Handler        → parent buttons, isParent
│            URL + business|partnership → vendor_spam                 :244
├── R9 ..... messageType not text|button_reply|list_reply             :248  → r9Handler        → no-OCR notice, re-show qual list
├── R6 ..... just send the list / not interested / later / stop       :253  → r6Handler        → pushback buttons or optedOut
├── R5 ..... is this a bot / free / who are you / how long            :258  → r5Handler        → identity/pricing answer
├── R10 .... passed out / bare "12th pass" / bare year / pcm / pcb    :263  → r10Handler       → acceptQualification or clarify
│            + levenshtein<=2 typo guess vs diploma|graduation|dropper :288
├── R3 ..... >=3 extracted slots and R4 subCase != rank               :296  → runStageFallthrough (over-answer)
├── R4 ..... classifyR4SubCase → rank|vs|college|money|goal|best|admission :300 → r4Handler
├── R2 ..... text + exactly 1 extracted slot                          :311  → runStageFallthrough
├── R1 ..... default                                                  :316  → runStageFallthrough
└── R13 .... NEVER RETURNED by classifyReply (:18-20). r13Handler is reached
             only via I-8 silence nudge (nonDistressInterrupts.js:276)
```

#### B-beats — the company happy path spine

```
B-SPINE (dispatcher :287-290, node handoffs verified individually)
├── greeting.js (Node E) ......... trigger: stage falsy
│   ├── does ... welcome + 10-row qualification list
│   ├── skip ... profile.qualification set → qualificationRoute(), never asks    :127
│   └── → ...... PCM happy path → handleB2GoalEntry;  Arts/Commerce → scope stages
├── b2Goal.js (B2 GOAL) .......... 3 goal buttons; skip if goal filled           :58
│   └── → ...... b2_goal_awaiting_reply → handleB2Entry
├── b2Branch.js (B3 INTEREST) .... multi-select interests, cap 4
│   ├── skip ... hasInterests || branchInterest filled                           :355
│   ├── fork ... core engineering → b2CoreFork;  business → R11
│   └── → ...... advanceToB4 → b4_awaiting_entry
│       ├── b2CoreFork.js ....... CSE/AI pitch → F1 sets cse_ai+B4 / F2 exit / F3 loop
│       └── b2CoreForkExit.js ... "pure mechanical" → checklist exit → parked_core (terminal)
├── b1Goal.js (B4 PRIORITY) ...... priority list; skip if goalPriority filled     :125
│   └── → ...... b4_awaiting_reply → handleB5ChecklistEntry (same turn)
├── b5Checklist.js (B5) .......... one-shot checklist bubble; skip if checklistSent :45
│   └── → ...... chains handleB6PermissionEntry same turn
├── b6Permission.js (B6) ......... permission to recommend
│   ├── Yes → b7_two_models_awaiting_entry  (SKIPS B6.5 constraints)
│   └── No  → b6_permission_declined
├── b3Constraints.js (B6.5) ...... budget → location → optional city
│   ├── skip ... budgetFilled && cityFilled → handleB4Entry directly              :99
│   └── → ...... handleB4Entry (= b4Bridge → b7TwoModels)
├── b7TwoModels.js (B7) .......... traditional-vs-new-age comparison IMAGE + caption
│   ├── skip ... frameSent === true → straight to shortlist ask                   :29
│   └── → ...... handleB8ShortlistAskEntry
├── b8FlatShortlist.js (B8) ...... ask → flat top-5 → fit buttons
│   ├── skip ... shortlist.length > 0 → handleB8Entry / handleB9Entry           :120,:180
│   └── → ...... b8_shortlist_ask_awaiting_reply → b9_awaiting_reply
├── b9Fit.js (B9) ................ FIT ask → NIAT pitch → interest gate
│   ├── skip ... alreadyPitchedNiat → re-show interest ask, never FIT ask again   :620
│   ├── honest pass when nothing fits (shouldHonestPass)                          :295
│   └── → ...... Yes interest → b7_awaiting_reply (booking invite);  No → b9_parked_warm
└── b7Book.js (B10) .............. booking invite → hybrid slot picker → URL → Done
    ├── Maybe Later → startBookingFollowups() + b7_post_decline
    └── Done → b7_post_booking   [bookingStatus may only go null→link_sent→done  :256]

LEGACY (unreachable for new conversations — no producer sets their entry stages)
├── b5Shortlist.js ... handleB5Entry → handleB8Entry
└── b6TheCase.js ..... handleB6Entry → handleB9Entry  (only runComparison caller)
```

#### R4-P predictor path

```
r4pPredictor.js (1,344 lines)
├── TRIGGER ..... R4 subCase 'rank' → handleR4A → handleR4PEntry (r4Handler.js:145-149)
├── FIRST CHECK . isBlockedDemographic() — AP EAMCET + OC + Male → refuse, human agent  :309
│                 re-run after EVERY slot merge, not only at entry                 :110-122
├── SLOTS ....... exam-ordered via slotOrderForExam → stage r4p_awaiting_slot
├── API ......... fetchCollegeDostColleges(exam, 0, >=25, body)                     :867
├── STAGES ...... r4p_awaiting_prediction | _results | _filter | _bridge | _parked_rank_list
├── BRIDGE ...... two-catalog honest bridge                                        :700-711
│   ├── "Show me both"      → handleB1Entry (curated B4 path) — NEVER merges lists
│   └── "Stick to my rank list" → r4p_parked_rank_list (terminal park)
└── FAILURE ..... never invents a list: "I won't guess a list" + Connect me / Try again :717
```

### 2.2 RESUME-ONLY ENGINE — Phase 1-14 chain

Canonical stage ids from `constants/careerCounsellingV2Discovery.js:10-34`:

```
discovery
└── evaluation_framework ......................... Phase 3   [no version const]
    ├── permission YES → modern_colleges ......... Phase 4   [no version const]
    │   ├── YES → explore_modern_colleges ........ Phase 5   EXPLORE v2.5.0-architecture-freeze
    │   └── NO  → personalized_discovery
    ├── permission NO  → personalized_discovery .. Phase 6   [no version const]
    └── explore transition → explore_modern_colleges
        └── personalized_discovery
            └── ai_shortlisting .................. Phase 7   MATRIX v1.0.0
                └── smart_comparison ............. Phase 8   COMPARISON v1.1.0
                    ├── concern utterance → concern_resolution   CONCERN v1.0.0
                    └── phase_9_personalized_recommendation ..... PHASE9  v1.1.0
                        └── phase_10_future_path_vision ......... PHASE10 v1.0.0
                            └── phase_11_final_decision_hesitation  PHASE11 v1.1.0
                                ├── ESCALATE → hesitation_escalation (OOO URL)
                                │                └── conversation_complete   [SKIPS 12 & 13]
                                └── NON-ESCALATE → phase_12_...counseling_recommendation  PHASE12 v1.0.0
                                    ├── skip (phase11Escalated | phase11ExitTarget=ooo | niatOneOnOneRecommended)
                                    │        → conversation_complete
                                    ├── continue + service 'none' → phase_14_journey_completion
                                    ├── decline → phase_14_journey_completion
                                    └── continue + bookable service → phase_13_booking_orchestrator  PHASE13 v1.0.0
                                        └── phase_14_journey_completion ..... PHASE14 v1.0.0
                                            └── journey_completed  [TERMINAL — no Phase 15]

SIDE / LEGACY STAGES
├── counseling_invitation → conversation_complete .. INVITATION v1.0.0 (Section E legacy)
└── niat_interest_one_on_one → conversation_complete  (parallel funnel — see gap G-4)
```

---

## 3. STATE MANAGEMENT

### 3.1 Is there a Lead Profile object? — Yes, three unrelated ones

```
LEAD PROFILE OBJECTS
├── [LIVE] LEAD_PROFILE_SCHEMA .......... constants/careerCounsellingFlowV2Profile.js:81
│   ├── 75 slots, each { type, askable?, writeBeats[], readBeats[], description }
│   ├── LIVES IN ... WhatsAppBotState.context.flowV2.profile   (Mongo, Mixed type)
│   ├── WRITTEN BY . guidedFlowProcessors.js:206-228 → guidedFlowOrchestrator.js:101
│   │                → botStateService.transitionState (CAS on version, 3 retries)
│   ├── INIT ....... emptyFlowV2Profile() :591 — array→[], everything else→null
│   └── ONLY 6 ARE askable:true → qualification(B1) goal(B2) interests(B3)
│                                 goalPriority(B4) budgetBand(B6.5) cityPref(B6.5)
│
├── [FLAG-OFF] WhatsAppLeadProfile ...... models/WhatsAppLeadProfile.js
│   ├── Mongo collection whatsappleadprofiles, unique on phone
│   ├── FIELDS ..... phone conversationId branchInterest collegeInterest exam
│   │                languagePreference priceSensitive demoInterested handoffRequested
│   │                assistantTypesUsed[] eventCount firstInteractionAt lastInteractionAt metadata
│   ├── WRITTEN BY . leadProfileService.js:37 ← leadEventExtractionService.js:144 ONLY
│   └── GATED OFF .. leadProfileFlags.js:4 requires CHATBOT_LEAD_PROFILE_ENABLED === '1'
│
└── [RESUME-ONLY] emptyProfile() ........ careerCounsellingV2DiscoveryEngine.js:40
    ├── ~70 fields, different names (currentQualification, preferredCourse, careerGoal…)
    └── LIVES IN ... WhatsAppBotState.context.careerCounselling.profile
```

**Full 75-slot list** (`careerCounsellingFlowV2Profile.js:81`, declaration order):

```
phone name language proxy source campaign rawFirstMessage createdAt botState
qualification stream entryType timeline goal goalPriority careerGoal interests
interestCluster branchInterest coreBridgeAttempted coreBridgeClosed coreInterest
budgetBand cityPref city state scholarshipFlag parentConstraints isParent
checklistSent permissionRecommend frameSent followupsSent bookingFollowup
callbackNumber honestPassFired fitCollege fitReason shortlistAskDeclined
niatInterest examType rank percentile category gender quota region
admissionType predictorBridgeShown predictorBridgeChoice predictedColleges
filtersUsed collegeOfInterest concerns hesitations shortlist comparedColleges
recommendation temperature door jumpType bookingStatus doorHistory crisisLocked
crisisHandoffId optedOut spam outOfScope conflict escalateHuman status
exitReason nudgeSent nudgeSentAt hostileRedirectIssued
```

### 3.2 Where per-conversation state lives

```
models/WhatsAppBotState.js  (one row per conversation)
├── conversationId .. unique                                            :6
├── phone ........... 10-digit, indexed                                 :12
├── state ........... enum BOT_STATES                                   :19
├── context ......... Mixed, default {}                                 :27
│   ├── college ................. college_predictor flow
│   ├── rank .................... rank_predictor flow
│   ├── careerCounselling ....... Phase 1-14 engine  { flow, phase, step, awaiting, phasesCompleted[] }
│   └── flowV2 .................. LIVE engine
│       ├── profile ............. the 75-slot LEAD_PROFILE (persistent)
│       └── EPHEMERAL per-turn routing (NOT part of the schema):
│           stage, pendingQualificationGuess, pendingAmbiguousResolution,
│           compareMode, changingSlot, r4pPendingSlot, interruptedStage,
│           r3OverAnswerPending, nameAttempts, inboundId, predictionIdempotency
├── stateExpiresAt .. indexed                                           :29
└── version ......... optimistic lock, $inc via updateBotStateCas       :30 / botStateService.js:145

TTL BEHAVIOUR  [DATA-LOSS RISK]
├── SUBFLOW_TTL_MS = 30 min ............................ botStateService.js:5
├── refreshed on EVERY transitionState (not fixed from entry)  :233
├── checked in app code, not a Mongo TTL index ........ isStateExpired :93
└── on expiry → resetToMainMenu → emptySubflows() ..... chatbotOrchestratorService.js:506-507
    └── DESTROYS flowV2.profile entirely — all 75 slots lost after 30 min idle

WRITE HAZARD
└── mergeContext shallow-REPLACES flowV2 wholesale each turn  :103
    └── which is why guidedFlowProcessors.js:206 must rebuild the full sub-object
└── processBookingFollowups.js:56 writes context.flowV2.profile via updateOne,
    BYPASSING the version lock
```

### 3.3 Slot registry / cross-phase reuse

```
SLOT PIPELINE (Flow V2)
├── EXTRACT ... flowV2SlotExtractor.js:396  extractFlowV2Slots(text, profile)
│   ├── returns a SPARSE patch — never emits a key it did not confidently find (maybeSet :401)
│   ├── fills 14 of 75 slots: qualification branchInterest budgetBand cityPref examType
│   │   rank percentile category gender quota region goalPriority scholarshipFlag isParent
│   ├── runs ONCE per turn at the pipeline boundary ...... flowV2Dispatcher.js:442
│   ├── skipped when stage=greeting_awaiting_name (so a name can't become a qualification)
│   └── NOTE: `profile` arg is accepted but unused (:18)
│
├── MERGE ..... flowV2ProfileMerge.js:69  mergeFlowV2Profile(existing, patch)
│   ├── unknown keys dropped (schema is the contract) ......... :73
│   ├── null/undefined NEVER clobber — additive only .......... :74
│   ├── doorHistory append-only .............................. :79
│   ├── array slots concat + dedupe via stableKey ............. :84
│   └── object slots shallow-merge; scalars overwrite ......... :89,:97
│
└── NEXT QUESTION ... nextSlot.js:48 — walks BEAT_ORDER, returns first askable empty slot
    ├── tri-state gating: boolean false counts as ANSWERED ..... :35
    └── [DEAD] NO PRODUCTION CALLER — only test/flowV2NextSlot.test.js imports it
        Each node hard-codes its own skip check instead (§3.4)
```

### 3.4 "Already answered — don't re-ask" enforcement

**There is no central registry.** It is enforced node-by-node. Complete list:

```
SLOT-FILLED SKIPS (advance instead of asking)
├── greeting.js:111 ......... if (ctx?.flowV2?.stage) → no-op (anti double-greeting)
├── greeting.js:127 ......... if (profile.qualification) return qualificationRoute(...)
├── b2Goal.js:58 ............ if (isGoalFilled(profile.goal)) return handleB2Entry(...)
├── b2Branch.js:350 ......... if (profile.coreBridgeClosed === true) return advanceToB4(...)
├── b2Branch.js:355 ......... if (hasInterests(profile) || isBranchFilled(profile.branchInterest))
├── b1Goal.js:125 ........... if (isGoalPriorityFilled(profile.goalPriority)) → checklist
├── b3Constraints.js:99 ..... if (budgetFilled && cityFilled) return handleB4Entry(ctx)
├── b3Constraints.js:102 .... if (budgetFilled && !cityFilled) → ask location only
├── b3Constraints.js:191 .... post-budget re-check → skip location if cityPref now filled
├── b8FlatShortlist.js:120 .. if (shortlist.length > 0) return handleB8Entry(ctx)
├── b8FlatShortlist.js:180 .. same → jump to handleB9Entry, never rebuild
└── r4pPredictor.js:417 ..... getR4PMissingSlots filters filled slots; empty → straight to prediction

ONE-SHOT BOOLEAN FLAGS (never re-send)
├── b5Checklist.js:45 ....... checklistSent === true
├── b6Permission.js:69 ...... permissionRecommend === true
├── b6Permission.js:77 ...... permissionRecommend === false → decline copy, no re-ask
├── b7TwoModels.js:29 ....... frameSent === true
├── b9Fit.js:620 ............ alreadyPitchedNiat(profile)
├── r12Handler.js:31 ........ hostileRedirectIssued === true
├── r13Handler.js:19-23 ..... canSendNudge: false if nudgeSent|optedOut|crisisLocked
├── flowV2Dispatcher.js:419 . crisisLocked === true (permanent)
├── flowV2Dispatcher.js:486 . bookingStatus === 'link_sent' → no duplicate URL
├── b7Book.js:262 ........... bookingStatus state machine guard
└── bookingFollowupService.js:62  stop follow-ups once link_sent|done

FOUNDATION
└── the additive merge itself (flowV2ProfileMerge.js:74) is what makes all of the above safe —
    a later turn that fails to extract a slot cannot null out an earlier answer
```

### 3.5 Cross-engine reuse — none

```
TWO SEPARATE STATE TREES, no shared slots
├── context.flowV2 ............. guidedFlowRegistry.js:52
├── context.careerCounselling .. guidedFlowRegistry.js:42
├── EVIDENCE
│   ├── processCareerCounsellingTurn reads/writes only careerCounselling  guidedFlowProcessors.js:127,:133
│   ├── processCareerCounsellingFlowV2Turn reads/writes only flowV2 ..... :186,:224
│   ├── deliberate naming divergence documented ......... careerCounsellingFlowV2Profile.js:59-63
│   │   "Field names intentionally do NOT reuse the old V2 profile's names … no functional coupling"
│   ├── flowV2ProfileMerge.js:8-11 explicitly refuses to reuse botStateService.mergeContext
│   └── flowV2SlotExtractor.js:13-16 explicitly refuses to reuse collegePredictorSlotExtractor
└── ONLY CROSS-IMPORT is DATA, not state: b5Shortlist.js:34-35 (matrix + curated catalog)
```

### 3.6 Conversation recovery

```
models/ConversationRecoverySnapshot.js  (unique on phone+conversationId)
├── SNAPSHOTS ... journeyBlob = deep clone of the ENTIRE careerCounselling context  service:58
│                 lastStage/lastStep/lastPhase, journeyCompleted, bookingCompleted, optedOut
│                 denormalized examName, preferredCourse, studentName
├── READS ....... Phase 1-14 field names ONLY — no Flow V2 slot is ever snapshotted
├── WRITE HOOK .. [BROKEN] guidedFlowProcessors.js contains NO reference to upsertFromTurn
│                 docs + scripts/conversationRecoveryCertification.js:237-244 assert it exists
└── RESUME ...... [BROKEN] tryResumeFromRecovery has NO caller in chatbotOrchestratorService
                  and transitions to bot state 'career_counselling_v2', which is NOT in
                  BOT_STATES (constants/chatbotStates.js:7-22) while updateBotStateCas
                  runs with runValidators:true → the enum would reject the write
```

---

## 4. EXTERNAL INTEGRATIONS

### 4.1 CollegeDost / college predictor

```
UPSTREAM
├── BASE ....... NW_PREDICTORS_BASE_URL, default https://nw-predictors-backend-beta.earlywave.in
│                (services/nwCollegePredictorService.js:4;  collegeDostService.js:8 default differs:
│                 https://il-backend-beta.il.in — two defaults for the same var)
├── AUTH ....... Bearer NW_PREDICTORS_ACCESS_TOKEN → fallback COLLEGEDOST_ACCESS_TOKEN
├── V1 PATH .... POST /api/nw_college_predictor/colleges/get/v1/?offset=&limit=
└── V2 PATH .... POST /api/nw_college_predictor/colleges/get/v2/?offset=&limit=

services/collegeDostService.js :: getPredictedColleges(exam, offset, limit, body)
├── PAYLOAD .... entrance_exam_name_enum, admission_category_name_enum,
│                cutoff_from/to (numeric), branch_codes[], districts[], sort_order
│                V1: reservation_category_code (single) | V2: reservation_category_codes[]
├── ENVELOPE ... default legacy { clientKeyDetailsId:1, data:"'<JSON>'", branch_codes:[] }
│                flat body via NW_PREDICTORS_USE_OPENAPI_FLAT_BODY=true          :31-59
├── RESPONSE ... { total_no_of_colleges, admission_category_name, colleges }
├── TIMEOUT .... 30_000 ms, NO generic retry
├── RETRY ...... V1→V2 only on 400/INVALID_RESERVATION_CATEGORY_CODE w/ multiple codes  :426-439
└── ERRORS ..... missing token → 503; unsupported exam → 400; network/timeout → 502

CALL CHAIN
├── collegePredictorCore.fetchCollegeDostColleges .... validates + derives cutoff from rank  :65-84
├── collegePredictorChatService.runPrediction ........ (exam, 0, 5, body); formats 5 results  :74-87
│   └── FAILURE: keeps step='predict', "could not fetch…send any message to retry"  :282-307
├── r4pPredictor.runR4PPrediction .................... >=25 rows, caches for local paging   :817-869
│   └── FAILURE: "I won't guess a list" + Connect me / Try again buttons          :715-721
└── careerCounsellingV2EligibilityService ............ Phase 7 eligibility (resume-only path)

IDEMPOTENCY
└── collegePredictionIdempotencyService writes WhatsAppInboundMessage.collegePrediction
    { predictionCompleted, hash, cachedReply, resultMeta } atomically                :18-67
```

### 4.2 Other external APIs

```
LLM (OpenAI-compatible) .. services/ai/providers/OpenAiCompatibleProvider.js
├── ENV ...... LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT_MS=20000, LLM_MAX_RETRIES=2
├── SHAPE .... chat.completions { model, messages, temperature, max_tokens, stream:false }
└── USED BY .. knowledgeAssistantService · iitCounsellingExpert · iitCounsellingStrategy
              counsellorProgramAssistant · scopeClassifierService · leadEventExtraction
              humanCopilot (suggest / summary / followup)
EMBEDDINGS ............... services/ai/embeddingService.js
├── ENV ...... EMBEDDING_API_KEY|LLM_API_KEY, EMBEDDING_BASE_URL|LLM_BASE_URL
├── MODEL .... nvidia/llama-nemotron-embed-1b-v2, dims 1024, batch 16, timeout 20s
└── FALLBACK . embedding/vector failure → keyword retrieval  knowledgeSearchService.js:226
TRANSLATION .............. same LLM provider, not a separate API  translationService.js:93-206
LANGUAGE DETECT .......... local `franc` + script rules; LLM fallback via LANGUAGE_DETECT_LLM_FALLBACK
TAVILY ................... NOT PRESENT in repo source (env var exists in .env only)
CRM ...................... direct Mongo (FormSubmission, IitCounsellingSubmission) — no external CRM API
GOOGLE / MEET ............ no Calendar/Meet API call from services/chatbot — links are config/static
MSG91 / OSVI / SHEETS .... exist in utils/, NOT imported by the inbound chatbot path
```

### 4.3 WhatsApp plumbing

```
INBOUND
├── ROUTE ...... POST /webhook/gupshup ............... routes/gupshupWebhookRoutes.js:1-15
├── CONTROLLER . authenticate → classify request_welcome | message | DLR → await processing
│                                                       controllers/gupshupWebhookController.js:780-839
├── PARSE ...... utils/gupshupInboundPayload.js
│   ├── Gupshup: text | button (postbackText→id→title) | list_reply (postbackText→id→title)
│   │            | image/document/audio/video captions | location            :32-106
│   └── Meta:    text | legacy button | interactive.button_reply | interactive.list_reply  :112-182
├── PIPELINE ... whatsappInboundService.js:234-310
│                auth → per-phone rate limit → webhook+inbound dedupe → conversation upsert
│                → atomic claim (pending→processing) → orchestrator
└── ID PREF .... flowv2_* ids preferred over display titles  guidedFlowOrchestrator.js:61-73

OUTBOUND (session, 24h window)
├── ENDPOINT ... POST https://api.gupshup.io/wa/api/v1/msg   gupshupSessionService.js:17
│                form: source, destination, channel=whatsapp, message(JSON), encode?, src.name
├── BUILDERS ... utils/gupshupSessionPayload.js
│   ├── text ......... { type:'text', text, previewUrl }
│   ├── buttons ...... { type:'quick_reply', content, options[{title,postbackText}] }  max 3
│   ├── list ......... { type:'list', title?, body, globalButtons, items[].options }   max 10 rows
│   └── image ........ { type:'image', originalUrl, previewUrl, caption? }
├── PERSISTENCE  whatsappOutboundService.js — queued row → send → record provider ids/status
│   └── UNIQUE bot reply per inbound (partial index) → see G-2b: multi-part replies are deduped
└── FALLBACK ... re-engagement / error 131047 → template fallback  sessionFallbackService.js:6-17

OUTBOUND (template, outside 24h)
└── POST https://api.gupshup.io/wa/api/v1/template/msg  services/gupshupService.js:43
```

---

## 5. HARDCODED / DETERMINISTIC LOGIC WORTH PRESERVING

> Everything in this section exists for a **safety, honesty, or compliance** reason.
> These are the "must remain deterministic — never hand to an LLM" candidates.

```
S-1  AP EAMCET + OC + MALE → REFUSE PREDICTION, ROUTE TO HUMAN          [HIGHEST VALUE]
├── RULE ....... apTs.js:84  function isApOcMaleBlocked(categoryId, gender) {
│                              return Number(categoryId) === 1 && gender === 'male'; }
│                categoryId 1 = OC in AP_TS_CATEGORY_OPTIONS; only applies to exam === EXAM_AP
├── PROTECTS ... the demographic whose cutoffs swing most; a wrong number costs a student a year
├── ENFORCED IN 5 INDEPENDENT PLACES (defense in depth, all live)
│   ├── apTs.js:91 .............................. reservation code never resolves → API uncallable
│   ├── collegePredictorSlots.js:118 ............ prediction context refuses to build
│   ├── collegePredictorChatService.js:347 ...... at step='predict' → AP_OC_MALE_BLOCKED_REPLY
│   ├── collegePredictorChatService.js:384 ...... again after slot merge, before readiness
│   └── careerCounsellingV2EligibilityService.js:87  treats as unresolvable, never guesses
├── FLOW V2 .... r4pPredictor.js:309 isBlockedDemographic() — documented "THE FIRST CHECK" (:302),
│                re-run after EVERY slot merge (:110-122) because it can become true mid-fill
└── COPY ....... verbatim, r4pPredictor.js:245 — "...cutoffs swing enough that I won't give you a
                 number I can't stand behind — a wrong prediction here could cost you a year."

S-2  CRISIS / SELF-HARM — HARD STOP BEFORE EVERYTHING ELSE
├── PATTERNS ... crisisClassifier.js:14-27 — 12 frozen high-precision regexes
│                (want to die | end my life | suicid(e|al) | self-harm | no point living …)
│                Tier-1 disappointment DELIBERATELY EXCLUDED
├── ORDER ...... flowV2Dispatcher.js:419 crisisLocked check, :429 isTier2Crisis
│                BOTH run before Node 0, before slot extraction, before classifyReply
│                → "book a session, my life is over" is a crisis, NEVER a booking conversion
├── LOCK ....... r7Tier2Handler.js:97-99 crisisLocked:true — schema says "Never set to false once true"
├── HANDOFF .... :112 executeCrisisHandoff() fired EAGERLY and deliberately NOT awaited,
│                so a DB outage cannot suppress the safety reply
├── EXEMPT ..... :84 expiresAt:null — crisis tickets exempt from the 4h stale-handoff sweep
└── COPY ....... :57-60 verbatim Tele-MANAS 14416, never paraphrased

S-3  GUARANTEE / FABRICATED-CLAIM GUARDRAILS (throwing, not logging)
├── CANONICAL .. careerCounsellingFlowV2Guardrails.js:22-40
│   ├── GUARANTEE_FORBIDDEN (16 regexes): guaranteed | 100% | placement guaranteed |
│   │   package of/is/will | admission guaranteed | mandatory | you have to …
│   └── URL_FORBIDDEN: https?:// | guidexpert.co.in | www.
├── HARD-FAIL SITES ... b8FlatShortlist.js:187,:214 · b9Fit.js:415,416,445,476,536,587
├── PHASE 11 EXTRA .... HesitationCore.js:31 also throws on counsellor|counselor|book|whatsapp
│                       (Phase 11 must not sell) and :37-54 on pressure language
│                       (must book | limited seats | act now | hurry)
├── PHASE 12 EXTRA .... SelectionCore.js:23-30 enforces BOTH lists → Phase 12 can never emit a URL
└── LLM OUTPUT ....... aiGuardrailService.js — guarantee-near-job/placement/salary patterns,
                       NUMERIC_CLAIM_PATTERN + PLACEMENT_PERCENT_PATTERN force every number to be
                       grounded in retrieved knowledge or the user's own message; invented
                       partnerships/hiring/mentors blocked → UNSUPPORTED_CLAIM_FALLBACK

S-4  BOOKING URL GATING + WEBSITE-ONLY CREATION
├── URL AFTER CTA .... BookingOrchestratorCore.js:14-18 throws
│                      'Phase 13 guardrail: URL forbidden before Book Now' when allowUrl=false
│                      buildIntroReply → {allowUrl:false};  only buildUrlShareReply → true
├── REGISTRY ONLY .... URLs only from BOOKING_SERVICE_REGISTRY via buildOfficialBookingUrl()
├── SKIP GATE ........ Core:29-50 phase11Escalated | phase11ExitTarget=ooo |
│                      niatOneOnOneRecommended | service 'none' | unmapped
│                      → prevents double-sending a link to a student already routed to OOO
├── WEBSITE ONLY ..... businessDefaults.js:68-73 "WhatsApp never creates OneOnOneCounselingLead
│                      or increments slot bookings" — enforced by construction in node0Override
└── STATE MACHINE .... b7Book.js:256-266 bookingStatus may only progress null→link_sent→done

S-5  TWO-CATALOG DISTINCTION — NEVER MERGED
├── RULE ....... businessDefaults.js:42-46 NO_MIXED_CATALOGS / open item CAT-2
│                "Predictor rank list and curated shortlist never merge into one list."
├── CATALOG A .. rank-gated live Earlywave/CollegeDost predictor (exam + rank present)
├── CATALOG B .. CURATED_MODERN_CATALOG — 10 rows, fixed order, explicitly NOT popularity rank
│                ExploreEngine.js:42 "Stage 5 is an educational new-age showcase —
│                never replace with Earlywave"
└── BRIDGE ..... r4pPredictor.js:700-711 names both honestly; "Show me both" seeds the curated
                 B1 path and NEVER merges rank-gated rows into the shortlist

S-6  VERIFIED-DATA-ONLY / NO-INVENTED-FACTS
├── unknown college → checklist, never facts .... r4Handler.js:45-57 "I won't guess."
├── no CORE-branch catalog → Variant B exit ..... businessDefaults.js:47-51 (CAT-1) → parked_core
├── no invented NIAT project claims ............. b5Shortlist.js:284-293,:301
├── honest pass when nothing fits ............... b9Fit.js:41-47 / shouldHonestPass :295-308
├── category values never fabricated ............ r4pPredictor.js:134-144 re-ask instead
└── module-load provenance assertions ........... r4pPredictor.js:225-239 throws at require-time
                                                  if a canonical option table drifts

S-7  SCOPE FIREWALL (out-of-scope refusal)
├── DENY ....... scopeFirewallConstants.js:19-35 programming image_generation movies weather
│                sports politics finance general_trivia prompt_injection medical legal adult
│                religion current_affairs math
├── POLICY ..... :169-178 non-negotiable subset — prompt_injection + policy categories block
│                unconditionally, no allow-signal override (scopeFirewallService.js:119-145)
├── SEGMENTS ... multi-segment split so a blocked clause cannot hide behind an allowed one
├── FLOW V2 .... r11Handler.js:13 honest refusal — "my depth is engineering and tech programs
│                in India, so I'd rather not guess at medical admissions and point you wrong"
└── [RISK] ..... env-flagged: scopeFirewallFlags.js:4 requires exactly '1';
                 COMMENTED OUT in .env.example:220 → a fresh deploy ships with the firewall OFF
```

---

## 6. INTERRUPT HANDLING

10 interrupts. 8 are pattern-detected in one place, 1 is time-based, 1 is the crisis classifier.

```
DETECTION MAP ... nonDistressInterrupts.js:55-66 detectNonDistressInterrupt(text, stage)
├── I-1  unsure / don't know ........ ONLY on b1_awaiting_reply|b2_awaiting_reply   :57
│         → PARK interrupt_i1_awaiting_reply, 3 buttons (Building/People/Numbers)
│         → resolve → resume the interrupted stage                             :198-201
├── I-2  can't afford / too expensive :58  → PARK interrupt_i2_awaiting_reply
│         → 2 buttons (Focus under ₹2L / Show me a range)                      :204
├── I-3  parents want / think ........ :59  → PARK interrupt_i3_awaiting_reply
│         → 3 buttons (Nearby / Known brand / My call)                         :223
├── I-4  worried about / concern is .. :60  → PARK interrupt_i4_awaiting_reply
│         → Yes/No; writes profile.concerns                                    :240
├── I-5  hesitating / second thoughts  :61  → INLINE, same stage; writes profile.hesitations
├── I-6  mbbs/neet/law/mba abroad .... :62  → PARK interrupt_i6_awaiting_reply
│         → Book a session → b7_awaiting_entry;  Tell me about tech            :251
├── I-7  is the session free / cost .. :63  → INLINE, same stage
│         → RUNS EARLY, BEFORE Node 0 (flowV2Dispatcher.js:457) so a pricing question
│           is never converted into a booking flow
├── I-9  never coded / coding scares . :64  → INLINE, same stage
├── I-8  SILENCE NUDGE .............. tryI8SilenceNudge(ctx, silenceMs)        :276-280
│         → time-based, not text-based; delegates to r13Handler.buildSilenceNudge
│         → canSendNudge gate: false if nudgeSent | optedOut | crisisLocked |
│           stage in {parked_core, r4p_parked_rank_list} | coreBridgeClosed
└── I-10 CRISIS ..................... router/crisisClassifier.js (see S-2)
          → NOT part of detectNonDistressInterrupt; runs first in the dispatcher

DISPATCHER HOOKS (execution order)
├── flowV2Dispatcher.js:429 ... I-10 crisis  (before Node 0)
├── flowV2Dispatcher.js:457 ... I-7 fee      (before Node 0)
├── flowV2Dispatcher.js:547 ... pending I-1 / I-2 resume + resume fallthrough
├── flowV2Dispatcher.js:570 ... pending I-3 / I-4 / I-6 via handlePendingInterrupt
└── flowV2Dispatcher.js:594 ... general detectNonDistressInterrupt
                                 (AFTER stage-ownership bypass at :581, so a stage that owns
                                  its reply is never hijacked by an interrupt pattern)
```

---

## 7. DEPENDENCIES & CONFIG

```
CORE
├── CHATBOT_ENABLED ................... default '1'
├── ENABLE_WHATSAPP ................... absent = disabled
├── WA_INTEGRATION_STUB ............... '1' = stub all sends (no network)
├── NODE_ENV .......................... 'test' zeroes WA_MEDIA_FOLLOWUP_DELAY_MS
└── DEBUG_AI / CHATBOT_INTENT_DEBUG / CHATBOT_CC_DEBUG ... default off

GUPSHUP
├── GUPSHUP_API_KEY ................... [secret] required for any send
├── GUPSHUP_SOURCE .................... sender number
├── GUPSHUP_SRC_NAME .................. optional app name
├── GUPSHUP_WEBHOOK_SECRET ............ [secret] inbound auth
├── GUPSHUP_WEBHOOK_AUTH_REQUIRED ..... enforce only when secret exists
├── GUPSHUP_CHATBOT_SEND_TIMEOUT_MS ... 20000, capped 120000
├── GUPSHUP_SEND_TIMEOUT_MS ........... 20000
├── GUPSHUP_IIT_SEND_TIMEOUT_MS ....... 60000
└── GUPSHUP_TEMPLATE_* ................ REMINDER PRE4HR MEET 30MIN (+ IIT/OOO/guidance variants)

INBOUND CONTROL
├── CHATBOT_RATE_LIMIT_PER_MIN ........ 12
├── CHATBOT_INBOUND_DEDUPE_BUCKET_SEC . 45
├── CHATBOT_INBOUND_PROCESSING_STALE_MS  max(120000, 2× knowledge timeout)
├── WA_WEBHOOK_PHONE_FALLBACK_HOURS ... 48, clamped 1-168
└── LOG_GUPSHUP_WEBHOOK_BODY .......... false

PREDICTOR
├── NW_PREDICTORS_BASE_URL ............ [two different defaults — see G-9]
├── NW_PREDICTORS_ACCESS_TOKEN ........ [secret]
├── COLLEGEDOST_ACCESS_TOKEN .......... [secret] fallback
├── NW_PREDICTORS_X_SOURCE ............ optional header
├── NW_PREDICTORS_USE_OPENAPI_FLAT_BODY  true = flat body instead of legacy envelope
├── NW_PREDICTORS_LEGACY_WRAPPED_PAYLOAD
├── NW_PREDICTORS_DATA_PLAIN .......... disable quoting of the data field
└── NW_PREDICTORS_ENTRANCE_EXAM_OVERRIDE  legacy service only

LLM / RETRIEVAL
├── LLM_API_KEY [secret] · LLM_BASE_URL · LLM_MODEL · LLM_TIMEOUT_MS=20000 · LLM_MAX_RETRIES=2
├── EMBEDDING_API_KEY [secret] · EMBEDDING_BASE_URL
├── CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED · CHATBOT_LLM_ENABLED · CHATBOT_RAG_ENABLED ... off
├── KNOWLEDGE_ASSISTANT_TIMEOUT_MS .... 8000
├── KNOWLEDGE_SEARCH_MODE ............. hybrid
├── KNOWLEDGE_VECTOR_INDEX_NAME ....... knowledge_vector_index
├── KNOWLEDGE_VECTOR_NUM_CANDIDATES=50 · KNOWLEDGE_*_RECALL_LIMIT=20
└── KNOWLEDGE_HYBRID_KEYWORD_WEIGHT ... 0.45

LANGUAGE
├── LANGUAGE_DETECT_MIN_CONFIDENCE .... 0.75
├── LANGUAGE_PREFERENCE_STREAK_THRESHOLD  3
├── LANGUAGE_DETECT_LLM_FALLBACK ...... default on
├── TRANSLATION_TIMEOUT_MS=5000 · OUTBOUND_TRANSLATION_TIMEOUT_MS=12000
└── NOTE: flowV2 is force-English — guidedFlowOrchestrator sets resolvedLanguage='en',
         localizationTier='static', preLocalized=true for career_counselling_flow_v2

FEATURE FLAGS (all default OFF)
├── CHATBOT_SCOPE_FIREWALL_ENABLED .... [see S-7 risk]
├── CHATBOT_SCOPE_FIREWALL_SHADOW_MODE · CHATBOT_SCOPE_ALLOW_LIST_FIRST · CHATBOT_SCOPE_CLASSIFIER_ENABLED
├── CHATBOT_LEAD_PROFILE_ENABLED · CHATBOT_LEAD_SCORING_ENABLED · CHATBOT_LEAD_EVENT_EXTRACTION_ENABLED
├── CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED
├── CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED · CHATBOT_IIT_COUNSELLING_STRATEGY_ENABLED
└── CHATBOT_HUMAN_COPILOT_ENABLED · CHATBOT_COPILOT_SUGGESTED_REPLIES_ENABLED · CHATBOT_COPILOT_AUTO_ASSIGN

TIMING
├── WA_MEDIA_FOLLOWUP_DELAY_MS ........ 2000, clamped 0-5000 (image-then-buttons ordering)
├── CHATBOT_HANDOFF_EXPIRY_HOURS ...... 4  (crisis tickets exempt)
├── CHATBOT_HANDOFF_UNCLAIMED_MINUTES . 15
└── SUBFLOW_TTL_MS .................... 30 min, hardcoded (botStateService.js:5)

MONGO MODELS (chatbot path)
├── WhatsAppBotState ......... state+context per conversation; conversationId UNIQUE
├── WhatsAppInboundMessage ... parsed inbound; UNIQUE providerMessageId, UNIQUE dedupeKey
├── WhatsAppOutboundMessage .. sends+DLR; UNIQUE bot reply per inbound  [behaviour-critical]
├── WhatsAppConversation ..... session window; UNIQUE active (phone, productLine)
├── WhatsAppWebhookEvent ..... audit; sparse UNIQUE webhookDedupeKey
├── WhatsAppAgentHandoff ..... human handoff + copilot
├── WhatsAppLeadProfile ...... UNIQUE phone (flag-gated)
├── WhatsAppLeadScore / WhatsAppLeadEvent ... UNIQUE phone / UNIQUE inboundMessageId
├── ConversationRecoverySnapshot|Case|Attempt ... UNIQUE (phone, conversationId)
├── KnowledgeChunk / Blog .... RAG sources
└── FormSubmission / IitCounsellingSubmission ... CRM context (read-only from chat)

CRON
└── GET /process-booking-followups (verifyCronSecret) → routes/cronRoutes.js:445-458
    → flowV2/processBookingFollowups.js — +30m / +1h / +3h re-invites for b7_post_decline
```

---

## 8. GAPS / TECH DEBT

Ordered by risk.

```
G-1  [CRITICAL] 17,291 LINES OF FROZEN PHASE ENGINE ARE OFF THE LIVE PATH
├── careerCounsellingV2DiscoveryEngine.js has ZERO external requirers
├── every frozen baseline doc + .cursor rule (PHASE-9..14, AI-COUNSELING-JOURNEY-PRODUCTION-COMPLETE)
│   governs a path that now only serves mid-journey RESUME traffic
├── new-student traffic runs the Flow V2/V3 B-spine, which those docs never mention
└── the phase certification scripts assert against handleCareerCounsellingMessage (V1 engine),
    not against what students actually receive

G-2  [CRITICAL] 30-MINUTE TTL SILENTLY DESTROYS THE ENTIRE LEAD PROFILE
├── chatbotOrchestratorService.js:506-507 → resetToMainMenu → emptySubflows()
├── all 75 slots are wiped after 30 min idle; there is no persistence outside bot-state context
└── conversation recovery, which exists to solve exactly this, is NOT WIRED (G-3)

G-2b [CRITICAL] MULTI-PART REPLIES: ONLY THE FIRST BUBBLE IS EVER DELIVERED
├── guidedFlowOrchestrator.js:145-163 loops over replyParts, sending EVERY part with
│   inReplyToInboundId: inbound._id (:161)
├── WhatsAppOutboundMessage has a UNIQUE partial index on inReplyToInboundId where
│   senderType='bot' (models/WhatsAppOutboundMessage.js:85-94)
├── sendBotTextReply:89-94 finds the existing successful reply and returns
│   { duplicatePrevented: true } WITHOUT SENDING
└── NET EFFECT: for any flow that returns replyParts, parts 2..N are silently dropped,
    yet :164 still joins all parts into replyText for logging — so logs show the full
    message the student never received. (Media sends are unaffected.)

G-3  [CRITICAL] CONVERSATION RECOVERY IS WIRED AT NEITHER END
├── WRITE .. guidedFlowProcessors.js has no upsertFromTurn call; certification asserts it does
├── READ ... tryResumeFromRecovery has no caller in chatbotOrchestratorService
├── ENUM ... resume writes bot state 'career_counselling_v2', absent from BOT_STATES,
│            and updateBotStateCas runs runValidators:true → the write would be REJECTED
└── snapshots only capture careerCounselling fields — no Flow V2 slot is ever saved

G-4  [HIGH] SAFETY RULES DECLARED BUT NOT ENFORCED
├── b6TheCase.js:16 imports assertGuardrails and NEVER CALLS IT — the guardrail module
│   explicitly names B6 as the beat that must hard-fail (Guardrails.js:44-46)
│   (masked by the fact that b6TheCase is itself unreachable — G-6)
├── b8FlatShortlist.js:25 DISCLOSURE = ''  — the shortlist disclosure line documented as
│   MANDATORY (businessDefaults EDITORIAL_SHORTLIST_DISCLOSURE; MASTER_FLOW:1909
│   "DISCLOSURE IS MANDATORY (L13). Not optional, not moved") ships EMPTY
├── NIAT funnel unreachable: tryNiatInterestTransition has no engine caller (cert script only)
└── NO crisis/self-harm detection ANYWHERE outside flowV2 — the resume-only Phase engines,
    chatbotOrchestratorService, knowledgeAssistant and the College Predictor path have no
    equivalent pre-check

G-5  [HIGH] OPEN, DOCUMENTED, CURRENTLY-SHIPPING FACTUAL RISKS
├── docs/KNOWN-ISSUE-R5-UNVERIFIED-PRICING-CLAIM.md — status Open
│   r5Handler.js:20-22 asserts "completely free … Nothing to pay at any point"
│   b7Book.js:41-52 independently asserts "It's completely free."
│   greeting deliberately silent → three inconsistent postures on one unverified money claim
├── docs/KNOWN-ISSUE-CATALOG-SCORING-UNIFORMITY.md — status Open
│   all 10 curated colleges score identically (0.656); real ordering comes from the private,
│   unexported, untested justifiedCuratedBoost() → silent degradation to declaration order
└── all 9 entries in businessDefaults.js:27-84 carry defaultApplied:true — the entire honesty
    posture rests on UNCONFIRMED business assumptions (NIAT-1/2, CAT-1/2/3, CORE-1, PAID, A1/A2)

G-6  [MEDIUM] DEAD / UNREACHABLE CODE
├── b5Shortlist.js + b6TheCase.js legacy beats — no production code sets b5_awaiting_entry
│   or b6_awaiting_entry, so the only runComparison caller is effectively dead
├── nextSlot.js — the slot-registry walker has no production caller (tests only)
├── handleR13Returning — exported, zero call sites; the "returning student never restarts
│   discovery" promise in its own header is unenforced
├── careerCounsellingV2PostBookingAssist.js — zero external requirers
├── b7Book.js:61-80 NOT_YET_TEXT / NOT_YET_TOPIC_ROWS / list titles — the handler emits a
│   different inline string; tests assert on the dead constants
├── b7Book.js:53 GENERIC_INVITE_TEXT = STANDARD_INVITE_TEXT makes the ternaries at :128,:158 no-ops
└── isCollegePredictorEnabled() { return true; } duplicated in guidedFlowProcessors.js:35-37 and
    chatbotOrchestratorService.js:148-150 → the maintenance branch at :250-262 is unreachable

G-7  [MEDIUM] DUPLICATE / CONFLICTING LOGIC
├── SIX copies of GUARANTEE_FORBIDDEN with silently divergent contents:
│   Guardrails.js:22 (16 patterns, union) · Phase13:63 (7) · Phase12:35 (7) ·
│   Phase11:160 (6 — MISSING /\bmandatory\b/) · Phase10:75 · NIAT:43
│   → a phrase blocked in Flow V2 can still ship from Phase 11
├── BOOKING URL hardcoded in 5 files despite the "registry only" freeze rule:
│   BookingOrchestrator.js:30 · FinalDecisionHesitation.js:32 · NiatInterest.js:8 ·
│   bookingContextResolver.js:24 · node0Override.js:62 (whose comment claims to be the
│   "single source of truth … not a grep-and-hope across every file")
├── TWO spacing normalizers with OPPOSITE intent, and the tree disagrees with HEAD:
│   normalizeMessageText (gupshupSessionPayload) PRESERVES single paragraph breaks;
│   compactWhatsAppSpacing (guidedFlowOrchestrator:13, applied at :119 for flowV2EnglishOnly)
│   COLLAPSES them. At HEAD f8135bd both run stacked, so the collapsing one wins.
│   The working tree has an UNCOMMITTED deletion of compactWhatsAppSpacing plus a deleted
│   test/guidedFlowSpacing.test.js — i.e. an unreviewed revert of commit eea8d72 is pending
├── FOUR text normalizers with different behaviour: b9Fit.js:361 · RecommendationMatrix.js:9 ·
│   aiGuardrailService.js:64 · EvaluationEngine.js:59
├── interestPhrase / priorityPhrase defined twice with different return values
│   (b8FlatShortlist.js:45,57 vs b9Fit.js:189,180) — both exported
└── b5Shortlist.js:157-246 knowingly duplicates curatedCatalogAsColleges + justifiedCuratedBoost
    from ShortlistingEngine because the originals are unexported

G-8  [MEDIUM] DOC ↔ CODE CONTRADICTIONS
├── MASTER_FLOW.md:1922 "Polar is not in catalog — use Plaksha / Kalvium until a verified
│   Polar partner row exists" vs b8FlatShortlist.js:18 shipping Polar in the live top-5
│   (HAPPY_FLOW_B8_B10.md:42 documents Polar as shipped — the two docs contradict each other)
├── HAPPY_FLOW_B8_B10.md:32-50 reproduces the B8 bubble with NO disclosure line, matching the
│   empty DISCLOSURE constant and contradicting MASTER_FLOW.md:1909
├── STALE "not wired / zero call sites" claims, now FALSE:
│   flowV2Dispatcher.js:8-10 · :373 · r7Tier2Handler.js:18-22 all state Flow V2 has never been
│   wired into a live send pipeline. Production call site: guidedFlowProcessors.js:185,:202,:276-284
├── r4pPredictor.js:13-21 says Stages 3/4/5 are "not yet built" while the same file implements
│   all of them (its own docstring at :1241 says "Stages 1-5 covered")
└── flowV2Dispatcher.js:84-88 claims 8 wired bucket handlers; WIRED_HANDLERS:137-145 holds 7

G-9  [LOW] CONFIG HAZARDS
├── NW_PREDICTORS_BASE_URL has TWO different in-code defaults:
│   collegeDostService.js:8 → https://il-backend-beta.il.in
│   nwCollegePredictorService.js:4 → https://nw-predictors-backend-beta.earlywave.in
├── .env.example:220-224 leaves the scope-firewall vars commented out → fresh deploys ship
│   with the firewall OFF (flag requires exactly '1')
├── PHASE13_STEPS includes 'booking_completed', which the freeze rule marks reserved-only —
│   a step value with no producer
└── TODO(live-wiring) r7Tier2Handler.js:43 — "MENU" can dismiss a CRISIS handoff via the
    orchestrator's own pause mechanism, regardless of handoff reason

G-10 [INFO] TESTS
├── zero .skip / .todo / commented-out tests in test/  (verified by grep)
├── suite NOT run for this audit — pass/fail unverified
├── tests LOCK IN debt: flowV2B3Constraints.test.js:239 pins the deprecated b4Bridge export
│   surface; flowV2B7Book.test.js:234 asserts on unreachable NOT_YET_* constants
└── justifiedCuratedBoost() — the real curated-catalog ranking signal — has no dedicated test
```

---

## Appendix: fastest verification commands

```bash
# G-1: prove the Phase chain entry has no callers
rg -l "careerCounsellingV2DiscoveryEngine" --glob '*.js' . | grep -v node_modules

# prove Flow V2 is the live path
rg -n "career_counselling_flow_v2" services/chatbot/guidedFlows/guidedFlowRegistry.js

# S-1: all five AP-OC-male enforcement points
rg -n "isApOcMaleBlocked" --glob '*.js' services

# G-4: guardrail imported but never called
rg -n "assertGuardrails" services/chatbot/flowV2/nodes/b6TheCase.js

# G-4: empty mandatory disclosure
rg -n "DISCLOSURE" services/chatbot/flowV2/nodes/b8FlatShortlist.js

# G-2b: multi-part reply dedupe (unique index + duplicatePrevented short-circuit)
rg -n "inReplyToInboundId" -A6 models/WhatsAppOutboundMessage.js
rg -n "duplicatePrevented" services/chatbot/whatsappOutboundService.js

# G-7: six divergent guarantee lists
rg -n "GUARANTEE_FORBIDDEN" constants/
```
