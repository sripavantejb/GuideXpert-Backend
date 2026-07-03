# WhatsApp College Predictor — Developer Guide

Conversational college prediction for the GuideXpert WhatsApp chatbot. Users fill slots in natural language before the existing College Dost predictor API is called.

## Architecture

```
Inbound webhook
  → whatsappInboundService (dedupe + claim)
  → chatbotOrchestratorService.processInbound (optimistic lock retry)
  → handleCollegePredictorMessage (slot filling)
  → collegePredictorCore / fetchCollegeDostColleges
  → formatPredictionReply → outbound
```

### Key modules

| Path | Role |
|------|------|
| `services/chatbot/collegePredictorChatService.js` | Orchestrates slot filling and API call |
| `services/chatbot/whatsappCollegePredictor/collegePredictorSlotExtractor.js` | NL + menu parsing |
| `services/chatbot/whatsappCollegePredictor/collegePredictorSlots.js` | Slot order, readiness, payload build |
| `services/chatbot/whatsappCollegePredictor/collegePredictorConversation.js` | Counsellor-style prompts |
| `services/chatbot/botStateService.js` | CAS state persistence + retry |
| `constants/whatsappCollegePredictor.js` | Exam constants, reply formatting |

## Conversation flow

1. User enters via menu (`college_predictor`) or NL (“predict colleges”, “college predictor”).
2. Bot collects slots per exam: exam → rank/percentile → category → gender → region/quota (exam-dependent).
3. When `isPredictionReady(ctx)` is true, `runPrediction()` calls the predictor API once.
4. On success: formatted reply + `clearState` → orchestrator resets to `main_menu`.
5. User can send `AGAIN` to restart, `MENU` for main menu.

State is stored in `WhatsAppBotState.context.college` with `state: 'college_predictor'`. Subflow TTL is **30 minutes** (`SUBFLOW_TTL_MS`); expired state resets to main menu in the orchestrator.

## Slot filling

- **Menu digits**: exam `1`–`9`, category/gender/region by numbered options.
- **Natural language**: e.g. “My TS EAMCET rank is 18453”, “AIR 24000”, “15k”, “OBC female”.
- **Extraction**: `extractSlotsFromMessage(text, ctx)` → `applyExtractedSlots()` merges into context.
- **Missing slots**: `getMissingSlots(ctx)` drives the next question via `buildQuestionForSlot()`.

## Optimistic locking (CAS)

`WhatsAppBotState.version` starts at `0` and increments on every successful update.

### CAS workflow

1. `updateBotStateCas()` reads the document and records `expectedVersion`.
2. `buildUpdate` merges context (`mergeContext` deep-merges `college` and `rank` sub-objects).
3. `updateOne({ conversationId, version: expectedVersion }, { $set: …, $inc: { version: 1 } })`.
4. If `modifiedCount !== 1`, throws `OptimisticLockConflictError`.

All updates go through `transitionState()` → `updateBotStateCas()`.

### Retry behavior

`processInbound()` wraps the handler in `runWithOptimisticLockRetry()`:

- **Max attempts**: 3
- **Backoff**: 5ms × attempt number
- **On conflict**: reload latest state, replay the full inbound message
- **On exhaustion**: log `optimistic_lock_failed`, send orchestrator fallback reply (no crash)

### Deep merge

Concurrent slot messages merge at persistence time:

```javascript
{ college: { exam: 'TS_EAMCET' } } + { college: { rank: 18453 } }
→ { college: { exam: 'TS_EAMCET', rank: 18453 } }
```

Empty `college: {}` resets the subflow.

## Idempotency

| Layer | Mechanism |
|-------|-----------|
| Duplicate webhooks | `dedupeKey` + unique indexes on inbound |
| Concurrent processing | `claimInboundForProcessing` (atomic pending→processing) |
| Duplicate replies | `findSuccessfulBotReply(inReplyToInboundId)` in outbound service |
| Optimistic retry | Replays message; outbound dedupe prevents double send |
| Post-prediction retry | `collegePrediction` on inbound + `context.predictionIdempotency` on bot state |

### Active college predictor routing

When `botState.state === 'college_predictor'`, inbound messages bypass intent classification, scope firewall, and all assistant paths. They go directly to `handleCollegePredictorMessage()`.

Interrupts only: **MENU**, **CANCEL**, **AGENT**, **opt-out**. `AGAIN` is handled inside the college predictor handler.

After a successful predictor API call, completion is recorded atomically on the inbound:

```json
{
  "lastPredictionInboundId": "...",
  "predictionCompleted": true,
  "predictionTimestamp": "...",
  "predictionHash": "...",
  "cachedReply": "..."
}
```

`runPrediction()` checks inbound (and bot context) before calling the API. `claimInboundPredictionCompletion()` ensures exactly one `predictor_success` analytics event per inbound. Orchestrator mirrors completion to `context.predictionIdempotency` before clearing college slots.

## Structured logging

| Event | When |
|-------|------|
| `predictor_success` | Successful API prediction |
| `predictor_failed` | Predictor API error |
| `optimistic_lock_conflict` | Version conflict (includes `previousVersion`, `currentVersion`, `retryAttempt`, `resolvedSuccessfully`) |
| `optimistic_lock_failed` | All retries exhausted |

Logs use `phoneTail` (masked), never full phone numbers or tokens. See `chatbotStructuredLog.js`.

## Certification scripts

```bash
cd GuideXpert-Backend

# Unit + concurrency tests
node --test test/chatbotCollegePredictor.test.js \
  test/botStateOptimisticLock.test.js \
  test/botStateMergeContext.test.js \
  test/collegePredictorSlotExtractor.test.js

# Optimistic lock stress + metrics
node scripts/botStateOptimisticLockCertification.js

# Full production gate (live API optional)
node scripts/collegePredictorProductionGate.js

# Conversational NL certification
node scripts/collegePredictorConversationalCertification.js

# Real-user style harness (set CERT_PHONE env)
node scripts/collegePredictorRealUserCertification.js
```

### Reproduce concurrency tests

Requires `mongodb-memory-server` (dev dependency):

```bash
node --test test/botStateOptimisticLock.test.js
```

Simulates 2/3/5 simultaneous slot messages and a 4-message rapid burst (exam → rank → category → gender) against a shared `conversationId`.

## Configuration

- Predictor is **always enabled** in code (`isCollegePredictorEnabled()` returns `true`).
- Live predictions require `NW_PREDICTORS_ACCESS_TOKEN` or `COLLEGEDOST_ACCESS_TOKEN` in `.env`.
