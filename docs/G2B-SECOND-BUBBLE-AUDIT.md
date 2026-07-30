# G-2b second-bubble audit

**Status:** Blocks merge of Branch 4 (`fix/g2b-multipart-delivery`) only.
**Date:** 2026-07-30
**Scope:** Every code path that constructs `replyParts` with **2+ TEXT parts**.
**Method:** Static source trace. Row counts in Mongo do **not** prove absence —
a blocked send leaves no row.

Canonical guardrail union used for part-2 scans:
[`constants/flowV3/flowV3Guardrails.js`](../constants/flowV3/flowV3Guardrails.js)
(14-pattern Flow V2 exact union, including `/\bmandatory\b/`).

---

## Delivery context

Today `guidedFlowOrchestrator.js` + `WhatsAppOutboundMessage` unique-on-
`inReplyToInboundId` truncate multi-text-part envelopes to the first bubble
(~1.5 msgs/day historically). Merging Branch 4 re-enables parts 2+.

---

## Path inventory (2+ text parts)

### 1. Core-fork offer — `b2CoreFork.js:143`

```
replyParts: [OFFER_MESSAGE_1, OFFER_MESSAGE_2, OFFER_MESSAGE_3]
+ interactive OFFER_MESSAGE_4 (button body, not a text part)
```

| Part | Content (summary) | URLs / prices / guarantees / factual claims | Guardrail scan | Safe to deliver today? |
|---|---|---|---|---|
| 1 | Mechanical is strong; “most counsellors won’t say out loud” teaser | Soft claim about counsellor behaviour | CLEAN | Yes |
| 2 | “Half the batch ends up writing code on placement day” joke + recruiter claim | **Factual claim** about placement patterns across branches | CLEAN | **FLAG** — anecdotal / outdated risk; no URL/price/guarantee pattern hit, but the claim is strong |
| 3 | CS can work any industry; can’t sign off a bridge; “software door is wider” | Comparative career claim | CLEAN | **FLAG** — same class as part 2 |
| 4 (button) | Nudge toward CSE/AI shortlist | Soft recommendation | CLEAN | Yes (button body) |

### 2. Core-fork honest exit — `b2CoreForkExit.js:109`

```
replyParts: [EXIT_MESSAGE_1, EXIT_MESSAGE_2, EXIT_MESSAGE_3]
```

| Part | Content | Flags | Guardrail | Safe? |
|---|---|---|---|---|
| 1 | Respect pure mechanical | none | CLEAN | Yes |
| 2 | GuideXpert depth is CSE/AI; would be guessing on mechanical | honest scope limit | CLEAN | Yes |
| 3 | Mechanical college checklist (workshop, SolidWorks/ANSYS/CATIA, CORE placement numbers, internships, GATE) | tool names / process advice — not prices or guarantees | CLEAN | Yes — still accurate process advice |

### 3. Core-fork “tell me more” — `b2CoreFork.js:214`

```
replyParts: [TELL_ME_MORE_BUBBLES[field]]   // single part
```

Single-part only — **out of scope** for this audit (listed so it is not missed).

### 4. B5 checklist + B6 permission — `b5Checklist.js:56`

```
replyParts: [checklistBody, ...(permission.replyText ? [permission.replyText] : []), ...]
```

Typical live shape: **checklist body** then **permission question** (often as
interactive button body rather than a second text part). When both are text:

| Part | Content | Flags | Guardrail | Safe? |
|---|---|---|---|---|
| 1 | Fixed checklist (curriculum, internships, coding year-1, placements, faculty, alumni) | generic process claims | CLEAN | Yes |
| 2 | “Would you like me to suggest colleges…” | none | CLEAN | Yes |

### 5. R7 Tier-1 empathy prefix + stage fallthrough — `flowV2Dispatcher.js:615-621`

```
replyParts: [getR7Tier1PrefixLine(), ...(fallthrough.replyText|replyParts)]
```

