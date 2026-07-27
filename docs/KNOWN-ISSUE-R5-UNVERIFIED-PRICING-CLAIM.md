# Known issue: R5's "is this free" reply makes an unverified pricing claim

**Status:** Open. Currently shipping to real students today.
**Severity:** Medium — a factual claim about money, made with no supporting source anywhere in the codebase.
**Filed:** 2026-07-27, during Flow v2 Phase 7 (B7 · Book). Flow v2 is a separate, unreleased chatbot track — you do not need any context about it to understand or fix this ticket.

## What's broken

`services/chatbot/flowV2/router/handlers/r5Handler.js`'s `IS_FREE_TEXT`, sent whenever a student's message matches the "is this free" trigger pattern, states:

```javascript
const IS_FREE_TEXT =
  "This chat is completely free, and so is the 1-on-1 session. Nothing to pay at any point here. So — where are you right now?";
```

The file's own header comment says this copy is "verbatim from spec," but a full search of the codebase (constants, profile schemas, booking orchestrator registries) turns up **no flag, constant, or documented business fact anywhere that supports the claim that the 1-on-1 counseling session is free.**

## Why it matters

A phase built one iteration earlier (Flow v2's Greeting) already ran into this exact question and made the opposite, more careful choice: it confirmed no pricing flag/constant exists anywhere in the codebase and correctly *omitted* any free-or-not claim from its own copy as a result, rather than asserting one without a source. R5 was built one phase later, asks a directly related question ("is this free"), and did not carry that same finding forward — it answers definitively where Greeting deliberately stayed silent.

This means Flow v2 currently has two different, inconsistent postures on the same open business question live in the same beat spine: one part of the bot won't claim a price either way, and another part flatly tells the student the session costs nothing. If the session is not actually free, R5 is making an incorrect promise directly to real students, with no way for anyone maintaining this code today to know whether that's true.

## What needs to happen

1. Verify the real business fact with Product/Sales: is the 1-on-1 counseling session actually free, always, for every student?
2. If yes — this is a lower-priority fix: encode that fact somewhere real (a constant, not just a hardcoded sentence) so it can't drift silently again, and cite it from R5.
3. If no, or "it depends" — `r5Handler.js`'s `IS_FREE_TEXT` needs to be corrected immediately; it is actively telling students something false.

## Note for whoever picks this up

This ticket is docs-only — no code change has been made to `r5Handler.js` as part of filing it. The unreleased Flow v2 track's B7 · Book beat (`services/chatbot/flowV2/nodes/b7Book.js`) deliberately does not state a price either way, precisely because of this same unresolved question — once this is verified, both R5 and B7 should end up with a consistent, sourced answer rather than each guessing independently.
