# Flow V3 — Spec Conformance Review

**Date:** 2026-07-31 · **Reviewer:** agent session (post-incident remediation, Part 3)
**Spec:** `~/Downloads/FLOW_V3_LLM_ARCHITECTURE (1).md` (Jul 30 16:19 — newer of the two copies;
they differ only by the added `LEAD_PROFILE_CONTRACT.md` cross-reference in §5.1)
**Gate reference:** `CURSOR_BUILD_PROMPT.md` **does not exist anywhere on this machine** —
M-2/M-3/M-4 are assessed from §15 of the architecture spec, which defines the same gates.
**Code under review:** as of `main @ c5fe0f7`. V3 is disabled in production throughout.

## Verdict up front

The implementation is a **faithful scaffold with hollow enforcement**. The pipeline shape,
budgets, and file layout match the spec closely — but three of the spec's core safety
mechanisms are stubbed or missing, and one pipeline step is absent entirely:

| # | Severity | Finding |
|---|----------|---------|
| F-1 | CRITICAL | V-2 grounding verification is a no-op — cited ids are never checked against tool results |
| F-2 | CRITICAL | Fallback Tier A never uses Flow V2 beat copy; `slot.askable \|\| …` boolean bug produced the live "true" reply |
| F-3 | HIGH | V-8 beat discipline is an explicit no-op (`void targets`) — out-of-order asks are never blocked |
| F-4 | HIGH | §3 step 12 `applyProfilePatch(envelope.profile_patch)` is never called — the LLM's patch is silently dropped |
| F-5 | HIGH | §3 steps 6–7 (deterministic slot extraction + post-merge AP-OC-male re-check) absent from the pipeline |
| F-6 | MEDIUM | Prompt is missing spec §8 sections 6–8 (beat-by-beat intent, honest exits, worked transcripts) |
| F-7 | MEDIUM | M-3 golden set lacks a prompt-injection case; M-4 replay covers deterministic components only, no transcripts |
| F-8 | LOW | §9.1 mitigations (speculative prefetch, ack bubble, tool cache) not implemented; V-7 clamp not logged |

**Recommendation:** V3 must not be re-enabled until F-1 through F-5 are fixed and golden-tested.
F-1/F-2/F-3 mean the system's honesty guarantees currently live only in the prompt — exactly the
"prompt promises what code doesn't verify" failure mode §0.1 calls a defect, not a variant.

---

## 1. `llm/llmLoop.js` vs spec §3 step 9–10, §9.1

**Conforms**

- 12 s wall budget, max 3 tool iterations, per-call timeout `min(4000, remaining)` — matches the
  §9.1 budget table exactly (lines 14–15, 77).
- Final envelope forced with `response_format: json_object` when the assistant answered in prose
  (lines 124–142); one repair retry on malformed JSON (§3 step 10) with the violation echoed back
  (lines 144–164).
- Wall exhaustion returns `ok:false / wall_budget` → fallback ladder, per §7.3.

**Deviates / missing**

- **Silent tool-args swallow (Pattern C, already logged for Part 2):** lines 88–93 parse
  `tc.function.arguments` and on failure execute the tool with `{}`. The spec's tool contract
  (§6) expects a `{failed}` result fed back to the model, not a ghost invocation with empty args.
- **Iteration-cap dead end:** hitting 3 tool rounds returns `tool_iteration_cap` without ever
  requesting a final envelope (lines 178–185). Spec §3 step 9 reads "max 3 tool iterations" then
  a final envelope; the safer reading is to force the envelope call once the cap is hit rather
  than burn the turn. Minor, defensible either way — flagging for an explicit decision.
- **No §9.1 mitigations:** no speculative predictor prefetch, no >4 s ack bubble, no 60 s/30 s
  tool cache. Only the prompt file itself is cached (`promptLoader.js`, whose cache identifiers
  are corrupted to `n` / `clearPromptn` — functional but should be cleaned up).
- `promptLoader.js` also swallows a prompts-directory read failure into an empty list
  (Part 2 Pattern C item) — a deploy that drops `prompts/` would degrade silently.

