# Phase 13 — Booking Orchestrator (Architecture)

**Status:** Production certified and **FROZEN** — `PHASE13_ENGINE_VERSION = v1.0.0`  
**Depends on:** Phase 12 **v1.0.0** (FROZEN) · Phases 9–11 / Section E (FROZEN)  
**Stage:** `phase_13_booking_orchestrator`  
**Canonical baseline:** [PHASE-13-PRODUCTION-BASELINE.md](./PHASE-13-PRODUCTION-BASELINE.md)  
**Journey:** [AI-COUNSELING-JOURNEY-PRODUCTION-COMPLETE.md](./AI-COUNSELING-JOURNEY-PRODUCTION-COMPLETE.md) — **no Phase 14**

---

## 1. Business objective

Phase 13 connects the AI counseling journey to the correct **website booking experience** for an already-selected counseling service. It owns CTA, registry routing, official URLs (after Book Now), and booking progress — not counseling.

---

## 2. Architecture

```
Phase 12 Continue (bookable service)
        ↓
phase_13_booking_orchestrator
  • BOOKING_SERVICE_REGISTRY resolve
  • booking_intro — CTA only (NO URL)
  • Book Now → booking_presented (registry URL)
  • Later → deferred complete (NO URL)
  • booking_resume → Phase 13 directly (no Phase 9–12 replay)
```

### Canonical ownership

| Concern | Owner |
|---------|-------|
| Service selection | Phase 12 |
| Booking CTA / URL / routing / progress | **Phase 13** |
| Booking create | Website / Section E |
| Exceptional OOO URLs | Phase 11 / NIAT (skip Phase 13) |

---

## 3. BOOKING_SERVICE_REGISTRY

Single form + `?service=` params for `one_on_one` | `admission` | `career`.  
Base URL and destinations live **only** in the registry. `none` is not registered — Phase 13 is skipped.

---

## 4. State machine

| Step | URL? |
|------|------|
| `booking_intro` | No |
| `booking_presented` | Yes (registry) |
| `booking_confirmed` | Re-share on request |
| `booking_deferred` → complete | No |
| `booking_completed` | Reserved (webhook) |

Additive `phase13*` fields only.

---

## 5. Skip rules (mandatory)

Skip when `phase12Service == none`, Phase 11 OOO already offered, or NIAT OOO already offered.

---

## 6. Analytics

`phase13_started`, `booking_service_selected`, `booking_cta_presented`, `booking_continue`, `booking_url_shared`, `booking_resume`, `booking_deferred`, `booking_abandoned`  
Reserved: `booking_completed`

---

## 7. Files

| Role | Path |
|------|------|
| Constants + registry | `constants/careerCounsellingV2BookingOrchestrator.js` |
| Core / parser / engine | `careerCounsellingV2BookingOrchestrator*.js` |
| Cert | `scripts/phase13ProductionCertification.js` |
| Regression | `scripts/phase1to13Regression.js` |
