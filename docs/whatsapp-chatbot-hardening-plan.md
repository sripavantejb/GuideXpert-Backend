# WhatsApp Chatbot Hardening Plan

Based on the verification audit. **P0** must ship before any testing; **P1** before production.

---

## P0 — Must fix before any testing

### 1. Inbound persist issue

| | |
|---|---|
| **Root cause** | `WhatsAppInboundMessage.create({ conversationId: null })` violates Mongoose `required: true` on `conversationId`. |
| **Files** | [`services/chatbot/whatsappInboundService.js`](../services/chatbot/whatsappInboundService.js), [`models/WhatsAppInboundMessage.js`](../models/WhatsAppInboundMessage.js) |
| **Fix** | Call `getOrCreateConversation` before inbound insert; set `conversationId` on create. Link `WhatsAppWebhookEvent.inboundMessageId` after insert. |
| **Risk** | High — inbound webhooks fail validation; cron replay skips null `conversationId`. |
| **Effort** | S (~2h) |
| **Tests** | Inbound doc builder includes `conversationId`; integration path creates valid row (mocked or DB). |

### 2. Conversation creation race condition

| | |
|---|---|
| **Root cause** | Partial unique index `{ phone, productLine }` for active/handoff; concurrent `create` → E11000; no retry. BotState create can also race. |
| **Files** | [`services/chatbot/conversationService.js`](../services/chatbot/conversationService.js) |
| **Fix** | On duplicate key, `findOne` active conversation and continue; ignore duplicate BotState create. |
| **Risk** | Medium — rare 500s under concurrent first messages. |
| **Effort** | S (~2h) |
| **Tests** | Duplicate-key helper; retry path returns existing conversation (mocked models). |

### 3. Webhook authentication

| | |
|---|---|
| **Root cause** | `GUPSHUP_WEBHOOK_SECRET` optional; DLR path never checked; plain string compare; unauthorized inbound returned HTTP 200. |
| **Files** | New [`utils/gupshupWebhookAuth.js`](../utils/gupshupWebhookAuth.js), [`services/chatbot/whatsappInboundService.js`](../services/chatbot/whatsappInboundService.js), [`controllers/gupshupWebhookController.js`](../controllers/gupshupWebhookController.js) |
| **Fix** | Central auth: timing-safe compare when secret set; `GUPSHUP_WEBHOOK_AUTH_REQUIRED=1` enforces secret; apply at start of `ingestGupshupWebhook`; 401 on failure. |
| **Risk** | Critical — spoofed webhooks can inject messages or corrupt DLR. |
| **Effort** | S (~2h) |
| **Tests** | Match/mismatch/missing secret; required-without-secret → 503. |

### 4. BDA authorization vulnerability

| | |
|---|---|
| **Root cause** | `POST /api/bda/whatsapp-chat/handoffs/:id/resolve` calls `resolveHandoff(id)` with no `bdaId` check. |
| **Files** | [`services/chatbot/handoffService.js`](../services/chatbot/handoffService.js), [`services/chatbot/bdaChatInboxService.js`](../services/chatbot/bdaChatInboxService.js), [`controllers/whatsappChatBdaController.js`](../controllers/whatsappChatBdaController.js) |
| **Fix** | `resolveHandoff(id, { bdaId })` validates `route === 'bda'` and `assignedBdaId`; BDA controller uses `bdaResolveHandoff`. |
| **Risk** | High — IDOR: any BDA resolves another BDA’s handoff. |
| **Effort** | S (~1h) |
| **Tests** | `assertBdaCanResolveHandoff` matrix; resolve rejects wrong BDA. |

---

## P1 — Must fix before production

### 5. Session fallback wiring

| | |
|---|---|
| **Root cause** | `sessionFallbackService` not called from `whatsappOutboundService` on inactive-user / session errors. |
| **Files** | [`services/chatbot/whatsappOutboundService.js`](../services/chatbot/whatsappOutboundService.js), [`services/chatbot/sessionFallbackService.js`](../services/chatbot/sessionFallbackService.js) |
| **Fix** | On Gupshup session failure codes (e.g. 1004/1005 or message match), optional template fallback; mark outbound `template_fallback`. |
| **Risk** | Medium — users outside 24h window get no reply. |
| **Effort** | M (~4h) |
| **Tests** | Mock Gupshup error → fallback invoked once. |

### 6. DLR matching improvements

| | |
|---|---|
| **Root cause** | `applyDlrToOutboundMessage` picks newest of 5 without `pickBestWebhookMatchCandidate`. |
| **Files** | [`services/chatbot/chatbotDlrService.js`](../services/chatbot/chatbotDlrService.js), [`utils/gupshupWebhookMatcher.js`](../utils/gupshupWebhookMatcher.js) |
| **Fix** | Reuse campaign `pickBest` + phone fallback for chatbot outbound. |
| **Risk** | Medium — wrong row updated on ID collision. |
| **Effort** | M (~3h) |
| **Tests** | Multi-match fixtures; monotonic status. |

### 7. Duplicate handoff prevention

| | |
|---|---|
| **Root cause** | No unique partial on open/claimed handoffs per conversation. |
| **Files** | [`models/WhatsAppAgentHandoff.js`](../models/WhatsAppAgentHandoff.js), [`services/chatbot/handoffService.js`](../services/chatbot/handoffService.js) |
| **Fix** | Partial unique index; `createHandoff` returns existing open handoff. |
| **Risk** | Medium — duplicate agent queues. |
| **Effort** | M (~3h) |
| **Tests** | Double AGENT → one open handoff. |

### 8. Distributed rate limiting design

| | |
|---|---|
| **Root cause** | In-memory `Map` in `whatsappInboundService` not shared across serverless instances. |
| **Files** | [`services/chatbot/whatsappInboundService.js`](../services/chatbot/whatsappInboundService.js), new Redis/Mongo rate limit adapter |
| **Fix** | Design doc + implement Redis (or Mongo TTL counters) keyed by `phone10`; keep local fallback for dev. |
| **Risk** | Medium at scale — flooding bypasses limit. |
| **Effort** | L (~1–2d) |
| **Tests** | Two logical instances share counter (integration). |

---

## Implementation status

| ID | Status |
|----|--------|
| P0-1 | Implemented |
| P0-2 | Implemented |
| P0-3 | Implemented |
| P0-4 | Implemented |
| P1-5–8 | Not implemented (this pass) |
