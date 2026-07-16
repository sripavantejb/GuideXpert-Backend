# Section E — Production Baseline (Frozen)

**Status:** Production certified · **2026-07-16**  
**Verdict:** PASS · 53/53 (100%) · 0 failures · 0 warnings

## Certification summary

| Metric | Result |
|--------|--------|
| Pass rate | 100% (53/53) |
| Hallucinations | 0 |
| Duplicate CRM writes | 0 |
| Duplicate handoffs | 0 |
| LLM on deterministic booking queries | 0 |
| Pipeline | Real production WhatsApp → Gupshup → Vercel backend |

**Baseline reports (do not delete or overwrite):**

- `smoke-results/sectionE/sectionE-certification-2026-07-16T08-14-06-081Z.json`
- `smoke-results/sectionE/sectionE-certification-2026-07-16T08-14-06-081Z.md`

**Baseline commits:** `cdfc11a` (Website Booking Integration), `7b1cb9a` (cert script fix)

## Frozen architecture

Website is the only place bookings are created. WhatsApp is a contextual support channel that loads existing CRM bookings once per inbound message.

```
Inbound → Foundation
       → BookingContextResolver (single Mongo lookup)
       → BookingSupportRouter (deterministic early-exit)
       → Human Copilot (on handoff)
       → Scope Firewall
       → Intent classifier
       → Journeys → RAG → LLM
```

### Invariants (must hold in all future work)

1. **One Mongo lookup** per inbound via `loadLatestSubmissionOnce` in `bookingContextResolver.js`
2. **Deterministic routing** for booking-context queries — no LLM, RAG, ICE, CPA, or ICS
3. **No WhatsApp booking wizard** — never collect name/phone/date/time/exam/rank/category for create
4. **Reschedule/cancel** — website portal redirect only; no CRM or lifecycle writes from chat
5. **Hallucination guard** — no fabricated booking confirmation when `exists === false`
6. **Human Copilot** — booking context attached; no duplicate open handoffs; reuse existing handoff
7. **Scope firewall** — unrelated queries (Python, IPL, shopping, politics) blocked; booking queries bypass LLM

## Protected code

| Component | Location |
|-----------|----------|
| BookingContext resolver | `services/chatbot/bookingContext/bookingContextResolver.js` |
| Booking Support Router | `services/chatbot/bookingContext/bookingSupportRouter.js` |
| Intent patterns | `services/chatbot/bookingContext/bookingSupportIntentService.js` |
| Hallucination guard | `services/chatbot/bookingContext/bookingHallucinationGuard.js` |
| Orchestrator wiring | `services/chatbot/chatbotOrchestratorService.js` |
| Handoff dedup | `services/chatbot/handoffService.js` |
| Human Copilot | `services/chatbot/humanCopilot/**` |

## Change policy

- **Do not modify** Section E functionality unless fixing a verified bug or regression
- Any change touching protected paths requires re-running:
  - `node scripts/testBookingContextV2.js`
  - `node scripts/sectionEProductionCertification.js` (against production, with approval)
- Preserve backward compatibility with all certified flows

## Regression tests

```bash
# Unit (CASE A/B, hallucination guard, reschedule portal)
node scripts/testBookingContextV2.js

# Full production certification (live WhatsApp, ~8 min)
node scripts/sectionEProductionCertification.js
```

## Backlog (non-blocking)

Live validation of **CASE B** (no existing booking) on a dedicated test phone. Covered today by unit tests; does not block Section F or other development.

## Section F

No new functionality until the complete Section F specification is provided. When available:

1. Analyze specification
2. Produce implementation plan
3. Identify dependencies and regression risks to Section E
4. Implement incrementally while preserving certified Section E behavior
