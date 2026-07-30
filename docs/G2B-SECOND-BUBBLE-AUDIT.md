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
