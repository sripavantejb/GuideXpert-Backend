# Known failing baseline (pre-existing, not Flow V3)

Documented so a third failure in this file still breaks the build, while these
two are not mistaken for damage from Flow V3 work.

## File

`test/counselingOrchestration.test.js`

## Failures allow-listed by name

| # | Test name | Error | Cause |
|---|---|---|---|
| 1 | `journey entry returns orchestration + capped reply` | `assert.ok(r.orchestration)` is falsy | Pre-existing orchestration shape drift; unrelated to Flow V3. |
| 2 | `college predictor bridge intent and seed` | `TypeError: isCounselingBridgeIntent is not a function` | The test imports `isCounselingBridgeIntent` from the service; it is **exported nowhere**. |

## Proof (captured 2026-07-30 against `main` HEAD `f8135bd`, before any Flow V3 registration)

```
node --test test/counselingOrchestration.test.js
ℹ tests 8
ℹ pass 6
ℹ fail 2

✖ journey entry returns orchestration + capped reply
  AssertionError: assert.ok(r.orchestration)

✖ college predictor bridge intent and seed
  TypeError: isCounselingBridgeIntent is not a function
```

## Policy (B-4)

- Do **not** fix `isCounselingBridgeIntent` as part of Flow V3.
- Do **not** edit the test or the service for this.
- CI may allow-list these two names only. A third failure in the same file fails the build.
