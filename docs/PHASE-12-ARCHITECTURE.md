# Phase 12 — Counseling Experience Selection (Architecture)

**Status:** Production certified and **FROZEN** — `PHASE12_ENGINE_VERSION = v1.0.0`  
**Depends on:** Phase 11 **v1.1.0** (FROZEN), Phase 9 **v1.1.0**, Phase 10 **v1.0.0**, Section E (FROZEN)  
**Stage:** `phase_12_personalized_counseling_recommendation`  
**Canonical baseline:** [PHASE-12-PRODUCTION-BASELINE.md](./PHASE-12-PRODUCTION-BASELINE.md)  
**Do not begin Phase 13** without explicit approval.

---

## 1. Business objective

Phase 12 selects the most appropriate counseling **service** for students who continue past the AI journey **without** already receiving a One-on-One offer from Phase 11 hesitation escalation or the NIAT interest funnel.

It explains why that service fits, then soft-gates to a Phase 13 booking placeholder (no URLs).

It does **not** decide whether counseling is needed (Phase 11), book anything, or mutate prior phase outputs.

---

## 2. Architecture

```
phase_11_final_decision_hesitation   [FROZEN v1.1.0]
  ├─ escalate / NIAT OOO → skip Phase 12 (already offered)
  └─ non-escalate exit (handoff only)
        ↓
phase_12_personalized_counseling_recommendation  [v1.0.0]
  • skip gate
  • deterministic service select: one_on_one | admission | career | none
  • personalized “why this service” (no URLs)
  • continue → phase_13_booking_placeholder (stub, no URL)
  • decline / skip → conversation_complete
```

---

## 3. State machine

| Stage / step | Behavior |
|--------------|----------|
| `counsel_rec_present` / `counsel_rec_followup` | Present service + soft Continue / Not now |
| Continue | → `phase_13_booking_placeholder` (stub copy only) |
| Decline / Done | → `conversation_complete` |
| Skip gate hit | Soft complete; `phase12_skipped` |

### Additive profile fields only

`phase12Service`, `phase12Reasons`, `phase12Presented`, `phase12Outcome`, `phase12Skipped`, `phase12SkipReason`, `phase12Completed`, `phase12ExitTarget`, `phase12EngineVersion`

---

## 4. Service selection (deterministic, first match)

1. **Skip** if Phase 11 escalated or NIAT OOO already shown  
2. **admission** — explicit admission/eligibility language (not routine exam/rank alone)  
3. **one_on_one** — parent alignment and/or budget+location+parent complexity  
4. **career** — pathway / fit / multi-priority signals  
5. **none** — confident `ready`/`yes` without residual signals  
6. Default continue-path → **one_on_one**

No strength bands. No LLM routing.

---

## 5. Analytics

| Event | When |
|-------|------|
| `phase12_started` | Enter Phase 12 |
| `phase12_service_selected` | Service chosen |
| `phase12_presented` | Personalized message sent |
| `phase12_continue` | Student continues → Phase 13 stub |
| `phase12_declined` | Not now / done |
| `phase12_skipped` | Escalation / NIAT skip gate |

Compatible with frozen Phase 11 / NIAT / Section E analytics.

---

## 6. Guardrails

Never: guarantee admissions/placements/salaries/scholarships; force counseling/booking; pressure tactics; expose booking URLs; mutate rankings or prior outputs; restart Phase 7/11; LLM routing.

---

## 7. Files

| Role | Path |
|------|------|
| Constants | `constants/careerCounsellingV2CounselingExperienceSelection.js` |
| Core | `services/.../careerCounsellingV2CounselingExperienceSelectionCore.js` |
| Parser | `services/.../careerCounsellingV2CounselingExperienceSelectionParser.js` |
| Engine | `services/.../careerCounsellingV2CounselingExperienceSelectionEngine.js` |
| Cert | `scripts/phase12ProductionCertification.js` |
| Plan (approved) | `docs/PHASE-12-IMPLEMENTATION-PLAN.md` |

---

## 8. Out of scope (Phase 13+)

Booking flow, booking URLs, human handoff, reminder engine, LLM routing.
