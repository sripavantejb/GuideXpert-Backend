# Phase 13 — Booking Orchestrator (Architecture Plan)

**Status:** **FROZEN** at ship — journey complete. See [PHASE-13-PRODUCTION-BASELINE.md](./PHASE-13-PRODUCTION-BASELINE.md) and [AI-COUNSELING-JOURNEY-PRODUCTION-COMPLETE.md](./AI-COUNSELING-JOURNEY-PRODUCTION-COMPLETE.md)  
**Depends on:** Phase 12 production baseline **v1.0.0** (FROZEN)  
**Also respects:** Phase 9 **v1.1.0**, Phase 10 **v1.0.0**, Phase 11 **v1.1.0**, Section E (FROZEN)  
**Stage:** `phase_13_booking_orchestrator`  
**Engine version:** `PHASE13_ENGINE_VERSION = v1.0.0`  
**Replaces at ship:** today’s `phase_13_booking_placeholder` stub (Phase 12 continue handoff)  
**Does not modify:** Phases 9–12 counseling logic, Section E booking-create path, Phase 11 / NIAT URL offers

---

## Revision changelog (vs first draft)

| # | Change | Decision |
|---|--------|----------|
| 1 | Canonical registry | Introduce **`BOOKING_SERVICE_REGISTRY`** as the sole Phase 13 destination source of truth |
| 2 | URL timing | **Never** expose booking URLs until user selects **Book Now** |
| 3 | Destination shape | Prefer **single booking form** + service query params (`one_on_one` / `admission` / `career`) unless Product explicitly requires separate forms |
| 4 | `none` | **Skip Phase 13 completely** when `phase12Service === none` |
| 5 | Analytics | Add **`booking_service_selected`** |
| 6 | Resume | Add deterministic **`booking_resume`** intent → enter Phase 13 directly (no Phases 9–12 replay) |
| 7 | Docs | Explicit sections: registry, resume booking, canonical ownership table |

---

## 1. Business objective

Phase 13 is the **Booking Orchestrator**.

It connects the completed AI counseling journey (or a later resume intent) to the correct **website booking experience** for an already-selected counseling service.

**Student outcomes:**

- “I know which session I’m booking — and I only get the link when I’m ready.”  
- “I can book now, ask a process question, defer, or come back later with ‘send booking link’.”  
- “WhatsApp does not invent bookings; the website is the create path.”  

**It is not:** counseling selection, hesitation resolution, college recommendation/comparison, human copilot, or CRM booking create from chat.

---

## 2. Responsibilities

### Phase 13 MAY

| Responsibility | Notes |
|----------------|--------|
| Present booking CTA | Soft, optional — **CTA without URL** until Book Now |
| Present official booking URL | Only after Book Now (or resume Book Now / send-link path) |
| Resolve destination via registry | `BOOKING_SERVICE_REGISTRY` lookup only |
| Explain booking process | Website-only create; no WhatsApp booking writes |
| Track booking progress | Additive `phase13*` fields |
| Handle intents | Book now, Later, Questions, Done, **booking_resume** |
| Soft-complete | Deferred without pressure |
| Future webhook confirmation | `booking_completed` without redesign |

### Phase 13 MUST NOT

| Forbidden | Owner instead |
|-----------|----------------|
| Recommend / re-select counseling service | Phase 12 (frozen) |
| Handle hesitation / NIAT escalation | Phase 11 / NIAT (frozen) |
| Expose booking URL before Book Now | — (hard rule) |
| Enter when service is `none` | Soft-complete upstream / skip |
| Replay Phases 9–12 on resume | Resume enters Phase 13 only |
| Compare / recommend colleges; mutate rankings | Earlier phases (frozen) |
| Create WhatsApp / CRM bookings | Section E website path |
| LLM routing | — |

---

## 3. Canonical ownership table

