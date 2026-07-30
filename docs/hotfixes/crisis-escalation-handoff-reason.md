# Hotfix PR: crisis handoff reason + crisisLocked survives TTL

**Status:** approved as a separate PR. Proceeds regardless of what the corrected probe returns.
**Scope:** two bundled crisis-path defects. Not part of Flow V3 M-1.

---

## Defect 1 — `crisis_escalation` missing from `HANDOFF_REASONS`

The live crisis path writes `reason: 'crisis_escalation'` into `WhatsAppAgentHandoff`, but `HANDOFF_REASONS` (`constants/chatbotStates.js`) does not contain that value. Mongoose enum validation **rejects** the document, so the crisis handoff ticket is never created.

**Fix:** add `crisis_escalation` to `HANDOFF_REASONS`. This is an intentional change to a frozen enum and needs the freeze waiver noted in the PR description.

Agent queues filter on `reason` / `summaryForAgent`, so crisis must stay visually distinct from ordinary bot escalation once the real reason exists.

## Defect 2 — `crisisLocked` does not survive bot-state TTL

`crisisLocked` lives in `WhatsAppBotState.context.flowV2`, which is TTL-swept after 30 minutes (same root cause as G-2). The schema comment says "never set to false once true", but the TTL sweep deletes the state wholesale, so a returning student in crisis can be routed back into the normal funnel.

**Fix direction:** persist crisis lock outside the TTL'd bot state (durable, phone-keyed), and read it before any routing decision. `FlowV3LeadProfile` already demonstrates the no-TTL pattern, but the hotfix must work for the **live Flow V2 path**, so it should not depend on V3 rollout.

---

## Probe caveat (why the earlier count was not decisive)

The first probe reported 0 crisis-pattern inbounds, 0 `crisis_escalation` tickets, and 0 `crisisLocked` bot states. Those zeros are consistent with Defect 1 (rejected writes never persist) **and** with Defect 2 (TTL deletes evidence), so the measurement cannot distinguish "never happened" from "happened and was erased." Treat the blast radius as **unknown**, not zero. The fix proceeds either way.

---

## Verification for the PR

- Unit: a handoff created with `reason: 'crisis_escalation'` validates and persists.
- Unit: crisis lock is still readable after the bot-state TTL window elapses (simulated).
- Manual: crisis ticket appears in the agent queue, visibly distinguishable from `bot_escalation`.

## Interaction with Flow V3 M-1

Until this PR lands, M-1 `escalate_to_human` maps crisis to the valid `bot_escalation` value **plus** a `[CRISIS_HANDOFF]` marker in `summaryForAgent`, an audit-trail entry, and `expiresAt: null`. Once `crisis_escalation` exists, switch the M-1 mapping to it and drop the workaround constant (`CRISIS_REASON_WORKAROUND` in `services/chatbot/flowV3LLM/tools/escalateToHuman.js`).
