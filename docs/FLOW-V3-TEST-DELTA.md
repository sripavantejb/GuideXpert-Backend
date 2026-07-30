# Flow V3 — test-count delta (A-5)

**Branch:** `feat/flow-v3-foundation`  
**Sources:** agent transcripts ([reconciliation](b79771df-7cca-49d2-9ce5-397ef73176e4), [M-1](38f63e6a-cff1-4526-b063-5d4dea73a275)), [`TEST_NAME_MANIFEST.txt`](../test/flowV3/TEST_NAME_MANIFEST.txt), live suite 2026-07-30.

## Timeline

| Count | Scope / command | What changed (named) |
|---|---|---|
| **218** | M-1 subagent: `test/flowV3` + in-memory Mongo | Baseline after durable profile / turn-log / tools / gates landed in that session. Individual add names from that session are not preserved as a checked-in list (tree was untracked). |
| **228** | Parent session after restoring non-`flowV3` companions | Scope widened. Static reconstruction of that tree: **221** leaf names under `test/flowV3` **+** `guidedFlowSpacing.test.js` (1) **+** `outboundDuplicateGuard.test.js` (2) **+** `mongooseIndexSafety.test.js` (4) = **228**. |
| **226** | Same parent session after M-1 final writes | **−2** vs 228. **Names unknown** — no stash, no reflog, no terminal log of the 226 run. Flagged as an **unproven removal** (possible regression). Manifest pinning was introduced afterward so this cannot recur silently. |
| **227** | Post-reconciliation report (R-7 / final): `test/flowV3/*.test.js` + `outboundDuplicateGuard.test.js` | Scope **without** `mongooseIndexSafety` / spacing. Manifest at foundation commit: **226** source `test()` names under `test/flowV3` only (outbound guard tracked separately in CI command). The reported **227** includes the outbound duplicate-guard suite leaf count delta vs a 226 `flowV3`-only pin — see note below. |
| **Now (close-out)** | Same CI command; G-2b multipart describes skip when `partIndex` absent | Manifest regenerated from source `test()` names after A-2/A-4 adds. Multipart G-2b cases remain listed (not deleted) but are **runtime-skipped** on this branch until PR 4’s model lands. |

## Named adds in this close-out (A-2 / A-4)

### `allowlistExclusionComplete.test.js` (new file)

- every `LLM_BLOCKED_FIELDS` member is denied by `canLlmWriteField`
- every `LLM_BLOCKED_NESTED_PATHS` member is denied
- every `SYSTEM_WRITE_BLOCKED_FIELDS` member is LLM-denied and system-blocked
- exclusion set includes every required group H / I / Tier 3 / Tier 4 field
- writable-set snapshot matches `LLM_WRITABLE_FIELDS` (fails loudly on drift)
- blocked-set snapshot matches schema exports (fails loudly on drift)
- every writable field is intentional: known, not blocked, `canLlmWriteField` true
- fixture files exist on disk next to this suite

### `minorConsentWritePathGuard.test.js` (new file)

- `SYSTEM_WRITE_BLOCKED_FIELDS` covers `consentAt`, `consentVersion`, `isMinor`
- every write channel refuses `consentAt` / `consentVersion` / `isMinor`
- `validateProfilePatch` drops consent / isMinor on every channel
- no production `flowV3LLM` module calls `resolveIsMinor` while unwired

## Removals

| Transition | Named removals |
|---|---|
| 218 → 228 | None (scope add only). |
| 228 → 226 | **UNPROVEN (2)** — cannot name; treat as open risk until a future run diffs against the pinned manifest. |
| 226 → 227 | No source-test deletion identified; count move is scope / reporting (outbound guard + suite composition), not a deleted `test()` name. |
| Close-out | **No `test()` deletions.** G-2b multipart tests are skip-gated, not removed (`ALLOW_TEST_DELETION` not used). |

## Regression flag

The **228 → 226 (−2 unnamed)** gap remains a documented unexplained removal from the reconciliation window. Current protection: `scripts/ci/flowV3Guards.js --check=manifest` with `FLOW_V3_MANIFEST_STRICT=1` in [`.github/workflows/flow-v3-foundation.yml`](../.github/workflows/flow-v3-foundation.yml).
