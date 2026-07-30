# Flow V3 R-5 acceptance evidence

Re-proven against the consolidated tree on 2026-07-30. Suite:

```bash
env -u MONGODB_URI -u MONGO_URI FLOW_V3_REQUIRE_MONGO=1 \
  node --test test/flowV3/*.test.js test/outboundDuplicateGuard.test.js
# → 226 pass / 0 fail / 0 skipped
```

Frozen paths remained empty:

```bash
git diff HEAD --stat -- services/chatbot/flowV2 services/chatbot/careerCounselling
# → empty
```

| # | Criterion | Evidence |
|---|---|---|
| 1 | Multi-part send: 3 parts → 3 delivered rows, `sentPartCount === envelopePartCount`, replay → 0 extra provider sends | `test/flowV3/multipartOutbound.test.js`, `multipartIdempotency.test.js`, `test/outboundDuplicateGuard.test.js` — all green against in-memory Mongo |
| 2 | AP + OC + male → `{ refused, copy }` with ZERO predictor calls, including mid-conversation merge and lowercase `ap_eamcet` | `tools.test.js` ("AP + OC + male refuses…") now covers uppercase, post-merge, and `ap_eamcet`; `gatesAndContext.test.js` covers lowercase aliases for the demographic gate |
| 3 | Every tool has a unit test against a fixture derived from the real upstream response shape | `tools.test.js` + `fixtures/collegeDostEnvelope.json` for predictor; booking/knowledge/escalate use injected deps with real-shape stubs |
| 4 | `FlowV3LeadProfile` has no TTL — schema + live collection — and survives a 30-minute idle | `durableProfileIdle.test.js` (own `mongodb-memory-server`, never skips); `profileFoundation.test.js` schema TTL assertion; store suite asserts live indexes |
| 5 | Curated catalog: 10 rows, every row tagged `catalog:'curated'` | `tools.test.js` `get_curated_catalog tool` |
| 6 | Guardrail union: verified exact union, `/\bmandatory\b/` present, every phase pattern accounted for | `guardrailsUnion.test.js` — length 14, phase 10–13 + NIAT patterns, explicit `/\bmandatory\b/` test |
| 7 | Inferred slots do NOT satisfy `nextSlot()`, never gate a recommendation, never feed the predictor | `profileFoundation.test.js` (inferred masked in nextSlot); `profileAuthority.test.js` (RULE A); predictor tool returns `needs` / `inferred_cannot_satisfy_predictor` |
| 8 | LLM write-allowlist rejects group H, group I, `leadStage`, `bookingStatus`, `crisisLocked`, `consentAt`, `isMinor`, and all Tier 3 fields | `profileSchema.test.js` + `profileWritePolicy.test.js` + `profileFoundation.test.js` — schema-derived `canLlmWriteField` post-consolidation |
| 9 | Legacy mirror is one-directional: `examResults[isPrimary]` → flat fields, never read back | `profileLegacyMirror.test.js` + foundation mirror tests; unresolved primary refuses to guess |
| 10 | CAS write persists and `__v` increments | `profileStore.test.js` `applyProfilePatch writes, mirrors and bumps __v` and compat-layer CAS tests against in-memory Mongo (not skipped) |

## Notes

- Multi-part delivery end-to-end against a live phone is **out of scope** (Branch 4 held; no staging phone supplied).
- Idle survival uses in-memory Mongo per the R-1 sign-off (`memory_only`), not the production cluster.
