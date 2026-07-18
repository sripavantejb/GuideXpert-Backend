# Phase 12 — Personalized Counseling Recommendation (Architecture Plan)

**Status:** **FROZEN** at ship — see [PHASE-12-PRODUCTION-BASELINE.md](./PHASE-12-PRODUCTION-BASELINE.md)  
**Depends on:** Phase 11 production baseline **v1.1.0** (FROZEN)  
**Also respects:** Phase 9 **v1.1.0**, Phase 10 **v1.0.0**, Section E (FROZEN)  
**Stage:** `phase_12_personalized_counseling_recommendation`  
**Engine version:** `PHASE12_ENGINE_VERSION = v1.0.0`

---

## 1. Business objective

Phase 12 is **Personalized Counseling Recommendation**.

It runs **only after** the student has completed the AI counseling journey (Phases 9–11) **and** continues beyond it **without** already receiving a One-on-One offer from frozen Phase 11 paths (hesitation escalation or NIAT interest).

**Objective:** Select the most appropriate counseling experience for students who continue beyond the AI counseling journey — explain *why that service fits this student* — then hand off to Phase 13 for booking.

Phase 11 already owns whether exceptional One-on-One escalation (or NIAT admission OOO) is needed. Phase 12 does **not** re-decide “is counseling needed?” as a strength score. It **routes to a service**.

**Student outcomes:**

- “I know which counseling experience fits my situation — and why.”  
- “This feels personalized, not like a generic sales pitch.”  
- “I’m not pressured; I can continue to booking or stop.”  

**It is not:**

- Hesitation resolution or “need scoring” (Phase 11)  
- Booking / CTA / URLs (Phase 13)  
- Human handoff / copilot (Phase 14)  
- Another college recommendation or comparison engine  

---

## 2. Functional responsibilities

### Phase 12 may

| Responsibility | Notes |
|----------------|--------|
| Select counseling service | Deterministic service routing (`one_on_one`, `admission`, `career`, `none`) |
| Personalize “why this service” | From profile + Phase 9–11 additive fields only |
| Soft-gate to Phase 13 | On explicit continue / interest — **no URL** |
| Complete journey softly | On decline / `none` / skip path |

### Phase 12 must not

| Forbidden | Owner instead |
|-----------|----------------|
| Decide counseling “need strength” / recommendation bands | Removed — Phase 11 owns escalation need |
| Resolve final-decision hesitation | Phase 11 (frozen) |
| Share OOO as escalation for unresolved objections | Phase 11 hesitation escalation (frozen) |
| NIAT admission-interest OOO interrupt | Phase 11 NIAT funnel (frozen) |
| Expose booking URLs or CTAs | Phase 13 **only** |
| Book / collect slot, phone, payment, form fields | Phase 13 |
| WhatsApp booking writes / CRM booking creates | Section E / Phase 13 |
| Human copilot / agent transfer | Phase 14 |
| Restart Phase 7 / re-evaluate colleges | Frozen earlier phases |
| Re-rank / regenerate Phase 5–9 outputs | Frozen |
| Call LLM for routing | — |

### Relationship to today’s stub

Today Phase 11 non-escalate exit uses `counseling_invitation` (legacy Phase 8 invite + Section E URL) as **`phase_12_stub_invitation`**.

At implementation (after approval only):

- Replace that **handoff target only** with Phase 12 (same pattern as Phase 10 → Phase 11 handoff).  
- Do **not** change Phase 11 hesitation/escalation/NIAT logic.  
- Legacy `counseling_invitation` booking URL behavior moves to **Phase 13** — not Phase 12.

---

## 3. Inputs (read-only)

All inputs are **read-only**. Phase 12 may add only additive `phase12*` fields.

| Source | Fields (illustrative) |
|--------|------------------------|
| Profile | `preferredCourse`, `careerGoal`, `studentPriorities` / interests, `budgetPreference`, `locationPreference`, parent preference / concerns |
| Phase 7 (context only) | `decisionReadiness`, `resolvedConcerns` |
| Phase 9 | `phase9Recommendations`, Best Match, confidence labels |
| Phase 10 | `futurePathVisionPresented` |
| Phase 11 | `phase11ConfidenceCheck`, `phase11ResolvedHesitations`, `phase11Escalated`, `phase11EscalationReason`, `phase11ExitTarget` |
| NIAT funnel | `niatInterestDetected`, `niatOneOnOneRecommended` |
| Journey flags | Shortlist size, preferred college, multi-goal / career-clarity signals |

### Skip gate (preserve — mandatory)

If **any** of:

- Phase 11 escalated (`phase11Escalated === true` / `phase11ExitTarget === 'one_on_one_escalation'`)  
- **OR** NIAT One-on-One shown (`niatOneOnOneRecommended === true`)

→ **Skip Phase 12 completely.**  
→ Soft complete / sticky only — **no** second counseling recommendation.

This prevents duplicate counseling recommendation.

---

## 4. Deterministic decision model

### 4.1 No recommendation bands

**Removed** (do not implement):

- `strongly_recommended`  
- `recommended`  
- `optional`  
- `not_required`  

