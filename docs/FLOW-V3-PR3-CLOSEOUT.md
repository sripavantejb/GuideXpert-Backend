# Flow V3 — PR 3 Part A close-out

**Branch:** `feat/flow-v3-foundation`  
**Date:** 2026-07-30

## A-1 Allowlist-34

[`FLOW-V3-ALLOWLIST-34.md`](FLOW-V3-ALLOWLIST-34.md) — **0 bugs.** No reverts.

## A-2 Exclusion-set test

- [`test/flowV3/allowlistExclusionComplete.test.js`](../test/flowV3/allowlistExclusionComplete.test.js)
- Fixtures: [`test/flowV3/fixtures/llmWritableFields.json`](../test/flowV3/fixtures/llmWritableFields.json), [`llmBlockedFields.json`](../test/flowV3/fixtures/llmBlockedFields.json)
- Enumerates full `LLM_BLOCKED_FIELDS` + nested + `SYSTEM_WRITE_BLOCKED_FIELDS`; snapshots writable set.

## A-3 Test-deletion CI guard + autoindex wiring

### Test-deletion (proven red → green)

Scratch proof on this machine (no permanent deletion):

1. Deleted tracked `test/outboundDuplicateGuard.test.js` from the working tree.
2. `FLOW_V3_GUARD_BASE=HEAD node scripts/ci/flowV3Guards.js --check=test-deletions` → **exit 1** with:
   `test/ deletions without ALLOW_TEST_DELETION in the commit body: test/outboundDuplicateGuard.test.js`
3. Restored the file → **exit 0**.

### mongooseIndexSafety wiring

| Surface | Detail |
|---|---|
| Workflow | [`.github/workflows/flow-v3-foundation.yml`](../.github/workflows/flow-v3-foundation.yml) |
| Step | **Mechanical guards** — `node scripts/ci/flowV3Guards.js` |
| Check | `autoindex` → runs `node --test test/mongooseIndexSafety.test.js` when that file exists |
| This branch | `config/mongooseSafety.js` present (required by Flow V3 Mongo tests). Full connect-site suite file remains on `chore/mongoose-autoindex-safety` (PR 2); autoindex soft-OKs until that file lands after PR 2 merge. |

## A-4 Housekeeping

1. `smoke-results/` added to [`.gitignore`](../.gitignore).
2. [`test/flowV3/minorConsentWritePathGuard.test.js`](../test/flowV3/minorConsentWritePathGuard.test.js) — no reachable write / `resolveIsMinor` call while policy unwired.
3. [`.env.example`](../.env.example) — five Flow V3 vars present uncommented with safe defaults:
   `CHATBOT_FLOW_V3_ENABLED=0`, `FLOW_V3_PHONE_HASH_PEPPER=`, `FLOW_V3_DEFAULT_BOOKING_SERVICE=`, `FLOW_V3_REQUIRE_MONGO=0`, `ALLOW_REMOTE_AUTO_INDEX=0`.

## A-5 Test delta

[`FLOW-V3-TEST-DELTA.md`](FLOW-V3-TEST-DELTA.md). Manifest now **238** source names (+12 from A-2/A-4). Unproven **228→226 (−2)** still flagged.

## A-6 Contract diff

**BLOCKED** — [`FLOW-V3-A6-CONTRACT-BLOCKED.md`](FLOW-V3-A6-CONTRACT-BLOCKED.md). `LEAD_PROFILE_CONTRACT.md` absent.

## Suite (this close-out)

```bash
env -u MONGODB_URI -u MONGO_URI FLOW_V3_REQUIRE_MONGO=1 \
  node --test test/flowV3/*.test.js test/outboundDuplicateGuard.test.js
# → 239 tests · 231 pass · 0 fail · 8 skipped
# Skipped (explicit g2bTest skip, not silent pass): 8 G-2b multipart
# assertions awaiting partIndex on fix/g2b-multipart-delivery
```

Frozen paths: no edits to `services/chatbot/flowV2/**` or `careerCounselling/**`.

## PR 3 merge verdict

**YES — merge `feat/flow-v3-foundation`, with merge-order notes:**

1. Prefer merging **PR 2** (`chore/mongoose-autoindex-safety`) first so `test/mongooseIndexSafety.test.js` activates the full autoindex check (already wired).
2. Do **not** wait on PR 4 / G-2b for this merge; multipart assertions are skip-gated until `partIndex` lands.
3. A-6 remains blocked on the missing contract file (non-blocking for foundation merge; schema is authority today).
4. Unproven 228→226 (−2) is documented risk, not a live red suite.

**Do not** enable `CHATBOT_FLOW_V3_ENABLED`, wire dispatcher/llmLoop, or ship student-facing consent copy as part of this PR.
