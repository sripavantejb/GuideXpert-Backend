# Flow V3 — contract diff (A-6)

**Contract (spec, not edited):** [`LEAD_PROFILE_CONTRACT.md`](LEAD_PROFILE_CONTRACT.md)  
**Schema (implementation):** [`constants/flowV3/flowV3LeadProfileSchema.js`](../constants/flowV3/flowV3LeadProfileSchema.js)  
**Date:** 2026-07-30  
**Branch:** `feat/flow-v3-foundation`

Findings only. Divergences propose additive schema changes where needed — **the contract is not edited**.

---

## §3 DO NOT BUILD

Contract forbids fields resembling: inferred personality / emotional state,
persuasion susceptibility, urgency responsiveness, inferred caste / class,
estimated family income.

| Check | Result |
|---|---|
| Schema keys matching `EXCLUDED_FIELD_NAME_PATTERNS` | **None** (load-time IIFE already throws) |
| Explicit examples (`desperation_score`, `easily_pressured`, `anxiety_*`, `caste_*`, `estimated_income`, …) | **Absent** |
| Regression test | [`test/flowV3/contractDoNotBuild.test.js`](../test/flowV3/contractDoNotBuild.test.js) |

No additive schema change required for §3.

---

## Four type-conflict resolutions

| Contract intent | Schema | Status |
|---|---|---|
| `parentConstraints` string **+** `parentConstraintsList[]` | Both present; list `companionFor: 'parentConstraints'`; legacy string `mirrorOwned` | **MATCH** |
| `collegeOfInterest` string **+** `collegeOfInterestList[]` | Both present; same companion/mirror pattern | **MATCH** |
| `coreInterest` boolean sense **derived** (not a second stored bool competing with string) | Stored as legacy **string**; `deriveCoreInterest()` exposes bool at read time (`flowV3ProfileDerived.js`) | **MATCH** (resolution documented in schema header) |
| `goalPriority` scalar sense **derived** from array | Stored as **array**; `getGoalPriorityScalar()` / `goalPriority[0]` | **MATCH** |

---

## Material divergences (contract vs schema)

| Area | Contract | Schema today | Proposal (additive only — do not edit contract) |
|---|---|---|---|
| `isMinor` derivation | Table A: “sys, derived from `passingYear`/`qualification`” | `flowV3MinorPolicy` **forbids** passingYear/targetAdmissionYear derivation; conservative default `true` until stated age; writes system-blocked | Keep schema/policy. Treat contract table wording as stale vs §3 OPEN / DPDP note — product/legal should amend the contract later (out of scope here). |
| Proxy shape | `isProxy` + `proxyRelation` | Also retains legacy `proxy` (string) for Flow V2 | Keep `proxy` (legacy extend). No rename. |
| Field count | Contract body lists the V3 shape; “extends 75-slot LEAD_PROFILE_SCHEMA” | **167** keys (legacy Flow V2 slots + V3-new + companions + funnel/crisis) | Expected by §5 “EXTEND, DO NOT REPLACE”. Not a bug. |
| LLM writability of Tier-2 contacts (`name`, `callbackNumber`, `altContact`) | Sens 2 identity; not listed as LLM-blocked in §3 | `llmWritable: true` today | Optional freeze: set `llmWritable: false` if product wants consent-gated contact writes before disclosure copy lands. |
| `isMinor` sensitivity | Tier 3 | Tier 3 + `systemWriteBlocked` | **MATCH** on tier; write lock is stricter than the table alone. |
| Tool-only names removed in R-2b (`urgency`, `motivation`, …) | Some appear in older tool drafts / not as contract table rows | Absent from schema (correct) | Do not re-add. |

---

## Group / tier / staleness / LLM writability (spot checks)

Sampled contract table rows against `getFieldDef`:

| Field | Contract sens/stale | Schema | LLM writable |
|---|---|---|---|
| `qualification` | 1 / S | 1 / S | true |
| `category` | Tier 3 | sens 3, group | **false** |
| `accessibilityNeeds` | Tier 4 | sens 4 | **false** |
| `leadStage` | funnel | group I | **false** |
| `turnCount` | engagement H | group H | **false** |
| `budget` / stated budget fields | Tier 2 identity | present as logistics/budget slots | true where content |
| `consentAt` / `consentVersion` | sys | `systemWriteBlocked` | **false** |

No group H/I or Tier 3/4 field is LLM-writable (covered by allowlist exclusion suite).

---

## Summary

1. **§3 DO NOT BUILD:** clean + tested.  
2. **Four type conflicts:** all resolved as designed.  
3. **Real divergence to track:** `isMinor` derivation wording in the contract table vs the safer non-passingYear policy in code — do **not** change code to match the table.  
4. **Optional product decision:** Tier-2 contact LLM writability before consent copy exists.
