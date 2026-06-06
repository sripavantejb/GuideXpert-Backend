# Phase 6 Multilingual Test Matrix

Automated coverage: [`test/multilingualRegressionMatrix.test.js`](../test/multilingualRegressionMatrix.test.js)

Local trace script: `node scripts/audit-multilingual-matrix.js`

## Prerequisites

- `CHATBOT_MULTILINGUAL_ENABLED=1`
- `LLM_API_KEY` set (translate-in/out)
- `DEBUG_AI=true` for `[LANG]` / `[GUARDRAIL]` detail
- Backend restarted after env changes

## Matrix — 7 regression messages

| Message | Expected detected | Expected resolved | Expected source | Expected intent | Expected outbound lang | Guardrail |
|---|---|---|---|---|---|---|
| `Can I get CSE with rank 15000?` | `en` | `en`* | `offline` | `college_predictor` | `en`* | CP unavailable (rank known) |
| `15000 ర్యాంక్‌తో CSE వస్తుందా?` | `te` | `te` | `offline` | `college_predictor` | `te` | CP unavailable (rank known) |
| `నాకు ఏ బ్రాంచ్ మంచిది?` | `te` | `te` | `offline` | `unknown` → LLM | `te` | allowlist user numbers |
| `naaku cse kavali` | `te` | `te` | `romanized` | `unknown` → LLM | `te` | allowlist if numbers |
| `15000 rank ki cse vastunda` | `te` | `te` | `romanized` | `college_predictor` | `te` | CP unavailable (rank known) |
| `mujhe cse chahiye` | `hi` | `hi` | `romanized` | `unknown` → LLM | `hi` | allowlist if numbers |
| `meri rank 15000 hai` | `hi` | `hi` | `romanized` | `rank_predictor` | `hi` | none (rank path) |

\*Without IIT lead / conversation `preferredLanguage`. With stored `te`/`hi` preference, resolved language follows preference.

## Structured log fields (`inbound_processed`)

After regression fixes, each processed inbound should log:

- `originalMessage`
- `detectedLanguage`
- `resolvedLanguage`
- `detectionSource` — `offline` | `romanized` | `llm_fallback` | `fallback`
- `englishMessage`
- `intent`
- `retrievedChunks` — KB chunk IDs when KA/LLM path used
- `guardrailDecision` — `{ modified, reason }`
- `outboundLanguage`
- `finalResponse`

## Language coverage (translate-out)

| Code | Greeting static | Guardrail static | LLM translate-out |
|---|---|---|---|
| `te` | yes | yes | yes |
| `hi` | yes | yes | yes |
| `ta` | yes | yes | yes |
| `kn` | yes | yes | yes |
| `ml` | yes | yes | yes |
| `mr` | yes | yes | yes |
| `bn` | yes | yes | yes |

## Outbound translation intents

`finalizeMultilingualOutbound` runs when `resolvedLanguage !== en` for:

- `knowledge_assistant`
- `rank_predictor` / `rank_predictor_continue`
- `unknown` + successful `tryLlmReply`

## WhatsApp manual smoke

1. Start a **new** conversation (or reply `MENU` to reset).
2. Send each matrix message once.
3. Verify reply language matches expected outbound lang.
4. Capture screenshot + `[chatbot:structured]` log line per message.
5. Attach screenshots to [`phase-6-hotfix-traces.md`](phase-6-hotfix-traces.md) regression section.

## Verification commands

```bash
cd GuideXpert-Backend
node --test test/multilingualRegressionMatrix.test.js
node --test test/*.test.js
node scripts/audit-multilingual-matrix.js
```
