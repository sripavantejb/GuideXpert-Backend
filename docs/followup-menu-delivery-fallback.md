# Follow-up: Menu delivery fallback (`sendMainMenu` robustness)

**Status:** Not implemented — task for a future PR  
**Created:** 2026-05-29  
**Context:** Temporary IIT list menu disable (`CHATBOT_USE_IIT_LIST_MENU` off by default). This follow-up adds graceful degradation when interactive menu sends fail.

---

## Goal

Improve `sendMainMenu` so a failed list or button send never leaves the user without a reply, and inbound is not marked `processed` when all menu delivery attempts fail.

---

## Requirements

### 1. Fallback chain in `sendMainMenu`

When `sendBotListReply` is used (IIT + `CHATBOT_USE_IIT_LIST_MENU=1`):

```
sendBotListReply
  → if { success: false } → sendBotButtonReply (same body + buildMainMenuButtons)
    → if { success: false } → sendBotTextReply (same body as plain text)
```

When `sendBotButtonReply` is used (button menu, no list):

```
sendBotButtonReply
  → if { success: false } → sendBotTextReply
```

When `sendBotTextReply` is the primary path (no button menu): no change.

Each step should pass through `inReplyToInboundId` and reuse the same welcome `body` text.

### 2. Structured logging

On every fallback, emit via `logChatbotEvent`:

```json
{
  "event": "menu_delivery_fallback",
  "attemptedType": "interactive_list | interactive_button",
  "fallbackType": "interactive_button | text",
  "errMessage": "<from result.error>",
  "conversationId": "...",
  "phoneTail": "...",
  "productLine": "..."
}
```

Use existing `chatbotStructuredLog.js` — extend allowed extra fields or map `error` → `errMessage`.

### 3. Inbound process status

**Today:** `whatsappInboundService.handleInboundWebhook` marks inbound `processed` after `processInbound` returns, even when outbound `{ success: false }`.

**Target:**

- `processInbound` / `sendMainMenu` should return a delivery result, e.g. `{ delivered: boolean, outboundSuccess: boolean, ... }`.
- `handleInboundWebhook` should:
  - set `processStatus: 'processed'` only when at least one outbound send succeeds, **or**
  - set `processStatus: 'failed'` with `processError` when all menu fallbacks fail.
- Consider leaving inbound `pending` for cron replay when all sends fail (optional — align with existing `replayPendingInbound`).

### 4. Files to touch

| File | Change |
|------|--------|
| `services/chatbot/chatbotOrchestratorService.js` | Fallback chain in `sendMainMenu`; return delivery metadata from `processInbound` |
| `services/chatbot/whatsappInboundService.js` | Respect delivery failure when updating `processStatus` |
| `services/chatbot/chatbotStructuredLog.js` | Optional: document `menu_delivery_fallback` event fields |
| `test/chatbotOrchestratorIntegration.test.js` | Mock outbound failures; assert fallback order and log event |
| `test/chatbotMenuDeliveryFallback.test.js` | New — list fail → button, button fail → text, all fail → inbound not processed |

### 5. Out of scope

- Re-enabling IIT list menu by default (`CHATBOT_USE_IIT_LIST_MENU` stays opt-in until list send is verified).
- Other P0/P1 hardening (auth, lead dedupe, assigned expert, structured `inbound_processed` logs).
- `sessionFallbackService` wiring (P1-10).

---

## Test plan

1. Mock `sendBotListReply` → `{ success: false, error: 'Gupshup not configured' }`; assert `sendBotButtonReply` called once with same body.
2. Mock list + button fail; assert `sendBotTextReply` called.
3. Mock all three fail; assert inbound `processStatus === 'failed'` (or `pending` for replay).
4. Mock list fail, button succeed; assert no text fallback and inbound processed.
5. Assert `menu_delivery_fallback` log lines contain `attemptedType`, `fallbackType`, `errMessage`.

---

## Acceptance criteria

- [ ] IIT list send failure still delivers menu via buttons or text.
- [ ] Button send failure still delivers full welcome text.
- [ ] No silent `processed` when user received zero outbound messages.
- [ ] `menu_delivery_fallback` logged on each degradation step.
- [ ] All existing orchestrator tests pass; new fallback tests added.
