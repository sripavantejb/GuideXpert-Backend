# Flow V3 Remediation Report (F-1 … F-9)

**Date:** 2026-07-31
**Scope:** every finding from the silent-failure sweep (Part 2) and the spec-conformance review
(Part 3) of `docs/FLOW-V3-SPEC-CONFORMANCE-REVIEW.md`.
**Status:** all nine findings fixed, delivered as six stacked PRs. **V3 remains disabled in
production** — nothing in this remediation re-enables it.

## Process gate

Branch protection on `main` was verified before any code changed:

- `GET /branches/main` → `protected: true`, `enforcement_level: everyone` (rules apply to admins)
- Empirical confirmation: PR #14 reports `mergeable: true` + `mergeable_state: blocked` —
  no conflicts, merge refused pending an approving review. The review requirement is enforced
  in practice, including against the token that created the PR.

All work was done on feature branches and routed through PRs. No direct pushes to `main`.

## Fixes delivered (stacked, merge in order)

| # | Finding | Severity | PR | Branch |
|---|---------|----------|----|--------|
| F-1 + F-7 | S-1 AP-OC-male re-check missing post-merge; no deterministic extraction pre-pass (§3 steps 6–7) | CRITICAL | [#14](https://github.com/sripavantejb/GuideXpert-Backend/pull/14) | `fix/flow-v3-f1-f7-postmerge-demographic` |
| F-2 | V-2 grounding verification was an empty loop — fabricated citations passed | CRITICAL | [#15](https://github.com/sripavantejb/GuideXpert-Backend/pull/15) | `fix/flow-v3-f2-grounding-verification` |
| F-3 + F-9 | Turn log never written (floating promise + swallowed `{ok:false}`); silent-failure sweep | HIGH | [#16](https://github.com/sripavantejb/GuideXpert-Backend/pull/16) | `fix/flow-v3-f3-f9-silent-failures` |
| F-4 + F-5 | Fallback Tier A emitted `"true"` / invented copy; non-string bodies coerced into student text | HIGH / MEDIUM | [#17](https://github.com/sripavantejb/GuideXpert-Backend/pull/17) | `fix/flow-v3-f4-f5-fallback-and-types` |
| F-6 | `envelope.profile_patch` parsed then dropped — never filtered or written | HIGH | [#18](https://github.com/sripavantejb/GuideXpert-Backend/pull/18) | `fix/flow-v3-f6-profile-patch` |
| F-8 | V-8 beat discipline was `void targets` — never blocked | MEDIUM | this PR | `fix/flow-v3-f8-beat-discipline` |

### F-1 + F-7 — deterministic extraction + post-merge S-1 re-check

`flowV3Dispatcher.js` now runs `flowV2SlotExtractor` (read-only reuse of the frozen V2 module)
after the crisis/opt-out/scope gates and before the LLM, merges via `mergeFlowV3Profile`, and
re-runs the demographic gate against the **merged** profile. A student whose category and gender
arrive on different turns is blocked the moment the condition becomes true — verbatim
`r4pPredictor` refusal, human route, zero LLM and zero predictor calls. The live processor
persists the extracted patch through the CAS store (channel `extractor`, authoritative
`extracted` capture meta), so the durable profile matches what the turn was gated on.

### F-2 — real V-2 grounding verification

Every id in `envelope.grounding` must resolve to an actual tool result from this turn; every
college mention and numeric/price/placement claim must trace to a **cited** result. Unmatched
→ BLOCK → regenerate-once → fallback ladder. Claims reuse `aiGuardrailService.extractNumericClaims`
(frozen service untouched); college mentions match the frozen curated-catalog vocabulary plus a
proper-noun capture. Student-supplied numbers (their own rank/budget) are carved out.

### F-3 — turn-log durability

`log/flushTurnLog.js` registers the write with `waitUntil` from `@vercel/functions` — the
container survives past the HTTP response with no p95 cost — and falls back to an inline
`await` everywhere else (the stricter behavior). The result is always checked; failures log an
alertable `TURNLOG_WRITE_FAILED`. `writeTurnLog` fails fast with `db_not_connected` instead of
buffering. The shadow-mode turn in `guidedFlowProcessors.js` is also registered with
`waitUntil` instead of floating.

### F-4 — Tier A fallback uses verbatim V2 beat copy

`slot.askable` is a boolean; `slot.askable || <template>` sent students the literal string
`"true"` or copy no product owner wrote. `validate/fallbackBeatCopy.js` maps each askable slot
to the verbatim V2 node copy, **imported directly from the frozen V2 modules** (verbatim by
construction). All six askable slots in the V3 walk are covered (asserted by test); a slot
without copy falls to Tier B. The ladder never writes its own student-facing copy.

### F-5 — string type gating

`validateEnvelope` blocks non-string part bodies/captions/titles (`V-1 part_body_not_string`
etc.); `renderEnvelope` drops non-strings defensively instead of `String()`-coercing.

### F-6 — profile_patch wiring

The envelope patch flows through `validateProfilePatch` on the strict `llm_tool` channel with
non-authoritative `inferred` capture meta. Tier 3 fields (`gender`, `category`, `examType`…)
are rejected outright — S-1 routing fields are writable only by the deterministic extractor,
buttons, or counsellors, so an LLM hallucination can neither trigger nor evade the demographic
gate. Accepted keys merge into `profileAfter`/`slotPatch` (honest turn logs) and the live
processor persists them via `casUpdateLeadProfile({ enforceLlmAllowlist: true })`. Shadow mode
stays write-free.

### F-8 — V-8 beat discipline

An `ask_slot` envelope that unambiguously asks a different named slot than the deterministic
walk selected now blocks (`V-8 beat_discipline:asked=…,expected=…`). Detection is anchored to
each slot's distinctive V2 question vocabulary and is conservative by design: generic coaching
lines and ambiguous multi-slot text never block.

### F-9 — silent-failure sweep (full inventory)

| Site | Before | After |
|------|--------|-------|
| `llmLoop.js` tool-args parse | `catch { args = {} }` — tool ran with guessed args | fail closed: tool never runs, logged, `{failed}` fed back to model |
| `fallbackLadder.js` slot engine | `catch { slot = null }` — silent Tier B downgrade | logged `FALLBACK_SLOT_ENGINE_FAILED`, `slotError` surfaced |
| `rollingSummary.js` generator | silent `summary = null` | logged `SUMMARY_GENERATOR_FAILED` (extractive fallback stays) |
| `promptLoader.js` dir listing | silent `[]` | logged `PROMPT_DIR_UNREADABLE` |
| `toolBroker.js` args key | silent `'0'` idempotency collapse | logged `ARGS_KEY_FALLBACK` |
| `flowV3Dispatcher.js` turn context | error captured, never logged | logged `TURN_CONTEXT_BUILD_FAILED` |
| `guidedFlowProcessors.js` shadow turn | bare floating promise | `waitUntil`-registered, `SHADOW_TURN_FAILED` logged |

Audited and left as-is (each is an explicit error return, not a silent swallow):
`parseEnvelope.js` brace-slice retry (feeds explicit `{ok:false,error}`), `promptLoader.loadPrompt`
(throws `PromptNotFoundError`), `flowV3SlotMeta.sameValue` (equality helper — stringify failure
correctly means "not provably equal").

## Test evidence

Every fix ships with regression tests that **fail on the pre-fix code** (verified by
stash/run/pop during development):

| Suite | Tests | Fail without fix |
|-------|-------|------------------|
| `postMergeDemographic.test.js` | 7 | 4 |
| `groundingVerification.test.js` | 10 | 6 |
| `turnLogDurability.test.js` | 9 | 7 |
| `fallbackAndTypes.test.js` | 10 | 6 |
| `profilePatchWiring.test.js` | 5 | 4 |
| `beatDiscipline.test.js` | 6 | 2 |

Full `test/flowV3` suite with all fixes stacked: **305 pass / 0 fail / 0 skipped**, including
the adversarial golden replay set (crisis, AP-OC-male, ungrounded claim, beat order: 4/4).

## Frozen surfaces

No frozen path was modified: `flowV2/**` and `aiGuardrailService.js` are consumed **read-only**
(imports only); Career Counselling V2, College Predictor, Section E and Phase 9–14 baselines
untouched. Changes are confined to `services/chatbot/flowV3LLM/**`,
`services/chatbot/guidedFlows/guidedFlowProcessors.js` (V3 wiring only), and `test/flowV3/**`.

## Rollout readiness

This remediation makes Flow V3 fit for **shadow mode only**. Live exposure requires, at
minimum: all six PRs merged in order, a fresh adversarial pass against a live model provider,
turn-log write confirmation in the Vercel runtime (waitUntil path), and the owner's explicit
rollout decision. The kill switch and disabled state are unchanged.
