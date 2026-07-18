# Phase 11 — Production Baseline (FROZEN)

**Status:** Production certified and frozen  
**Engine version:** `PHASE11_ENGINE_VERSION = v1.1.0`  
**Freeze date:** 2026-07-18  
**Name:** Final Decision Hesitation Resolution (+ One-on-One escalation + NIAT interest funnel)

---

## 1. Freeze confirmation

Phase 11 **v1.1.0** is the production regression baseline.

Do **not** change behavior unless:

- Fixing a **verified bug** or **regression** against this baseline, or  
- The user explicitly requests a Phase 11 change with acknowledged freeze risk  

Phase 12 handoff target is frozen separately at **v1.0.0**. Do **not** change Phase 11 hesitation / escalation / NIAT logic for Phase 12 work.

---

## 2. Frozen capabilities

### A. Final Decision Hesitation Resolution

- Deterministic hesitation engine  
- Dedicated taxonomy (not Phase 7)  
- Personalized confidence-building replies  
- One confidence confirmation + optional second clarification  
- Fast path when no hesitation  
- Exit → Phase 12 (`phase_12_personalized_counseling_recommendation`) when not escalated (handoff only)  

### B. One-on-One Counseling Escalation (hesitation funnel)

Escalate only when:

- Repeated unresolved hesitation  
- Multiple simultaneous / distinct hesitations  
- Repeated reassurance requests  
- Explicit expert/counselor request  

Never escalate after the first objection alone. Session remains optional.  
URL only: `https://www.guidexpert.co.in/one-on-one-session`

### C. NIAT Interest Funnel (admission-guidance)

Separate deterministic detector. Trigger only on explicit join / admission / apply / strong positive interest.  
Do not trigger on informational or comparison mentions.  
Same official One-on-One URL. Distinct narrative and analytics from hesitation escalation.

---

## 3. Architecture (frozen)

```
phase_9_personalized_recommendation     [FROZEN v1.1.0]
        ↓ continue
phase_10_future_path_vision             [FROZEN v1.0.0]
        ↓ continue
phase_11_final_decision_hesitation      [FROZEN v1.1.0]
  ├─ fast path / single resolved → phase_12 (handoff only; Phase 12 FROZEN v1.0.0)
  ├─ escalation thresholds / expert ask → hesitation_escalation
  │         → One-on-One URL (source: phase11_hesitation; skips Phase 12)
  └─ (parallel journey entry)
niat_interest_one_on_one                [FROZEN — admission funnel]
        → One-on-One URL (source: niat_interest; skips Phase 12)
```

---

## 4. Frozen state machine

| Stage / step | Behavior |
|--------------|----------|
| `hesitation_ask` | Ask last hesitation; Ready/No → exit check; expert → escalate |
| `hesitation_confirm` | Yes → exit check; No → `hesitation_second` (once) |
| `hesitation_second` | One more reply → exit check (often escalate) |
| `hesitation_escalation` | Optional OOO narrative + official URL |
| Exit (no escalate) | Handoff → `phase_12_personalized_counseling_recommendation` (Phase 12; hesitation logic unchanged) |
| `niat_interest_one_on_one` / `niat_one_on_one_offer` | Immediate NIAT admission OOO offer |

---

## 5. Frozen analytics specification

### Hesitation funnel (`source: phase11_hesitation`)

| Event | When |
|-------|------|
| `phase11_hesitation_detected` | Taxonomy hesitation identified |
| `one_on_one_recommended` | Escalation OOO shared (`source: phase11_hesitation`) |
| `one_on_one_link_clicked` | Click webhook when available |
| `one_on_one_form_submitted` | Form submit when integration available |

Lifecycle dual-emits retained: `phase11_hesitation_*`, `phase11_escalation_recommended`.

### NIAT funnel (`source: niat_interest`)

| Event | When |
|-------|------|
| `niat_interest_detected` | Explicit NIAT intent |
| `one_on_one_recommended` | OOO shared (`source: niat_interest`) |
| `niat_one_on_one_link_clicked` | Alias on NIAT click |
| `one_on_one_form_submitted` | Form submit when integration available (`source: niat_interest`) |

Funnels must remain independently measurable.

---

## 6. Messaging contract (frozen)

| Funnel | Focus |
|--------|--------|
| **Hesitation escalation** | Confidence, clarity, resolving complex decision concerns |
| **NIAT interest** | Profile evaluation, admission guidance, eligibility, academic pathway |

Do not reuse hesitation narrative for NIAT (or vice versa).

---

## 7. Production guardrails (frozen)

Never: guarantee admissions/placements/salaries/scholarships; force booking; pressure; restart Phase 7; modify recommendations/rankings/prior outputs; bypass deterministic routing; use LLMs for routing.

---

## 8. Certification baseline

| Suite | Result |
|-------|--------|
| Journey Phases 1–11 + NIAT | **70/70 PASS** |
| Phase 11 cert | **24/24 PASS** |
| NIAT interest cert | **14/14 PASS** |
| Phase 9 / 10 cert | **13/13** each |

```bash
cd GuideXpert-Backend
node --test test/careerCounsellingJourney.test.js
node scripts/phase9ProductionCertification.js
node scripts/phase10ProductionCertification.js
node scripts/phase11ProductionCertification.js
node scripts/niatInterestOneOnOneCertification.js
```

---

## 9. Protected surfaces

| Area | Paths |
|------|-------|
| Constants | `constants/careerCounsellingV2FinalDecisionHesitation.js`, `constants/careerCounsellingV2NiatInterest.js` |
| Engines / core / parser | `careerCounsellingV2FinalDecisionHesitation*.js`, `careerCounsellingV2NiatInterestService.js` |
| Analytics | Phase 11 + One-on-One + NIAT events in `careerCounsellingV2Analytics.js` |
| Certs | `scripts/phase11ProductionCertification.js`, `scripts/niatInterestOneOnOneCertification.js` |
| Journey wiring | `careerCounsellingJourneyService.js` (NIAT intercept + Phase 11 exports) |
| Cursor rule | `.cursor/rules/phase-11-production-baseline.mdc` |
| Cert reports | `smoke-results/sectionF/phase11-certification-2026-07-18T11-14-59-115Z.*`, `niat-interest-certification-2026-07-18T11-14-59-230Z.*` |

---

## 10. Next

**Journey complete** through Phase 13 (FROZEN v1.0.0). No Phase 14+. See [AI-COUNSELING-JOURNEY-PRODUCTION-COMPLETE.md](./AI-COUNSELING-JOURNEY-PRODUCTION-COMPLETE.md).