Phase 12 does **not** score recommendation strength. It selects a **counseling service**.

### 4.2 Counseling services

| Service id | Experience | Typical when |
|------------|------------|--------------|
| `one_on_one` | Personalized One-on-One with IIT alumni / admissions experts | Multi-factor personal situation, parent alignment, high-touch decision support |
| `admission` | Admission-focused counseling | Exam/eligibility/process clarity for course path; admission questions dominate |
| `career` | Career-pathway counseling | Goals / branch / learning-path clarity; career direction is the main residual topic |
| `none` | No additional counseling service | Student continues with AI journey outcomes only; soft close |

Phase 12 **selects** the service. Phase 13 **owns booking CTA, URL, and flow** for that service.

### 4.3 Service selection rules (deterministic, no LLM)

Priority-ordered matching (first match wins). Exact predicates freeze at implementation via cert:

```
1. Skip gate already applied (escalation / NIAT OOO) → never reach selector

2. If admission-process / eligibility / “how do I get in” signals dominate
   (and NIAT OOO was NOT already shown — else skipped)
   → service = admission

3. Else if parent-alignment / family-decision signals dominate
   OR multi-factor personal complexity (budget ∩ location ∩ parents)
   → service = one_on_one

4. Else if career-goal / multi-path / learning-pathway clarity signals dominate
   → service = career

5. Else if phase11ConfidenceCheck in {ready, yes}
   AND no strong parent / admission / career residual signals
   → service = none

6. Else → service = one_on_one   // default continue-path service
```

**Notes:**

- “Need strength” is not computed. Rules classify **which experience**, not how strongly to push.  
- Copy always remains optional and non-pressuring, including when service ≠ `none`.  
- NIAT-specific OOO remains Phase 11 only (skip gate). Phase 12 must not invent a second NIAT pitch.

### 4.4 Personalization reasons (deterministic templates)

Pick 1–2 reason codes tied to the **selected service** (never invent facts):

| Reason code | Fits services | Narrative focus |
|-------------|---------------|-----------------|
| `parent_alignment` | `one_on_one` | Family discussion using shared counseling evidence |
| `admission_guidance` | `admission` | Eligibility / process clarity for their course path |
| `career_pathway` | `career` | Goals, branch fit, learning journey → next academic steps |
| `multi_path_clarity` | `career`, `one_on_one` | Narrowing remaining direction ambiguity |
| `budget_location_tradeoff` | `one_on_one` | Balancing constraints already shared |
| `confidence_context` | any except pushy `none` | Session can deepen confidence — never “you must book” |

Copy rules: optional tone; no guarantees; reference Best Match / course / goal only when present; **never include a URL**.

---

## 5. Conversation flow

**Preferred (enter Phase 12):**

```
Phase 11 non-escalate exit
        ↓
Phase 12 selects service + reasons (deterministic)
        ↓
AI: Personalized explanation of the selected counseling experience
    (why this service fits *you* — no booking URL)
AI: Soft choice — Continue | Not now | Ask a question
        ↓
Continue     → Phase 13 (booking CTA / URL / flow)  [not implemented yet]
Not now      → conversation_complete (no pressure)
Question     → short in-scope answer; stay on Phase 12 (still no URL)
```

**Skip path (Phase 11 escalated OR NIAT One-on-One shown):**

```
Skip Phase 12 completely
        ↓
Soft complete / sticky (no counseling recommendation)
```

**Service = `none`:**

```
Acknowledge journey completion
Optional human counseling remains available later — without pitching a service hard
Done / soft complete (Continue to Phase 13 only if product later defines a generic book path)
```

Never invent dialogue that reopens Phase 7, re-lists colleges, or pastes booking links.

---

## 6. State machine

**Proposed stage:** `phase_12_personalized_counseling_recommendation`

| Step | Behavior |
|------|----------|
| `counsel_rec_present` | Present selected service + personalized why + soft prompt (**no URL**) |
| `counsel_rec_followup` | Handle Continue / Not now / questions |
| (exit) `phase_13_*` | Booking CTA / URL / flow — **Phase 13 only** |
| (exit) `conversation_complete` | Decline / `none` / skip path |

**Additive profile fields only:**

- `phase12Service` (`one_on_one` | `admission` | `career` | `none`)  
- `phase12Reasons[]`  
- `phase12Presented`, `phase12EngineVersion`  
- `phase12Outcome` (`continued` | `declined` | `skipped_already_offered` | `none_selected`)  

**Removed fields (do not use):** `phase12Band`, recommendation strength scores.

**Handoff from Phase 11 (implementation delta, approval-gated):**

```
phase11 exitToNextStage (non-escalate)
  today  → counseling_invitation (stub — includes URL today)
  future → phase_12 start (if not skip-gated) → Phase 13 owns URL later
```

Phase 11 hesitation/escalation/NIAT engines remain frozen; only the **non-escalate exit target** changes when Phase 12 ships.

---

## 7. Analytics events (proposed)

Keep funnels distinct from Phase 11 OOO escalation / NIAT.

