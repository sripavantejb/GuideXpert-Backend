# Phase 10 — Future Path Vision (Implementation Plan)

**Status:** IMPLEMENTED — see [PHASE-10-FUTURE-PATH-VISION.md](./PHASE-10-FUTURE-PATH-VISION.md)  
**Plan approved and executed.** Do not implement Phase 11 until approved.

This document remains the design contract. Implementation details and cert results are in the architecture and readiness docs.

---

## 1. Updated business objective

Phase 10 – **Future Path Vision** helps the student **visualize outcomes of the path already recommended**, so they feel clearer and more confident — not so they are persuaded by promotional language.

**Student outcomes (confidence, not conversion):**

- “I can picture what learning and growth could look like on this path.”
- “This future connects to my goals and how I like to learn.”
- “I understand possibilities and preparation — not guarantees.”

**Official contract — Phase 10 exists to:**

1. Strengthen confidence in the recommendation already made (Phases 5 / 9).
2. Help the student imagine their future learning journey.
3. Reinforce that the recommendation aligns with their goals and learning style.

**Phase 10 must not:**

- Recommend colleges again  
- Compare colleges again  
- Resolve objections  
- Recommend counseling / introduce counsellors  
- Start or hint at booking  
- Perform human handoff  
- Repeat Phase 9 synthesis, rankings, or trade-off lists  

---

## 2. Updated architecture

```
phase_9_personalized_recommendation   [FROZEN v1.1.0]
        ↓  continue only (handoff target change)
phase_10_future_path_vision           [NEW — deterministic]
        ↓  continue only
counseling_invitation                 [EXISTING — unchanged]
        ↓
conversation_complete
```

### Design principles

| Principle | Implication |
|-----------|-------------|
| One responsibility | Confidence + future learning vision only |
| Extend, don’t rewrite | New stage/engine/constants only |
| Phase 9 freeze | No synthesis/ranking/copy changes without freeze waiver |
| Invitation untouched | No CTA, counsellor pitch, or booking language in Phase 10 |
| Deterministic v1 | Template + profile fields only — **no LLM** |
| No new colleges | May name Phase 9 Best Match as a path anchor only |
| WhatsApp quality | 2–3 short bubbles; Response Optimizer |

### Allowed Phase 9 delta (implementation-time, separate freeze waiver)

**Only** change the Phase 9 `continue` handoff target from `startCounselingInvitation` → `startFuturePathVision`.

Forbidden without waiver: Phase 9 ranking, synthesis, Comparison Insight, analytics semantics, soft-transition meaning beyond pointing to Phase 10.

---

## 3. Updated conversation flow

1. **Entry** — Student continues from Phase 9 (`yes` / `ok` / `continue`).
2. **Path anchor (≤1 short message)** — Light nod to Phase 9 Best Match **as the path already chosen**, not a re-recommendation. Example pattern: “On the path toward *{Best Match}*…”
3. **Future learning snapshot (1–2 short messages)** — Personalized possibilities: early skills, projects/practice style from learning prefs, direction from career goal / course. Possibility language only.
4. **Exit** — Brief continue prompt (“Reply *Continue* when ready.”). **No** counsellor, booking, or CTA bridge.
5. **Next stage** — Existing counseling invitation owns optional human support and website CTA.

### Edge cases

| Case | Behavior |
|------|----------|
| Strong profile + Phase 9 Best Match | Fully personalized vision; Best Match as path anchor only |
| Limited / empty shortlist | Profile-only vision (goal, course, learning style); still complete Phase 10 briefly — do **not** skip to invitation mid-phase solely to upsell counseling |
| Empty profile | Minimal honest framing + continue; no invented goals or colleges |
| Student asks college facts / rankings | Deflect: already covered earlier; stay in vision or continue — no new facts |
| Student raises objections | Do **not** resolve (Phase 11); acknowledge briefly + continue or stay with vision-only canned reply |
| MENU / breakout | Existing guided-flow interrupt |

---

## 4. State machine

**Proposed stage:** `phase_10_future_path_vision`  
**Proposed steps (minimal):**