## 2. `validate/validateEnvelope.js` vs spec §7.2

| Check | Spec | Implementation | Status |
|-------|------|----------------|--------|
| V-1 schema | parse, known part types, required fields | `parseEnvelope.js` + intent/parts checks | **Conforms** |
| V-2 grounding | every college/number/price/slot must appear in a *cited tool result*; unmatched → BLOCK; reuse `aiGuardrailService` patterns | only "grounding array non-empty when text matches a college/numeric regex". The per-id verification loop (lines 83–87) is an **empty body** — any fabricated grounding id passes. Homemade regexes instead of the mandated reused patterns | **NO-OP — CRITICAL (F-1)** |
| V-3 guardrails | GUARANTEE_FORBIDDEN ∪ URL_FORBIDDEN on every body and title | GUARANTEE_FORBIDDEN applied to bodies, captions, button/row titles. URL_FORBIDDEN is **not** part of V-3 (URLs caught only by V-5's single regex) | **Partial** |
| V-4 catalog purity | no list mixing curated + predictor rows | implemented on `catalog`/`tag` row fields | **Conforms** |
| V-5 URL gating | URL only if `booking_url_slot` set AND `create_booking_link` ran AND bookingStatus advanced | first two conditions enforced (lines 108–115); the bookingStatus-advanced condition is not checked | **Partial** |
| V-6 disclosure | `show_shortlist` requires the disclosure line; absence → BLOCK | blocks when neither `editorial` nor "not a guaranteed admission" appears. Loose regex, and the returned `disclosureLine` is never injected by any caller | **Partial** |
| V-7 shape clamp | clamp + log | clamps buttons ≤3, rows ≤10, title lengths; **body length not capped, clamp not logged** (verdict string only) | **Partial** |
| V-8 beat discipline | `ask_slot` must target `next_question()`'s slot; out-of-order → BLOCK | lines 151–156: computes targets then `void targets;` — **deliberate no-op** | **NOT IMPLEMENTED — HIGH (F-3)** |

The practical consequence of F-1 + F-3 together: a model reply that invents a college, cites a
made-up grounding id, and asks an out-of-sequence question passes validation today. The only
remaining defenses are the prompt (soft) and GUARANTEE_FORBIDDEN (narrow).

## 3. `validate/fallbackLadder.js` vs spec §7.3

- **Tier A — CRITICAL non-conformance (F-2).** Spec: "nextSlot() gives the slot; emit the Flow V2
  hardcoded copy for that beat… the 'unused' V2 node copy becomes the safety net." The
  implementation never touches V2 node copy. It emits `slot.askable || <generic template>` —
  and `askable` is a **boolean** (`flowV3NextSlot.js` line 62: `def.askable === true`), so any
  askable slot short-circuits to the literal string `"true"`. This is the confirmed root cause of
  the `"true"` outbound observed live on Jul 30 (see `docs/INCIDENT-V3-LIVE-WINDOW.md`). The
  entire stated reason for keeping Flow V2 copy alive is unimplemented.
- **Tier B:** holding copy + escalate intent conform. But the reachability logic differs from the
  ladder: Tier C is effectively **dead code** (any `slot == null || slot.done` already routes to
  Tier B), and Tier C's spec obligations — log at ERROR, page on-call above a rate threshold —
  don't exist. No fallback-rate metric is emitted anywhere, though §9 names it the primary SLO.
- `nextFlowV3Slot()` failure is swallowed (`catch { slot = null }`) — Part 2 Pattern C item; a
  broken slot engine silently degrades every fallback to Tier B.

## 4. `prompts/system_prompt.v1.md` vs spec §8

Present and conforming: §1 identity/voice, §2 hard rules (all six spec absolutes are there,
plus grounding, URL-injection, and English-only rules), §3 flow contract (`next_question`
before asking), §4 tool policy (brief), §5 envelope format with the exact §7.1 schema and
WhatsApp shape limits.

Missing (F-6):

- **§6 beat-by-beat intent** — nothing tells the model what each `BEAT_ORDER` beat is *for* or
  what a good ask sounds like. With V-8 also unimplemented, beat discipline currently has **no
  enforcement at either layer**.
- **§7 honest exits** — no core-mechanical checklist exit, nothing-fits pass, or out-of-scope
  refusal guidance, despite `honest_exit` being a declared envelope intent.
- **§8 worked transcripts** — zero gold examples. The spec requires 3–4; their absence is
  consistent with the weak envelope discipline observed in the live window.
- `prompts/TOOL_CONTRACT.md` exists but is a 1,020-byte skeleton — not yet the "machine-readable
  single source of truth for both the prompt and the broker" the spec describes.

Also note the provenance finding from the incident review stands: this prompt was authored
inside an agent session (commit `bc9f322`), not reviewed by product, though its §2 content does
match the spec's hard-rule list.

## 5. Pipeline-level deviations found in passing (dispatcher, context for the above)

`flowV3Dispatcher.js` implements §3 steps 1–5, 8–11, 13–14 recognizably. Missing:

- **Step 6** — `extractFlowV3Slots(text, profile)` deterministic extraction + merge before the
  LLM: absent. The only slot writes are LLM-initiated `update_lead_profile` tool calls.
- **Step 7** — post-merge `isApOcMaleBlocked` re-check: cannot exist without step 6; the gate
  chain checks demographics once, pre-LLM, against the loaded profile only. The spec calls this
  re-check "why it re-runs post-merge in V2: the condition can become true mid-fill."
- **Step 12 (F-4)** — `applyProfilePatch(envelope.profile_patch)` is never called by the
  dispatcher or by `processCareerCounsellingFlowV3Turn` in `guidedFlowProcessors.js`. The parser
  defaults the field, the validator reads it, and then it is discarded; the turn log even writes
  `profileAfter: profile` (identical to before). The CAS write path
  (`flowV3ProfileStore.applyProfilePatch`) exists and is tested — it is simply not wired in.
- Step 14's "LOG TURN (async)" is implemented as a floating un-awaited promise — technically what
  the spec says, but the incident proved it loses writes on serverless freeze (Part 2 Pattern A
  fix: await it or use `waitUntil`).

## 6. M-gate assessment (§15)

| Gate | Criterion | Status |
|------|-----------|--------|
| M-2 Pipeline | a turn completes end-to-end in a test harness | **MET** — `test/flowV3/pipeline.test.js` runs full turns against a mock provider, including gate-termination and fallback paths |
| M-3 Safety | golden adversarial set (injection, crisis, AP-OC-male, invented-college bait) 100% blocked | **PARTIAL** — fixtures cover crisis, AP-OC-male, grounding-block, beat-order. **No prompt-injection golden.** The invented-college case (`grounding-block.json`) tests only the weakened V-2 (empty-grounding check), and `beat-order.json` exercises the fallback ladder, not V-8 — which is unimplemented |
| M-4 Prompt v1 | replay reproduces all golden transcripts | **NOT MET** — `goldenReplay.test.js` replays deterministic gates/validators only. There are no gold transcripts to reproduce (the prompt itself lacks §8 worked transcripts), and no LLM-replay harness against the pinned prompt |

## 7. Recommended remediation order (feeds Part 2+)

1. **F-2** Fallback Tier A → real Flow V2 beat copy lookup; kill the `askable ||` truthy bug
   (regression test: boolean `askable` must never render).
2. **F-1** Implement real V-2: extract claims, verify every cited grounding id against actual
   tool-result ids, reuse `aiGuardrailService` claim patterns; unmatched → BLOCK.
3. **F-4** Wire step 12: validated `envelope.profile_patch` → `applyProfilePatch` (CAS), with
   `profileAfter` reflecting the merge in the turn log.
4. **F-3** Implement V-8 against `turnContext.nextSlot`; BLOCK out-of-order `ask_slot`.
5. **F-5** Add step 6 extraction + step 7 post-merge demographic re-check.
6. **F-6/F-7** Prompt §6–§8 sections, injection golden, transcript replay harness — gates for any
   future re-enable decision.
7. **F-8** Latency mitigations and clamp logging — before any canary, per §9.1.