| Concern | Owner | Notes |
|---------|-------|--------|
| Personalized college recommendation | Phase 9 (FROZEN) | Immutable inputs to later phases |
| Future path vision / confidence | Phase 10 (FROZEN) | No CTA / no URLs |
| Hesitation resolution | Phase 11 (FROZEN) | — |
| Exceptional One-on-One escalation URL | Phase 11 (FROZEN) | Official OOO URL only on escalate |
| NIAT interest → One-on-One URL | NIAT funnel (FROZEN) | Separate analytics source |
| Counseling **service** selection | Phase 12 (FROZEN) | `one_on_one` \| `admission` \| `career` \| `none` |
| Counseling “why this service” copy | Phase 12 (FROZEN) | No booking URLs |
| Booking CTA | **Phase 13** | No URL until Book Now |
| Booking URL / destination | **Phase 13** | Via `BOOKING_SERVICE_REGISTRY` only |
| Booking instructions / progress | **Phase 13** | Additive state + analytics |
| Booking create (CRM / website form submit) | **Website / Section E** | Chat never writes bookings |
| Human copilot / handoff | Phase 14+ | Out of scope |

**Rule:** No phase before Phase 13 may expose booking URLs for the Phase 12→13 continue path. Phase 11 / NIAT retain their frozen exceptional OOO URL ownership and cause Phase 13 skip when already offered.

---

## 4. Inputs (read-only)

| Source | Fields |
|--------|--------|
| Phase 12 | `phase12Service`, `phase12Reasons`, `phase12Outcome`, … |
| Phase 11 / NIAT | Escalation / OOO-offered flags (skip gate only) |
| Profile | Copy personalization only |
| Resume | Prior `phase12Service` (or stored `phase13Service`) must already exist |

### Entry rules

| Entry | Behavior |
|-------|----------|
| **Primary** | Phase 12 Continue with `phase12Service` ∈ {`one_on_one`, `admission`, `career`} |
| **`none`** | **Skip Phase 13 completely** — soft complete; no CTA, no URL, no Phase 13 stage |
| **Upstream OOO already shown** | Skip Phase 13 (no duplicate URL) |
| **`booking_resume`** | Enter Phase 13 directly if a bookable service is already known; never replay Phases 9–12 |
| Legacy invitation | Regression-only until Phase 13 ships |

### Immutability

Never mutate Phase 9–12 counseling outputs, rankings, or NIAT/Phase 11 escalation fields.

---

## 5. Booking registry (`BOOKING_SERVICE_REGISTRY`)

### 5.1 Canonical registry (Phase 13 only)

Introduce a frozen-at-ship constant object:

```text
BOOKING_SERVICE_REGISTRY = {
  one_on_one: {
    serviceKey: 'one_on_one',
    formMode: 'single_form',
    baseUrl: '<OFFICIAL_BOOKING_FORM_BASE>',   // product-confirmed
    serviceParam: 'one_on_one',
    ctaLabel: 'One-on-One counseling',
  },
  admission: {
    serviceKey: 'admission',
    formMode: 'single_form',
    baseUrl: '<OFFICIAL_BOOKING_FORM_BASE>',
    serviceParam: 'admission',
    ctaLabel: 'Admission counseling',
  },
  career: {
    serviceKey: 'career',
    formMode: 'single_form',
    baseUrl: '<OFFICIAL_BOOKING_FORM_BASE>',
    serviceParam: 'career',
    ctaLabel: 'Career counseling',
  },
}
```

**Default policy (approved):** one official booking form; destination URL =

`baseUrl + ?service=<serviceParam>`  
(exact query key confirmed with Product; no PII in query).

**Escape hatch:** if Product later requires separate forms, set `formMode: 'dedicated_form'` and `baseUrl` per row — still registry-only; Phases 9–12 unchanged. Do **not** invent URLs outside the registry.

**Not in registry:** `none` — there is no booking destination; Phase 13 does not start.

### 5.2 Resolve algorithm

```
resolveBookingDestination(profile):
  if phase11Escalated OR niatOneOnOneRecommended:
    return SKIP (already_offered_upstream)
  service = profile.phase12Service || profile.phase13Service
  if !service OR service === 'none':
    return SKIP (no_booking_needed)   // Phase 13 never starts
  entry = BOOKING_SERVICE_REGISTRY[service]
  if !entry:
    return FAILSAFE (abandoned / unmapped_service)
  return buildOfficialUrl(entry)  // stored in state; NOT shown until Book Now
```