| Part | Content | Flags | Guardrail | Safe? |
|---|---|---|---|---|
| 1 | Fixed empathy: “That sounds like a lot to carry…” | none | CLEAN | Yes |
| 2+ | Whatever the current stage would have replied | **depends on stage** — can include shortlists, booking invites, URLs | stage-dependent | **CONDITIONAL** — part 2 is not a fixed string; any stage that emits a URL/price/guarantee after an R7-T1 prefix would deliver that as bubble 2 |

This is the closest live shape to “a soft refusal / redirect followed by the
real answer.” Part 1 is empathy (not a guardrail refusal). Part 2 is the
ordinary stage reply. **Review stage replies that can follow R7-T1 before
merging Branch 4**, especially B7 booking URL and any predictor/shortlist
bubbles.

### 6. Non-distress interrupt confirmation + resumed stage — `flowV2Dispatcher.js:563`

```
replyParts: [interruptResult.confirmation, ...(resumed.replyText|replyParts)]
```

Confirmations (from `nonDistressInterrupts.js`) are short fit-line strings
(“Building things — coding and software is the strongest starting fit.”).
CLEAN under the union. Part 2+ is again the resumed stage reply —
**CONDITIONAL** same as §5.

### 7. Awaiting-entry drain combiner — `flowV2Dispatcher.js:195-199` / `flowV2NodeUtils.js`

```
prefixes (prior replyText/replyParts) + next entry result
```

Produces 2+ text parts whenever an `*_awaiting_entry` stage drains into the
next entry in the same turn (e.g. B5→B6, B7→B8). Part contents are the
individual node strings already audited above / in those nodes.

### 8. Career counselling response optimizer — `careerCounsellingV2ResponseOptimizer.js:184-210`

Multi `replyParts` only when `allowExtendedPrediction` / `skipLineCap` /
extended mode is on. Normal replies collapse to a **single** part. Extended
prediction blocks can split on blank lines / oversized blocks — content is
dynamic (prediction text), not a fixed second bubble. **FLAG** as a class:
any extended prediction part-2 that contains a URL, price, or guarantee-
adjacent phrase would ship after Branch 4. Run those live strings through
the union at send time (already required by the frozen envelope) — do not
reason from absent outbound rows.

### 9. B9 fit / honest-pass — `b9Fit.js`

Uses `replyParts: [singleString]` — **single part**, out of scope.

---

## Guardrail violations found on fixed part-2 strings

**None.** Every fixed part-2 / part-3 string listed above returned CLEAN under
the 14-pattern union.

That does **not** mean they are product-safe. Two classes remain:

1. **Strong factual claims without a pattern hit** (core-fork offer parts 2–3).
2. **Dynamic part-2** (R7-T1 prefix, interrupt resume, extended prediction) whose
   content is the stage reply — including booking URLs after B7.

---

## Verdict for Branch 4

| Class | Recommendation |
|---|---|
| Core-fork exit (3 parts) | Safe to re-enable |
| B5 checklist + B6 permission | Safe to re-enable |
| Core-fork offer (3 parts) | Re-enable only after product signs off on the placement/industry claims in parts 2–3, or softens the copy |
| R7-T1 + stage fallthrough | Re-enable, but confirm B7 booking-URL replies are acceptable as bubble 2 after an empathy prefix |
| Interrupt confirmation + resume | Same as R7-T1 |
| Extended prediction splits | Rely on send-time guardrail enforcement; do not merge without it |

**Decision recorded:** do **not** merge Branch 4 until product signs the
core-fork offer claims and confirms R7-T1 → booking-URL ordering is intentional.

---

## What this audit deliberately did not do

- Did not query production outbound rows (absence ≠ non-emission).
- Did not run the migration `--execute`.
- Did not send a staging multi-part to a phone.
- Did not edit `flowV2/**` or `careerCounselling/**`.

---

## B-1 — URL as a non-first text part (findings only)

**Question:** After Branch 4 re-enables parts 2+, which paths can put a
booking/website URL in `replyParts[n]` for `n ≥ 1`? For each: does it pass
Phase 13 `allowUrl` / `buildUrlShareReply`, advance booking status, and use
`BOOKING_SERVICE_REGISTRY`?

### Canonical Phase 13 path (reference — normally first/only part)