| Event | When | Key fields |
|-------|------|------------|
| `phase12_recommendation_started` | Enter Phase 12 | prior `phase11ExitTarget` |
| `phase12_service_selected` | Service chosen | `service` |
| `phase12_recommendation_presented` | Message sent | `service`, `reasons[]` |
| `phase12_recommendation_continued` | Student → Phase 13 | `service` |
| `phase12_recommendation_declined` | Not now / done | `service` |
| `phase12_recommendation_skipped` | Escalation / NIAT OOO already shown | `skipReason` |

**Removed:** `phase12_option_selected`, `phase12_recommendation_scored` (no strength bands).

**Do not** emit Phase 11/NIAT `one_on_one_recommended` events from Phase 12.  
**Do not** emit booking click/submit events from Phase 12 — Phase 13 owns those with the booking URL.

---

## 8. Guardrails

Always:

- Optional  
- Honest  
- Personalized from real journey fields  
- Non-pressuring  
- Deterministic service routing  

Never:

- Expose booking URLs or booking CTAs (Phase 13 only)  
- Guarantee admissions, placements, salaries, scholarships  
- Force or imply booking is mandatory  
- Restart Phase 7 / Phase 11 hesitation loops  
- Modify recommendations, rankings, or prior phase outputs  
- Book inside WhatsApp  
- Human handoff  
- Duplicate Phase 11 / NIAT OOO pitches  
- LLM for service selection  
- Recommendation-strength bands  

Content budget: max 2–3 WhatsApp bubbles; one idea per message (Global Conversation Quality Pass).

---

## 9. Phase boundaries (no overlap)

| Phase | Responsibility | Phase 12 must not |
|-------|----------------|-------------------|
| **11** | Resolve hesitation; decide exceptional OOO escalation; NIAT interest OOO | Re-decide need; re-run those funnels |
| **12** | Select counseling **service** + explain why | Score “how strongly”; book; show URLs |
| **13** | Booking CTA, booking URL, booking flow for selected service | Select the service (Phase 12) |
| **14** | Human counselor engagement / copilot | Soft service selection (Phase 12) |

---

## 10. Production considerations

| Area | Assessment |
|------|------------|
| **Architecture** | Deterministic service selector + template personalizer (constants / core / parser / engine) |
| **Maintainability** | Priority rules in constants; cert-locked; no band matrix to tune |
| **Extensibility** | New services additive; skip-gate protects frozen Phase 11 funnels |
| **Regression risk** | **Medium** — replaces invitation stub handoff; Phase 9–11 + NIAT certs must stay green; invitation URL tests move to Phase 13 |
| **Analytics** | `phase12_service_selected` + lifecycle; no collision with frozen OOO sources |
| **State transitions** | Clear skip vs present vs Phase 13 (URL-free until 13) |
| **Section E** | Untouched in Phase 12; Phase 13 owns URL/booking UX |

---

## 11. Production readiness assessment (plan stage)

| Area | Status |
|------|--------|
| Slot after Phase 11 (non-escalate) | Ready |
| Differentiation from Phase 11 / NIAT | Ready (skip-gate + service routing, not need scoring) |
| Deterministic service selection | Ready |
| Personalization without sales tone | Ready (reason codes) |
| URL ownership (Phase 13 only) | Ready — **mandatory** |
| Freeze compatibility | Handoff-only Phase 11 exit delta |
| Risk | Medium — stub replacement; invitation URL migration to Phase 13 |

**Plan readiness:** Suitable for approval of **this** revision.  
**Code readiness:** **Not started** (planning only).

---

## 12. Risks and recommendations

| Risk | Mitigation |
|------|------------|
| Double-pitch after Phase 11 escalation / NIAT | Hard skip-gate — skip Phase 12 completely |
| Phase 12 accidentally shows booking URL | Cert negative cases; no URL helpers in Phase 12 module |
| Confusion with legacy `counseling_invitation` | Phase 13 owns CTA/URL; Phase 12 is URL-free |
| Service rules feel arbitrary | Cert table for each service id + personalization reason |
| Regression on Phase 9–11 | Mandatory full cert gate before merge |

**Recommendations before implementation:**

1. Approve **this** revised plan.  
2. Confirm service catalog labels/copy for `one_on_one` / `admission` / `career` / `none`.  
3. Confirm Phase 13 URL mapping per service (out of Phase 12 scope).  
4. Implementation order: Phase 12 engine (URL-free) → handoff-only Phase 11 exit swap → certs → freeze → Phase 13 plan.  

---

## 13. Explicit non-goals (this milestone)

- No Phase 12 code until approval of **this** revision  
- No recommendation-strength bands  
- No booking URLs / CTAs in Phase 12  
- No Phase 11 / 10 / 9 / Section E behavior changes beyond approved handoff target  
- No Phase 13 / 14 implementation  
- No LLM routing  

---

## 14. Approval gate

**Do not implement Phase 12 until this revised architecture plan is explicitly approved.**

When approved, deliver: incremental implementation preserving Phase 11 v1.1.0 → certification → freeze — then wait for Phase 13 approval.
