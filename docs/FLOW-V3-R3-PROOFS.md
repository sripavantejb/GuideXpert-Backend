# Flow V3 R-3 proofs (B-1..B-7)

Captured after R-2 consolidation. Suite command:

```bash
env -u MONGODB_URI -u MONGO_URI FLOW_V3_REQUIRE_MONGO=1 node --test test/flowV3/*.test.js
```

## B-1 Pepper test is environment-independent — VERIFIED, no code change

[`test/flowV3/profilePhoneHash.test.js`](../test/flowV3/profilePhoneHash.test.js) saves
`FLOW_V3_PHONE_HASH_PEPPER`, deletes it in `before`, restores in `after`, and the
one test that sets it restores in a `finally`. No other test under `test/flowV3/**`
asserts on ambient `process.env` without controlling it.

## B-2 phoneHash required flag — VERIFIED, no code change

[`models/FlowV3TurnLog.js`](../models/FlowV3TurnLog.js): `phoneHash: { required: false, default: null }`.
Covered by `phoneHash is optional so a missing pepper cannot lose the whole turn log`.

## B-3 Missing-pepper behaviour — FIXED / strengthened

Asserts in `profileFoundation.test.js`:
- field omitted (`phoneHash: null`, `omitted: true`)
- ERROR logged **once** per process (latch)
- raw number never appears in any log line
- health check `healthy: false` with `"fatal":false` in the log payload
- `process.exitCode` remains undefined (process does not exit)

## B-4 isCounselingBridgeIntent — DOCUMENTED ONLY

See [`KNOWN-FAILING-BASELINE.md`](./KNOWN-FAILING-BASELINE.md). Not fixed.

## B-5 Tier 3 / Tier 4 withholding — RE-VERIFIED post-consolidation

[`test/flowV3/gatesAndContext.test.js`](../test/flowV3/gatesAndContext.test.js):
- category/gender ABSENT on an ordinary turn (rest of profile intact)
- present for `cutoff_computation` and `s1_demographic_gate`
- absent for an unrecognised purpose
- Tier 4 withheld even on a purpose that unlocks Tier 3

## B-6 Load-time allowlist assertions — RE-VERIFIED

`assertAllowlistContract` IIFE still in `flowV3LeadProfileSchema.js`. Test asserts
`examResults.category` / `.gender` blocked via `canLlmWriteField` and that the
throwing IIFE source is still present.

## B-7 Idle-survival must not silently skip — FIXED

[`durableProfileIdle.test.js`](../test/flowV3/durableProfileIdle.test.js) now
starts its own `mongodb-memory-server`. It never reads `MONGODB_URI` /
`MONGO_URI`, so it cannot write to the production cluster and cannot skip.
