# Phase 6 Hotfix — Before / After Pipeline Traces

## Fix 1 — User rank no longer blocked by guardrail

### Before

```
Telugu: "15000 ర్యాంక్‌తో CSE వస్తుందా?"
  → detect: te
  → translate in: "Can I get CSE with rank 15000?"
  → intent: knowledge_assistant (session) OR unknown → tryLlmReply
  → RAG + LLM (English)
  → LLM: "With rank 15000, CSE may be possible..."
  → guardrail: unsupported_numeric_claim (15000 not in KB chunks)
  → outbound: "I do not have verified information to support that claim." (translated)
```

### After

```
Same inbound path
  → guardrail: user allowlist includes 15000 from original + English query
  → guardrail: modified=false
  → outbound: normal English answer → finalizeMultilingualOutbound → Telugu
```

**Validation messages (no guardrail fallback):**

- `Can I get CSE with rank 15000?`
- `15000 ర్యాంక్‌తో CSE వస్తుందా?`
- `97.8 percentile` (decimal allowlist)

---

## Fix 2 — Social greetings no longer hit Knowledge Assistant

### Before

```
"ela vunnaru"
  → translate: "How are you?"
  → classifyIntent(englishMessage)
  → /\bhow are\b/ → knowledge_assistant
  → RAG + LLM + guardrails
```

### After

```
"ela vunnaru" OR translated "how are you?"
  → isSocialGreeting → greeting (high)
  → resolveGreetingReply(te)
  → "నేను బాగున్నాను. మీకు ఎలా సహాయం చేయగలను?"
  → no KB, no LLM, no guardrails
```

**Unchanged:**

- `hello` / `hey` / `namaste` → `main_menu`
- `how are placements at niat` → `knowledge_assistant`

---

## Fix 3 — Unknown intent uses English pivot end-to-end

### Before

```
Telugu: "నాకు ఏ branch బాగుంటుంది?"
  → translate in: English query
  → classifyIntent(englishMessage) → unknown
  → tryLlmReply(inbound.text)  ← original Telugu
  → outbound: localizeKnownFallback only (no full translate back)
```

### After

```
Same inbound
  → tryLlmReply(englishMessage)
  → LLM English reply
  → finalizeMultilingualOutbound → Telugu reply
```

---

## English pivot coverage

| Path | Classifier input | LLM/RAG input | Outbound |
|------|------------------|---------------|----------|
| `knowledge_assistant` | `englishMessage` | `englishMessage` | `finalizeMultilingualOutbound` |
| `unknown` + LLM | `englishMessage` | `englishMessage` | `finalizeMultilingualOutbound` |
| `greeting` | `englishMessage` | none | static localized reply |
| `rank_predictor` / menu | mixed | original handlers | unchanged |

---

## Debug logging

Set `DEBUG_AI=true` to capture:

- `[LANG]` detect / translate timings
- `[KB]` retrieval IDs
- `[GUARDRAIL] Modified` / `Reason`

Structured logs on `inbound_processed` include `detectedLanguage`, `resolvedLanguage`, `translatedQuery`, `guardrailModified`.

---

## Fix 4 — Romanized Telugu/Hindi detection (ASCII)

### Before (`em chesthunnav`, no IIT lead)

```
detectedLanguage: en, source: offline, confidence: 0.92
resolvedLanguage: en
englishMessage: em chesthunnav (unchanged)
intent: unknown
finalResponseLanguage: en
```

### After

```
detectedLanguage: te, source: romanized, confidence: 0.88
resolvedLanguage: te
englishMessage: What are you doing? (translate-in)
intent: unknown → tryLlmReply(englishMessage) → finalizeMultilingualOutbound
finalResponseLanguage: te
```

### Greeting (`ela unnaru`)

```
detectedLanguage: te, source: romanized
intent: greeting (classifier on englishMessage or original phrase)
reply: Telugu static greeting via resolveGreetingReply(te)
```

**Detection source values:**

| Value | When |
|-------|------|
| `offline` | franc non-English, or English after romanized miss |
| `romanized` | heuristic te/hi match on ASCII Romanized text |
| `llm_fallback` | LLM detector when offline confidence is low |
| `fallback` | empty input / final default `en` |

---

## WhatsApp smoke test checklist (Romanized)

With `CHATBOT_MULTILINGUAL_ENABLED=1`, `DEBUG_AI=true`, backend restarted:

| Send | Verify in logs |
|------|----------------|
| `em chesthunnav` | `source: romanized`, `detectedLanguage: te`, translated outbound |
| `thinnava` | same |
| `Hi mama` | `te` if romanized token/phrase added; else document outcome |
| `kaise ho` | `source: romanized`, `hi`, greeting or translated reply |
| `Can I get CSE with rank 15000?` | still `en`, `source: offline` |

Structured log line `[chatbot:structured]` should show `detectedLanguage`, `resolvedLanguage`, `translatedQuery`.

---

## Regression audit — rank/branch, outbound translation, mixed language

See full matrix: [`phase-6-multilingual-test-matrix.md`](phase-6-multilingual-test-matrix.md)

### Before

| Issue | Symptom |
|-------|---------|
| Rank+branch under KB session | `Can I get CSE with rank 15000?` → `knowledge_assistant` → guardrail fallback |
| Rank predictor Telugu | `15000 rank ki cse vastunda` → English rank wizard reply |
| Mixed Romanized | `naaku cse kavali` → `detectedLanguage: en`, no translate-out |
| kn/ml/mr/bn greetings | English greeting fallback |

### After (expected)

| Message | detected | resolved | intent | outbound |
|---------|----------|----------|--------|----------|
| `Can I get CSE with rank 15000?` | `en` | `en`* | `rank_predictor` (beats KB session) | English* |
| `15000 rank ki cse vastunda` | `te` | `te` | `rank_predictor` | Telugu via `finalizeMultilingualOutbound` |
| `naaku cse kavali` | `te` | `te` | `unknown` → LLM | Telugu |
| `mujhe cse chahiye` | `hi` | `hi` | `unknown` → LLM | Hindi |

\*Unless conversation/IIT lead preference overrides.

### WhatsApp screenshot checklist (manual)

With `CHATBOT_MULTILINGUAL_ENABLED=1`, `DEBUG_AI=true`:

1. Reset session (`MENU`).
2. Send each of the 7 matrix messages (see test matrix doc).
3. Screenshot reply + log line showing `detectionSource`, `outboundLanguage`, `finalResponse`.
4. Attach screenshots here under **Regression screenshots** (pending manual capture).

**Regression screenshots:** _(attach after manual WhatsApp smoke)_

