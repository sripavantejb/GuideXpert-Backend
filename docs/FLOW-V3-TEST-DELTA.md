# Flow V3 — test-count delta (A-5)

**Branch:** `feat/flow-v3-foundation`  
**Sources:** git history on pushed branches, [`TEST_NAME_MANIFEST.txt`](../test/flowV3/TEST_NAME_MANIFEST.txt), prior session reports.

## Timeline

| Count | Scope / command | What changed (named) |
|---|---|---|
| **218** | M-1 subagent: `test/flowV3` + in-memory Mongo (untracked tree) | Pre-commit working tree only. |
| **228** | Parent session + companions | Reconstructed scope: flowV3 leaves **+** `guidedFlowSpacing` (1) **+** `outboundDuplicateGuard` (2) **+** `mongooseIndexSafety` (4). |
| **226** | Same session after M-1 final writes | **−2** vs 228. |
| **227** | Post-reconciliation report | `test/flowV3` + outbound guard (no mongoose on feat). |
| **Now** | Close-out + A-2/A-4 | Manifest **238** source names; suite **239** with **8** explicit G-2b skips. |

## P-2 — git-history attempt for the two missing names (228→226)

### Commits / refs inspected

| Ref | What it showed |
|---|---|
| `git log --diff-filter=D --name-only --all -- test/` | **Empty** — no tracked test-file deletions in history |
| `2069e3e` | First commit that introduced `test/flowV3/**`; manifest already **226** names |
| `1234c1d` | Adds `mongooseIndexSafety.test.js` (4 named tests) on PR 2 branch |
| `08ad31d` | G-2b multipart model/tests on PR 4 branch |
| `346e29c` | PR3 close-out (+12 named tests) |
| `git reflog` | Checkout/commit dance only; **no orphan commits** holding an intermediate `test/flowV3` tree between 218 and 226 |

### Outcome

**UNRECOVERABLE.** The −2 names never existed in a git object. The 218→228→226 window lived in an **untracked** working tree before `2069e3e`. There is nothing to `git show` or `git diff` for those two `test()` titles.

### Mitigation (closes the open question)

All **ten M-1 acceptance criteria** were re-proven from scratch against the consolidated tree (see [`FLOW-V3-R5-ACCEPTANCE.md`](FLOW-V3-R5-ACCEPTANCE.md)). The M-1 behavioural surface is covered regardless of what those two untracked tests asserted. Future deletions are gated by `flowV3Guards --check=manifest` + `FLOW_V3_MANIFEST_STRICT=1`.

## Named adds in close-out (A-2 / A-4)

### `allowlistExclusionComplete.test.js`

- every `LLM_BLOCKED_FIELDS` member is denied by `canLlmWriteField`
- every `LLM_BLOCKED_NESTED_PATHS` member is denied
- every `SYSTEM_WRITE_BLOCKED_FIELDS` member is LLM-denied and system-blocked
- exclusion set includes every required group H / I / Tier 3 / Tier 4 field
- writable-set snapshot matches `LLM_WRITABLE_FIELDS` (fails loudly on drift)
- blocked-set snapshot matches schema exports (fails loudly on drift)
- every writable field is intentional: known, not blocked, `canLlmWriteField` true
- fixture files exist on disk next to this suite

### `minorConsentWritePathGuard.test.js`

- `SYSTEM_WRITE_BLOCKED_FIELDS` covers `consentAt`, `consentVersion`, `isMinor`
- every write channel refuses those fields
- `validateProfilePatch` drops them on every channel
- no production `flowV3LLM` module calls `resolveIsMinor` while unwired