| Check | Result |
|---|---|
| Emitter | `shareOfficialUrl` → `buildUrlShareReply` in `careerCounsellingV2BookingOrchestratorEngine.js:95-128` |
| `allowUrl` | **Yes** — `assertPhase13Guardrails(reply, { allowUrl: true })` inside `buildUrlShareReply` (`careerCounsellingV2BookingOrchestratorCore.js:107-115`) |
| Registry | **Yes** — URL from `BOOKING_SERVICE_REGISTRY` / `resolveBookingDestination` |
| Status | Sets `phase13UrlShared` / `phase13Outcome: 'url_shared'` (not Flow V2 `bookingStatus`) |
| Multipart? | Returns a single `reply` string with `keepIntact` / `skipLineCap`. Optimizer collapses normal replies to one part. **No fixed path** makes this Phase 13 URL a non-first text part. |

### Flow V2 URL emitters (always single `replyText` at the node)

| Emitter | File:line | Advances `bookingStatus`? | `allowUrl` / `buildUrlShareReply`? | `BOOKING_SERVICE_REGISTRY`? |
|---|---|---|---|---|
| Node 0 slot → website handoff | `node0Override.js:381-396` (`BOOKING_URL` / `buildBookingUrlLine` at `:62-72`) | **Yes** → `link_sent` | **No** | **No** — hardcoded `https://www.guidexpert.co.in/one-on-one-session` |
| B7 slot → link | `b7Book.js:233-243` via `buildB7BookingLinkMessage` → `buildBookingUrlLine()` | **Yes** → `link_sent` | **No** | **No** — same helper |
| B7 NIAT interest → link | `b7Book.js:200-207` | **Yes** → `link_sent` | **No** | **No** |

Alone, these set `replyParts: null` and put the URL in `replyText` → orchestrator
sends them as **partIndex 0**. Not a non-first-part issue by themselves.

### Combiners that can promote a Flow V2 URL into part 2+

| Combiner | File:line | When URL becomes non-first | `allowUrl` / registry? | Live defect? |
|---|---|---|---|---|
| R7 Tier-1 empathy prefix + stage fallthrough | `flowV2Dispatcher.js:613-625` | Student on `b7_awaiting_slot` / `b7_awaiting_reply` (NIAT link path) / other B7 stage classifies as R7-T1 **and** fallthrough returns a link `replyText`. Node 0 slot stage short-circuits earlier (`:478-479`) so **Node 0 URL is not** R7-prefixed. | **No** — never enters Phase 13 guards | **YES — live V2 defect (multipart-sensitive).** Empathy bubble 1 + booking URL bubble 2 after Branch 4. Needs a **separate hotfix** (e.g. suppress R7-T1 prefix when fallthrough contains a URL / is a link_sent handoff), not a G-2b copy edit. |
| Non-distress interrupt confirm + resume | `flowV2Dispatcher.js:547-565` | Pending I-1/I-2 interrupt resolved while `interruptedStage` was a B7 link-emitting stage; resume fallthrough returns URL → `[confirmation, url, …]` | **No** | **YES — same class.** Separate hotfix: do not prefix URL handoffs, or force URL to part 0 only. |
| `drainAwaitingEntryStages` / `combineNodeResults` | `flowV2Dispatcher.js:176-199`, `flowV2NodeUtils.js:11` | Only if an `*_awaiting_entry` drain’s **next** entry result itself contains a URL. B7 entry is invite CTA (no URL). **No current drain emits a URL as part 2.** | n/a | No |
| B5 checklist combiner | `b5Checklist.js:56` | Checklist + permission — **no URL** | n/a | No |
| Core-fork / exit multi-text | `b2CoreFork.js:143`, `b2CoreForkExit.js:109` | Parts 2–3 are claims, **no URL** | n/a | No (see B-2) |

### Other URL-ish surfaces (out of B-1 booking scope, listed for completeness)

- `b7TwoModels.js` Cloudinary **image** URL — media part, not a student booking text URL.
- Phase 11 / NIAT `ONE_ON_ONE_SESSION_URL` constants — journey engines emit their own single replies; not Flow V2 `replyParts` combiners.
- Lead/demo support register links — outside Flow V2 multipart inventory.

