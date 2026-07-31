# Hotfix: crisis handoff reason + crisis lock survives subflow expiry

**Status:** freeze waiver approved, narrowly — `crisis_escalation` added to `HANDOFF_REASONS`, plus the crisis-lock survival fix. Nothing else in `constants/chatbotStates.js`.
**Branch:** `hotfix/crisis-escalation-handoff`. Not part of Flow V3 M-1.

---

## Defect 1 — `crisis_escalation` missing from `HANDOFF_REASONS`

`r7Tier2Handler.js:78` writes `reason: 'crisis_escalation'` when creating the crisis ticket, but `HANDOFF_REASONS` did not contain that value and `WhatsAppAgentHandoff.reason` is `enum: HANDOFF_REASONS`. Mongoose validation rejected the document, so **the crisis handoff ticket was never created** — the student got the correct Tele-MANAS safety reply, but no ticket reached the agent queue.

The failure was invisible because the handoff is fired eagerly and deliberately not awaited (`executeCrisisHandoff().catch(onSideEffectError)`), so the rejection only ever surfaced in a log line.

**Fix:** add `crisis_escalation` to the enum. Agent queues filter on `reason`, so crisis stays distinguishable from ordinary `bot_escalation`. The enum is not otherwise loosened — a test asserts an unknown reason is still rejected.

## Defect 2 — crisis lock hidden by the 30-minute subflow expiry

**Corrected diagnosis.** The earlier write-up said the TTL deletes `crisisLocked` from the database. It does not, and the distinction changes the fix:

- `stateExpiresAt` is an application-level check (`isStateExpired`), not a Mongo TTL index; nothing sweeps the collection.
- `resetToMainMenu` patches with `emptySubflows()`, and `mergeContext` preserves context keys absent from the patch — `flowV2` is not in `emptySubflows()`, so the stored document keeps `crisisLocked`.

The real defect is in memory. `chatbotOrchestratorService.js:506-508` discarded the loaded state and rebuilt it as `{ state: 'main_menu', context: emptySubflows() }`. That turn is then routed as if the student had never been locked, and any writer that rebuilds `flowV2` wholesale (`guidedFlowProcessors.js:206` does exactly this) can persist the blank view back over the real one — turning a display bug into data loss on the next write.

**Fix:** `botStateService.preserveCrisisLock(botState)` returns the crisis-carrying `flowV2` slice (or `{}`), and the orchestrator merges it into the rebuilt context. Everything else still resets — this fixes the lock, not the expiry.

**Known limit, not fixed here:** the lock lives on the bot state, which is keyed by conversation. A crisis lock does not follow the student to a genuinely new conversation document. Durable, phone-keyed crisis state is the correct long-term home (`FlowV3LeadProfile` demonstrates the no-TTL pattern) but it is out of scope for a hotfix that must work on the live Flow V2 path today.

---

## Probe caveat (why the earlier count was not decisive)

The first probe reported 0 crisis-pattern inbounds, 0 `crisis_escalation` tickets, 0 `crisisLocked` bot states. Given Defect 1, a ticket count of zero is exactly what a total write failure looks like — the measurement cannot distinguish "never happened" from "happened and was rejected." Treat the blast radius as **unknown**, not zero. The fix proceeds either way.

---

## Verification

`test/crisisEscalationHotfix.test.js` — 9 tests:

- `crisis_escalation` is accepted and a crisis handoff document validates with `expiresAt: null`
- an unknown reason is still rejected (the enum is not loosened)
- the rebuilt context after a genuinely expired state still carries `crisisLocked` and `crisisHandoffId`
- an unlocked student still gets a clean reset, and other subflows still clear
- null / malformed state never throws and never invents a lock

Regression: `test/flowV2CrisisLock.test.js` and `test/flowV2Handlers.test.js` pass unchanged. The 6 failures in `test/chatbotOrchestrator*.test.js` are pre-existing on the clean base (they require network/Mongo) — verified by stashing this diff and re-running.

## Interaction with Flow V3 M-1

M-1's `escalate_to_human` currently maps crisis to `bot_escalation` plus a `[CRISIS_HANDOFF]` marker in `summaryForAgent`. Once this lands, switch that mapping to `crisis_escalation` and delete `CRISIS_REASON_WORKAROUND` from `services/chatbot/flowV3LLM/tools/escalateToHuman.js`.