| Step | Purpose |
|------|---------|
| `vision_present` | Deliver 2–3 bubble vision (may collapse to single turn) |
| `vision_followup` | Optional short Q&A (vision-only); await continue |

| From | Trigger | To |
|------|---------|-----|
| `phase_9_personalized_recommendation` / `phase9_followup` | continue | `phase_10_future_path_vision` |
| `phase_10_future_path_vision` / `vision_followup` | continue | `counseling_invitation` |
| `phase_10_future_path_vision` | vision-scoped question | stay |
| Any | MENU / cancel | existing interrupt → main menu |

No extra sub-phases. No parallel invitation logic.

---

## 5. Responsibility matrix (Phase 10)

| Dimension | Definition |
|-----------|------------|
| **Responsibility** | Strengthen confidence; imagine future learning journey; reinforce goal alignment |
| **Inputs** | `careerGoal`, `preferredCourse`, learning style / prefs, interests (where stored), Phase 9 Best Match (`phase9Recommendations[0]` or equivalent), light profile context |
| **Outputs** | Short WhatsApp vision messages; `phase10_*` analytics; profile flags e.g. `futurePathVisionPresented` |
| **Prohibited** | Re-recommend / re-compare / objections / counseling pitch / booking / handoff / Phase 9 repeat / guarantees / new colleges / LLM |

---

## 6. Guardrails (mandatory)

Phase 10 copy and logic **must never**:

- Guarantee placements, salaries, packages, or job outcomes  
- Guarantee internships or project opportunities as certain  
- Guarantee admissions or seat confirmation  
- Use exaggerated or promotional claims (“best college”, “assured success”)  
- Invent unsupported college facts, rankings, fees, or statistics  
- Fabricate employer names, placement % , or package numbers  

**Required stance:** possibilities, preparation, and opportunities — e.g. “you *could* build…”, “students often prepare by…”, “this path *can support*…” — never “you will get…”.

Certification must include negative tests for these phrases/patterns.

---

## 7. Future phase boundaries (no overlap)

| Phase | Responsibility | Inputs | Outputs | Prohibited |
|-------|----------------|--------|---------|------------|
| **10 — Future Path Vision** | Confidence + future learning visualization aligned to existing recommendation | Profile + Phase 9 Best Match | Vision messages | Recommend/compare colleges; objections; counseling CTA; booking; handoff; guarantees |
| **11 — Dynamic Objection Handling** | Address new/reopened decision concerns after vision | Active concerns + profile evidence | Concern answers + readiness updates | Vision essays; counseling sales; booking; changing Phase 5/9 ranks |
| **12 — Personalized Counseling Recommendation** | Explain *why* an optional human session may help *this* student | Readiness, gaps, profile | Counseling value framing (no book) | Vision replay; objection engine; creating bookings; WhatsApp book |
| **13 — Website Counseling Booking** | Direct to Section E website booking only | Booking URL + invitation state | Website CTA messages | CRM writes from chat; WhatsApp booking; changing ranks; vision/objections |
| **14 — Human Counselor Handoff** | Transfer to human copilot / handoff protocols | Handoff intent + conversation context | Handoff state + agent queue | Fake confirmations; inventing bookings; re-running Phase 9–12 logic |

**Phase 10 must not absorb any Phase 11–14 duty.**  
**Existing Phase 8 `counseling_invitation` remains the pre-Phase-12/13 CTA owner until those phases are specified; Phase 10 does not duplicate it.**

---

## 8. Personalization contract

**Required signals (use when present):**

- Career goal  
- Preferred course  
- Learning style / learning preferences  
- Interests (from profile / conversation context fields already stored)  
- Phase 9 Best Match (path anchor only)

**Rules:**

- Prefer specific references over generic motivation whenever any of the above exist.  
- If recommendation data is thin: personalize from profile only — still no generic pep-talk walls.  
- Do **not** re-list Strong Alternative / Good Backup or Phase 9 trade-offs.  
- Do **not** invent interests or goals not on the profile.

---

## 9. Content budget

| Limit | Rule |
|-------|------|
| Messages | **Maximum 2–3** WhatsApp bubbles per Phase 10 turn |
| Ideas | **One idea per message** |
| Length | Short conversational lines (align with Global Conversation Quality Pass) |
| Lists | No full recommendation re-list |
| Delivery | Response Optimizer + multi-bubble when split |