### B-1 verdict

1. Phase 13 URL share is gated correctly (`allowUrl` + registry + `phase13UrlShared`) and is not a non-first-part emitter today.
2. Flow V2 booking URLs **always bypass** `allowUrl` / `buildUrlShareReply` / `BOOKING_SERVICE_REGISTRY` (hardcoded Node 0 line). That is an existing V2/Phase-13 ownership split — flag for product, not introduced by G-2b.
3. **Hotfix-worthy after Branch 4:** R7-T1 prefix and interrupt-resume combiners can deliver the Flow V2 booking URL as **text part 2+** with no Phase 13 guard and no registry. Fix outside this PR; do not merge G-2b relying on “URL only appears first.”

---

## B-2 — Core-fork offer parts 2–3 claim table (findings only)

Source: [`b2CoreFork.js`](../services/chatbot/flowV2/nodes/b2CoreFork.js) `OFFER_MESSAGE_2` / `OFFER_MESSAGE_3` (emitted as `replyParts[1]` / `replyParts[2]` at `:143`).
Cross-ref: [`careerCounsellingFlowV2BusinessDefaults.js`](../constants/careerCounsellingFlowV2BusinessDefaults.js) (`defaultApplied: true` items).

| # | Claim (verbatim excerpt) | File:line | Classification | Business-defaults cross-ref |
|---|---|---|---|---|
| 1 | “whatever branch you join, half the batch ends up writing code on placement day anyway” / “largely true” | `b2CoreFork.js:35-36` | Strong placement-pattern factual claim (anecdotal) | **No** `defaultApplied` item owns this claim. Not covered by `NIAT_*`, `CAT-*`, or `VARIANT_B_*`. |
| 2 | “the big recruiters hire across branches for software roles” | `b2CoreFork.js:36` | Labour-market factual claim | **No** matching default. Adjacent CSE-door framing is product copy, not `NIAT_CSE_ONLY` (that default only constrains NIAT branch claims). |
| 3 | “A CS student can work in almost any INDUSTRY — automotive, aerospace, healthcare, finance — because all of them run on software now” | `b2CoreFork.js:37-38` | Broad industry-access claim | **No** matching default. `ENGINEERING_TECH_SCOPE_ONLY` limits chatbot scope to eng/tech journeys; it does **not** authorize or deny this industry list. |
| 4 | “What they can’t do is sign off a bridge” | `b2CoreFork.js:38` | Licensing / role-boundary claim (rhetorical) | **No** matching default. |
| 5 | “it’s not that core is weaker. It’s that the software door is wider, and it opens from both sides.” | `b2CoreFork.js:38` | Comparative career framing | Thematically near `VARIANT_B_PURE_CORE_EXIT` / `CORE_BRANCH_CATALOG_UNKNOWN` (`defaultApplied: true`), which govern the **F2 pure-core exit** path — **not** these offer bubbles. Offer path still nudges CSE/AI shortlist without those defaults gating the wording. |

### Adjacent copy (not parts 2–3, for cross-ref only)

| Claim site | File:line | Defaults |
|---|---|---|
| `OFFER_MESSAGE_4` CSE/AI door nudge; comment cites `NIAT_NO_ROBOTICS_CLAIM` + `CORE-1` Variant B | `b2CoreFork.js:39-42` | `NIAT_NO_ROBOTICS_CLAIM.defaultApplied === true`; `VARIANT_B_PURE_CORE_EXIT.defaultApplied === true` (exit path). No robotics claim in the string. |
| `PARENT_VARIANT_TEXT` “software roles hire in larger numbers and across more industries” | `b2CoreFork.js:44-45` | Same class as claims 2–5; **no** dedicated default. |

### B-2 verdict

Parts 2–3 ship **five factual / comparative claims** with **zero** `defaultApplied: true` owners in `careerCounsellingFlowV2BusinessDefaults.js`. Product sign-off (or softening) remains the Branch 4 merge gate already recorded above. **No copy rewrites in this audit.**
