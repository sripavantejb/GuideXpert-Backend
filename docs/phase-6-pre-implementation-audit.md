# Phase 6 — Pre-Implementation Audit

**Date:** 2026-06-05  
**Verdict:** **PASS — proceed with English-pivot translation**

## Phase 4 Knowledge Assistant — PASS

- Entry: `chatbotOrchestratorService.js` `case 'knowledge_assistant'` → `knowledgeAssistantService.answerWithTimeout()`
- Gated by `CHATBOT_KNOWLEDGE_ASSISTANT_ENABLED=1` or `CHATBOT_LLM_ENABLED=1` + `LLM_API_KEY`
- Guardrails run after LLM, before return: `validateAiResponse()` in `answer()` — safe to keep pipeline English through guardrails, then translate outbound

## Phase 5 RAG — PASS (with known limits)

- Hybrid retrieval via `searchKnowledgeAsync()` default mode `hybrid`
- English KB in `knowledge/knowledgeBase.json` (262 entries) + Mongo `KnowledgeChunk` embeddings
- **Limitation (acceptable for Phase 6):** keyword path `normalize()` strips non-Latin; Telugu/Hindi queries rely on vector recall after English translation — no RAG code changes required if inbound is translated first

## Logging — PARTIAL (addressed in Step 7)

| What | Today | Gap |
|------|-------|-----|
| User query | `aiDebugLog('KB', ...)` when `DEBUG_AI=true` | Not persisted; not in structured logs |
| Retrieved chunks | IDs logged under `[KB]` / `[HYBRID]` | No scores/mode in `logChatbotEvent` |
| Generated response | `[LLM-DEBUG]` + guardrail flags | Orchestrator discards `guardrailModified` |
| Structured | `chatbotStructuredLog.js` logs intent + duration only | No multilingual or retrieval fields |

## Hardcoded English assumptions — BLOCKERS (addressed by translate-pivot)

- `knowledgeAssistant.system.js`: English-only instructions
- `aiGuardrailService.js`: English regex + English fallback strings
- `intentClassifierService.js`: English `KNOWLEDGE_QUESTION_PATTERNS` — non-English queries may miss `knowledge_assistant` intent unless classified on translated text
- Orchestrator fallbacks (`KNOWLEDGE_ASSISTANT_FALLBACK_REPLY`) are English-only

## Existing multilingual code (reuse)

- `multilingualReplyService.js`: Telugu/Hindi main-menu greeting only — unused; refactored to share `languageConstants`
- `leadContext.iit.preferredLanguage` populated in `leadContextService.js` (`Telugu` | `Hindi`) but not passed to assistant — wired via `conversationLanguageService`

## Pre-coding blockers — resolution plan

1. Run intent classification on **English-translated** inbound → `multilingualMiddleware` + orchestrator wiring
2. Apply guardrails on **English** LLM output **before** outbound translation → unchanged guardrail order
3. Map CRM language labels (`Telugu`, `Hindi`) ↔ ISO codes (`te`, `hi`) → `languageConstants.js`

## Explicitly NOT modified

- `knowledgeVectorSearchService.js`, `knowledgeHybridSearchService.js`, `knowledgeRerankService.js`
- `knowledgeBase.json`, indexing scripts
- Embedding provider / `$vectorSearch` pipeline
