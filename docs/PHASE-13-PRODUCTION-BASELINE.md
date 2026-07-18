# Phase 13 — Production Baseline (FROZEN)

**Status:** Production certified and frozen  
**Engine version:** `PHASE13_ENGINE_VERSION = v1.0.0`  
**Freeze date:** 2026-07-18  
**Name:** Booking Orchestrator

---

## 1. Freeze confirmation

Phase 13 **v1.0.0** is the production regression baseline for booking orchestration.

Do **not** change behavior unless:

- Fixing a **verified bug** or **regression** against this baseline, or  
- The user explicitly requests a Phase 13 change with acknowledged freeze risk  

**No Phase 14 (or later chatbot phases) will be introduced.**  
The chatbot’s responsibility ends when the student is routed to the official website booking experience.

---

## 2. Frozen capabilities

- Canonical `BOOKING_SERVICE_REGISTRY` (single form + `?service=` params)  
- Booking CTA before any URL  
- Official booking URL only after **Book Now** (or link-seeking resume)  
- Deterministic `booking_resume` (no Phase 9–12 replay)  
- Skip when `phase12Service == none`, Phase 11 OOO offered, or NIAT OOO offered  
- Additive `phase13*` state + booking analytics  

### Explicitly out of chatbot scope (frozen)

Booking creation, counselor assignment, reminders, meeting scheduling, session management, attendance, session completion, CRM workflows — **website / operations only**.

---

## 3. Architecture (frozen)

```
phase_12_personalized_counseling_recommendation  [FROZEN v1.0.0]
        ↓ Continue (bookable service)
phase_13_booking_orchestrator                    [FROZEN v1.0.0]
  • CTA (no URL)
  • Book Now → registry URL
  • Later → soft complete
  • booking_resume → Phase 13 only
        ↓
Official GuideXpert website / One-on-One form
        ↓
Human counselor process (OUTSIDE chatbot)
```

---

## 4. Frozen state machine

| Step | URL in reply? |
|------|---------------|
| `booking_intro` | No |
| `booking_presented` | Yes (registry only) |
| `booking_confirmed` | Re-share on request |
| `booking_deferred` → complete | No |
| `booking_completed` | Reserved — future webhook only; not chat-emitted |

---

## 5. Frozen analytics

`phase13_started`, `booking_service_selected`, `booking_cta_presented`, `booking_continue`, `booking_url_shared`, `booking_resume`, `booking_deferred`, `booking_abandoned`  
Reserved: `booking_completed`

---

## 6. Production guardrails (frozen)

Never: URL before Book Now; guarantees; pressure; restart earlier phases; mutate prior outputs; WhatsApp/CRM booking create; LLM routing; invent URLs outside the registry.

---

## 7. Certification baseline

| Suite | Result |
|-------|--------|
| Journey 1–13 | **76/76 PASS** |
| Phase 13 cert | **13/13 PASS** |
| Phase 1–13 regression | **7/7 PASS** |

```bash
cd GuideXpert-Backend
node scripts/phase1to13Regression.js
```

---

## 8. Protected surfaces

| Area | Paths |
|------|-------|
| Registry / constants | `constants/careerCounsellingV2BookingOrchestrator.js` |
| Core / parser / engine | `careerCounsellingV2BookingOrchestrator*.js` |
| Analytics | `booking_*` / `phase13_*` in `careerCounsellingV2Analytics.js` |
| Certs | `scripts/phase13ProductionCertification.js`, `scripts/phase1to13Regression.js` |
| Cursor rule | `.cursor/rules/phase-13-production-baseline.mdc` |
| Journey complete | `docs/AI-COUNSELING-JOURNEY-PRODUCTION-COMPLETE.md` |

---

## 9. Next

**Journey complete.** No further chatbot phases. Future work must be additive and must not alter frozen baselines without architecture review + freeze waiver.