---

## 10. Freeze compatibility

Phase 10 may change the journey chain to:

```
Phase 9 → Phase 10 → Counseling Invitation
```

Phase 10 **must not** modify without an explicit freeze waiver:

- Phase 9 synthesis / ranking / college set  
- Phase 9 Comparison Insight semantics  
- Invitation engine behavior / Section E `bookingPageUrl()` usage  
- Phases 1–8 counseling logic  

Cursor rule reference: `.cursor/rules/phase-9-production-baseline.mdc`

---

## 11. Deterministic v1

- Phase 10 **v1 is deterministic only** (constants + profile templates + parsers).  
- **No LLM** in production design for v1.  
- Any future generative enhancement is **out of scope** and requires a new approved design — not a hidden flag in this plan.

---

## 12. Certification plan

Add `scripts/phase10ProductionCertification.js` (local deterministic) when implementing.

| ID | Focus |
|----|--------|
| P10-01 | Enters Phase 10 from Phase 9 continue |
| P10-02 | Does not alter Phase 5 / Phase 9 order or tiers |
| P10-03 | Does not introduce colleges outside Phase 9 shortlist names |
| P10-04 | Continues to invitation; Section E URL appears **only after** Phase 10 exit |
| P10-05 | Question stay-in-stage (vision-scoped) |
| P10-06 | Limited shortlist → profile-only vision still completes Phase 10 |
| P10-07 | Content budget: ≤3 bubbles / no full shortlist dump |
| P10-08 | **Negative:** no booking / counsellor / WhatsApp book language |
| P10-09 | **Negative:** no comparison / re-rank language |
| P10-10 | **Negative:** no guarantee patterns (placement/salary/admission/internship guaranteed) |
| P10-11 | **Negative:** no objection-resolution flow (Phase 11 territory) |
| P10-12 | **Negative:** no unsupported stats / fabricated facts |
| P10-13 | Perf budget for vision render |

Gate: 100% local pass before any live WhatsApp smoke.

---

## 13. Regression strategy

Before merge of any future implementation:

1. `node --test test/careerCounsellingJourney.test.js` — Phases 1–9 green; Phase 9 ranking tests unchanged.  
2. `node scripts/phase9ProductionCertification.js` — **13/13** remains PASS.  
3. Phase 10 cert suite — all positive + negative cases.  
4. Invitation CTA tests — still pass after Phase 10 insertion.  
5. No edits under `services/chatbot/bookingContext/**`.  
6. Invented-college guards (NIAT/Scaler/Newton) still hold.  

---

## 14. Production readiness assessment (plan stage)

| Area | Assessment |
|------|------------|
| Architecture slot | Ready (9 → 10 → invitation) |
| Single responsibility | Ready (after this revision) |
| Guardrails | Specified — must be encoded in copy + cert |
| Freeze compatibility | Ready (handoff-only Phase 9 delta) |
| Future phases 11–14 | Boundaries defined — no overlap by contract |
| Deterministic v1 | Ready |
| Content / WhatsApp quality | Budget defined |
| Implementation risk | **Low–medium** — main risk is copy drift into counselling/guarantees; mitigated by cert negatives |

**Plan readiness:** Suitable for approval.  
**Code readiness:** **Not started** — wait for explicit approval.

---

## 15. Explicit non-goals

- No Phase 10 code until approval of this revised plan  
- No LLM in v1  
- No counseling / booking / handoff content  
- No Phase 9 ranking or synthesis changes beyond approved handoff target  
- No Section E / WhatsApp booking changes  
- No Phase 11–14 implementation in this milestone  

---

## Next

Phase 11 plan only: [PHASE-11-IMPLEMENTATION-PLAN.md](./PHASE-11-IMPLEMENTATION-PLAN.md)  
**Do not implement Phase 11 until approved.**

## Freeze

Phase 10 is frozen — [PHASE-10-PRODUCTION-BASELINE.md](./PHASE-10-PRODUCTION-BASELINE.md)  
Cursor rule: `.cursor/rules/phase-10-production-baseline.mdc`
