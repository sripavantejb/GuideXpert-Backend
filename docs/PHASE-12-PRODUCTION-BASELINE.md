# Phase 12 — Production Baseline (FROZEN)

**Status:** Production certified and frozen  
**Engine version:** `PHASE12_ENGINE_VERSION = v1.0.0`  
**Freeze date:** 2026-07-18  
**Name:** Counseling Experience Selection

---

## 1. Freeze confirmation

Phase 12 **v1.0.0** is the production regression baseline.

Do **not** change behavior unless:

- Fixing a **verified bug** or **regression** against this baseline, or  
- The user explicitly requests a Phase 12 change with acknowledged freeze risk  

**Do not implement Phase 13** until explicitly approved.  
No booking functionality may be added to Phase 12 after this freeze.

---

## 2. Frozen capabilities

### Counseling Experience Selection

- Deterministic counseling service selection  
- Service catalog (frozen): `one_on_one` | `admission` | `career` | `none`  
- Personalized service explanation (“why this service”)  
- Soft Continue / Not now / question follow-up  
- Continue → `phase_13_booking_placeholder` (stub only; no URL)  
- Decline / skip → `conversation_complete`

### Skip gate (mandatory — never bypass)

Skip Phase 12 completely if **either**:

- Phase 11 One-on-One escalation occurred (`phase11Escalated` / `phase11ExitTarget === 'one_on_one_escalation'`), **or**  
- NIAT One-on-One recommendation occurred (`niatOneOnOneRecommended`)

These students already have the correct counseling recommendation.

### URL ownership (frozen)

| Owner | Owns |
|-------|------|
| **Phase 12** | Service recommendation + personalization |
| **Phase 13** | Booking CTA, booking URL, booking workflow |

Phase 12 must **never** expose booking URLs.

---

## 3. Architecture (frozen)

```
phase_11_final_decision_hesitation      [FROZEN v1.1.0]
  ├─ escalate / NIAT OOO → skip Phase 12
  └─ non-escalate exit (handoff only)
        ↓
phase_12_personalized_counseling_recommendation  [FROZEN v1.0.0]
  • skip gate
  • select: one_on_one | admission | career | none
  • personalized explanation (no URLs)
  • continue → phase_13_booking_placeholder (stub)
  • decline / skip → conversation_complete
```

---

## 4. Frozen state machine

| Stage / step | Behavior |
|--------------|----------|
| `counsel_rec_present` / `counsel_rec_followup` | Present selected service + soft prompt |
| Continue | → `phase_13_booking_placeholder` (stub copy; no URL) |
| Decline / Done | → `conversation_complete` |
| Skip gate hit | Soft complete; emit `phase12_skipped` |

### Additive profile fields (frozen)

`phase12Service`, `phase12Reasons`, `phase12Presented`, `phase12Outcome`, `phase12Skipped`, `phase12SkipReason`, `phase12Completed`, `phase12ExitTarget`, `phase12EngineVersion`

Previous phase outputs remain **immutable**.

---

## 5. Frozen service selector

First match wins (no strength bands, no LLM):

1. Skip gate  
2. **admission** — explicit admission/eligibility language (not routine exam/rank alone)  
3. **one_on_one** — parent alignment and/or budget+location+parent complexity  
4. **career** — pathway / fit / multi-priority signals  
5. **none** — confident `ready`/`yes` without residual signals  
6. Default continue-path → **one_on_one**

---

## 6. Frozen analytics

| Event | When |
|-------|------|
| `phase12_started` | Enter Phase 12 |
| `phase12_service_selected` | Service chosen |
| `phase12_presented` | Personalized message sent |
| `phase12_continue` | Continue → Phase 13 stub |
| `phase12_declined` | Not now / done |
| `phase12_skipped` | Skip gate (escalation / NIAT) |

Maintain compatibility with all earlier (frozen) analytics.

---

## 7. Production guardrails (frozen)

Phase 12 must never:

- Expose booking URLs  
- Collect booking information  
- Restart earlier phases (including Phase 7 / 11)  
- Regenerate recommendations  
- Compare colleges  
- Mutate rankings or recommendations  
- Mutate prior phase outputs  
- Use LLM routing  
- Guarantee admissions / placements / salaries / scholarships  
- Force counseling or booking  

Remain deterministic and optional.

---

## 8. Certification baseline

| Suite | Result |
|-------|--------|
| Journey Phases 1–12 | **73/73 PASS** |
| Phase 12 cert | **13/13 PASS (100%)** |
| Phase 11 / NIAT / 9 / 10 | **24/24 · 14/14 · 13/13 · 13/13** |
| Phase 1–12 regression runner | **6/6 PASS** |

```bash
cd GuideXpert-Backend
node --test test/careerCounsellingJourney.test.js
node scripts/phase9ProductionCertification.js
node scripts/phase10ProductionCertification.js
node scripts/phase11ProductionCertification.js
node scripts/niatInterestOneOnOneCertification.js
node scripts/phase12ProductionCertification.js
node scripts/phase1to12Regression.js
```

Certified artifacts (representative):  
`smoke-results/sectionF/phase12-certification-2026-07-18T11-26-43-464Z.*`

---

## 9. Protected surfaces

| Area | Paths |
|------|-------|
| Constants | `constants/careerCounsellingV2CounselingExperienceSelection.js` |
| Core / parser / engine | `careerCounsellingV2CounselingExperienceSelection*.js` |
| Analytics | `phase12_*` in `careerCounsellingV2Analytics.js` |
| Certs | `scripts/phase12ProductionCertification.js`, `scripts/phase1to12Regression.js` |
| Journey wiring | Phase 11 handoff + discovery/engine forwards only |
| Cursor rule | `.cursor/rules/phase-12-production-baseline.mdc` |
| Docs | `docs/PHASE-12-PRODUCTION-BASELINE.md`, `PHASE-12-ARCHITECTURE.md` |

---

## 10. Next

**Journey complete.** Phase 13 is frozen at **v1.0.0**. No Phase 14+.  
See [AI-COUNSELING-JOURNEY-PRODUCTION-COMPLETE.md](./AI-COUNSELING-JOURNEY-PRODUCTION-COMPLETE.md).