URL may be **resolved and stored** on intro for analytics consistency, but **must not appear in any reply** until Book Now (or resume Book Now / “send booking link”).

### 5.3 Extensibility

Add a registry row (+ optional future Phase 12 service key under a separate freeze). State machine, resume, and webhooks stay stable. Phases 9–11 never reference the registry.

---

## 6. Conversation flow

### 6.1 Primary (from Phase 12)

```
Phase 12 Continue (service ∈ bookable set)
        ↓
Phase 13 booking_intro
  • resolve registry entry
  • emit booking_service_selected + phase13_started + booking_cta_presented
  • CTA only — NO URL in message
  Reply: Book now | Later | ask a question | Done
        ↓
   ┌────┴──────────┬────────────┐
   │               │            │
Book now         Later       Question
   │               │            │
   ▼               ▼            ▼
booking_presented  deferred   Stay intro
Share official URL  complete  (process FAQ;
emit booking_url_shared        still NO URL
+ booking_continue             until Book now)
   │
   ▼
optional booking_confirmed (intent: “I’ll book”)
   │
   ▼
conversation_complete (sticky)
```

### 6.2 Resume booking (`booking_resume`)

Users returning later with deterministic phrases such as:

- Book now  
- Send booking link  
- I'm ready  
- Schedule now  

**Behavior:**

1. Detect `booking_resume` at journey / orchestrator intercept (deterministic parser).  
2. **Do not** restart Phases 9–12.  
3. Require an already-known bookable service (`phase12Service` or prior `phase13Service` ∈ registry).  
4. If missing / `none` / upstream OOO already offered → soft decline (“no booking selected” / already offered) — do not invent a service.  
5. Enter Phase 13:
   - If intent is explicitly link-seeking (**Send booking link** / **Book now** / **Schedule now** / **I'm ready**): go to `booking_presented` and **share URL once** (same as Book Now).  
   - Else (generic resume without clear Book Now): enter `booking_intro` CTA-only, then wait for Book Now.  
6. Emit `booking_resume` (or `phase13_started` with `entry: resume`) + normal CTA/URL events as applicable.

Resume never re-runs counseling selection.

---

## 7. State machine

### Stage

`phase_13_booking_orchestrator`  
(Prefer implementing atop `phase_13_booking_placeholder` handoff first to minimize Phase 12 surface change; rename optional with handoff-only waiver.)

### Steps

| Step | Purpose | URL in reply? |
|------|---------|---------------|
| `booking_intro` | Resolve service; CTA only | **No** |
| `booking_presented` | After Book Now / resume link intent | **Yes** (registry URL only) |
| `booking_confirmed` | Chat-side “I’ll book” intent | URL may be re-shown once if asked |
| `booking_deferred` | Later → soft complete | **No** (do not sneak URL into defer copy) |
| `booking_completed` | Future webhook / CRM | N/A |
| `conversation_complete` | Sticky end | Re-share only on explicit resume / send-link |

### Additive fields (proposed)

`phase13EngineVersion`, `phase13Service`, `phase13DestinationKey`, `phase13BookingUrl` (resolved, may be set before share), `phase13CtaPresented`, `phase13UrlShared`, `phase13UrlSharedAt`, `phase13Entry` (`phase12_continue` \| `booking_resume`), `phase13Outcome`, `phase13SkipReason`, `phase13StartedAt`, `phase13WebhookBookingId` (future)

---

## 8. Analytics

Compatible with frozen Phase 11 / NIAT / Phase 12 / Section E. Phase 13 events:

| Event | When | Key fields |
|-------|------|------------|
| `phase13_started` | Orchestrator entered | `service`, `destinationKey`, `entry` |
| **`booking_service_selected`** | Registry service resolved for this session | `service`, `destinationKey`, `formMode` |
| `booking_cta_presented` | CTA shown (**no URL**) | `service` |
| `booking_continue` | Book Now (or equivalent) | `service` |
| `booking_url_shared` | Official URL first appears in reply | `service`, `url`/`urlHash` |
| `booking_deferred` | Later / not now | `service` |
| `booking_resume` | Resume intent routed into Phase 13 | `service`, `resumePhrase` |
| `booking_abandoned` | Unmapped / fail-safe | `reason` |
| `booking_completed` | **Future** external confirm | `service`, `externalId` |

**Do not** re-emit frozen `one_on_one_recommended` for Phase 13 URL shares (keep Phase 11 / NIAT funnels clean).

---

## 9. Guardrails

- Official registry URLs only  
- **No URL before Book Now** (including intro, questions, and deferred copy)  
- Skip Phase 13 entirely for `none`  
- Skip when upstream OOO already offered  
- No guarantees; no pressure; no phase restarts; no prior-output mutation  
- No WhatsApp/CRM booking creates  
- No “you’re booked” without webhook/`BookingContext` confirmation  
- Deterministic parsers only (including `booking_resume`)  
- No PII in URL query params  

---

## 10. Production readiness assessment (pre-implementation)

| Dimension | Assessment |
|-----------|------------|
| Maintainability | High — single `BOOKING_SERVICE_REGISTRY` |
| Routing simplicity | High — lookup + skip gates |
| URL discipline | Enforceable in cert (assert no `https?` until Book Now) |
| Resume | Medium complexity — journey-level intercept; must not disturb frozen phases |
| Analytics | Clear; includes `booking_service_selected` + `booking_resume` |
| Regression risk | Medium — handoff, invitation demotion, resume intercept order vs NIAT |
| Extensibility | High — registry rows |
| Section E | Compatible if chat remains URL + state only |
| Webhooks | `booking_completed` reserved |

**Ship gate checklist**

1. Confirm official booking form base URL + `service` query contract  
2. Cert: no URL before Book Now  
3. Cert: `none` never enters Phase 13  
4. Cert: resume enters Phase 13 without Phase 9–12 replay  
5. Cert: upstream OOO skip  
6. Full Phase 1–12 regression green  
7. Legacy invitation demoted after Phase 13 cert  

---

## 11. Risks and recommendations

| Risk | Recommendation |
|------|----------------|
| Product later wants separate forms | Registry `formMode` escape hatch; default remains single form |
| Resume without stored service | Soft message; never invent `phase12Service` |
| Resume colliding with NIAT / MENU | Intercept order: sticky NIAT → booking_resume (if eligible) → journey |
| Deferred copy leaking URL | Forbidden; cert negative case |
| Phase 12 handoff rename | Prefer stub stage first; handoff-only rename if needed |
| Fake completion | `booking_confirmed` ≠ `booking_completed` |

### Recommended implementation shape (when approved)

```
constants/…BookingOrchestrator.js   # BOOKING_SERVICE_REGISTRY, stages, messages, version
…/BookingOrchestratorCore.js        # resolveDestination, buildOfficialUrl, guardrails
…/BookingOrchestratorParser.js      # book now / later / question / booking_resume
…/BookingOrchestratorEngine.js      # state machine
journey intercept                   # booking_resume (no Phase 9–12 replay)
scripts/phase13ProductionCertification.js
```

**Do not change** Phase 9–12 counseling engines beyond approved stub→orchestrator handoff wiring.

---

## Open decisions (narrowed)

Resolved by architecture review:

- Single form + service params (default)  
- URL only after Book Now  
- Skip on `none`  
- Canonical `BOOKING_SERVICE_REGISTRY`  
- `booking_service_selected` + `booking_resume`  

Still confirm with Product before coding:

1. Exact official **base URL** and query key (`?service=` vs other).  
2. Whether default base is the existing One-on-One form URL or a dedicated booking landing.  
3. Stage id: keep `phase_13_booking_placeholder` vs rename to `phase_13_booking_orchestrator`.

---

## Next step

Await **explicit implementation approval** of this revised plan.  
**Do not implement** until approved.
