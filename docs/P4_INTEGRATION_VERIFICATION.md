# P4: Integration & Race-Condition Verification

Companion to [P3_HARDENING_VERIFICATION.md](./P3_HARDENING_VERIFICATION.md). Documents integration-test coverage, honest limits, and CI gates.

## A. Integration test matrix

| Suite | File | Invariants verified |
|-------|------|---------------------|
| Late webhook / reconcile | `test/integration/suites/lateWebhookReconcile.test.js` | Flows A–D: grace, late DLR, no promotion during grace, dedupe |
| Retry promotion | `test/integration/suites/retryPromotion.test.js` | Delay anchor, grace block, retry wall, provider failure bound |
| Cron overlap | `test/integration/suites/cronOverlap.test.js` | Parallel workers, lease reclaim, crash-after-claim recovery |
| Manual recovery overlap | `test/integration/suites/manualRecoveryOverlap.test.js` | Reconcile grace blocks preview/send |
| Durable jobs | `test/integration/suites/durableJobConsistency.test.js` | 3 jobs/booking, concurrent idempotency, no orphan events |
| Dispatch crash | `test/integration/suites/dispatchCrashRecovery.test.js` | after_claim / after_provider_accept / after_db_write |
| Expiration | `test/integration/suites/expiration.test.js` | skip expired, no dispatch |
| Analytics | `test/integration/suites/analyticsConsistency.test.js` | `validateRecipientAnalyticsInvariants` on real aggregations |
| Repair | `test/integration/suites/repairRecovery.test.js` | lifecycle repair monotonicity, no repair loops |
| Stress (gated) | `test/integration/stress/queueFairness.stress.test.js` | Backlog drain, no deadlock |

## B. Covered race conditions

- Overlapping cron `dispatchDueReminderJobs` (CAS claim + fair queue)
- Lease expiry reclaim after stuck `claimed`
- Crash after claim / after provider accept / after DB write
- Reconcile phase1 → grace → phase2 finalize vs late webhook
- Retry promotion vs `awaiting_final_dlr` (never during grace)
- Concurrent `ensureReminderJobsForSubmission` / E11000 upsert
- Webhook monotonic replay (duplicate delivery ignored)
- Manual recovery blocked during reconcile grace

## C. Remaining theoretically possible duplicate scenarios

| Scenario | Mitigation | Fully eliminated? |
|----------|------------|-------------------|
| Crash after Gupshup ACK, before `WhatsAppMessageEvent` write | Reservation + reclaim | **No** |
| External provider sends duplicate DLR / duplicate API accept | Webhook dedupe + monotonic status | **No** (provider-side) |
| Two Vercel cron invocations, both pass claim before either sets lease | CAS `findOneAndUpdate` | **Minimized**, not impossible under extreme clock skew |
| Lease TTL longer than overlap + missing release | TTL reclaim in `recoverStuckReminderJobs` | **Minimized** |

## D. Mathematically guaranteed (under test DB + stub provider)

- ≤1 `WhatsAppReminderJob` per `(formSubmissionId, messageKind)` when unique index applied
- ≤1 `WhatsAppMessageEvent` per `(retryGroupId, phone, attemptNumber)` for reserved attempts
- `awaiting_final_dlr` rows have `rowEligibleAtMs = ∞` (no retry promotion) while in that status
- Webhook status never regresses (monotonic rank)
- Job state rank never decreases via `applyJobStateMonotonic` / repair

## E. Operationally minimized (not mathematically impossible)

- Duplicate provider API calls on reclaim after crash-after-accept
- At-least-once dispatch across cron ticks
- Sub-minute scheduling precision (1m cron poll)

## F. Stress-test results

| Environment | `WA_STRESS_JOB_COUNT` | Expected runtime |
|-------------|----------------------|------------------|
| CI (`workflow_dispatch` / nightly job) | 500 | ~1–2 min |
| Local `WA_INTEGRATION_STRESS=1 WA_STRESS_JOB_COUNT=10000` | 10000 | ~5–15 min |

Run locally:

```bash
cd GuideXpert-Backend
npm run test:integration:stress
# or
WA_INTEGRATION_STRESS=1 WA_STRESS_JOB_COUNT=10000 npm run test:integration:stress
```

## G. Known distributed-system limitations

- Poll-based ~1m cron (not sub-minute precision)
- Vercel concurrent invocations possible
- Gupshup at-least-once webhooks and sends
- Integration tests use in-memory MongoDB + stub provider (`WA_INTEGRATION_STUB=1`), not live Gupshup

## H. Verdict

The platform is **integration-verified and regression-safe for V4** against the invariants in section A, with CI gates on `test:integration` and `test:integration:race`.

We **do not** claim exactly-once delivery or impossible duplicate sends from the external provider. See [P3_HARDENING_VERIFICATION.md](./P3_HARDENING_VERIFICATION.md) §I–J.

## Commands

```bash
cd GuideXpert-Backend
npm run test:integration          # all integration suites
npm run test:integration:race     # race-focused subset
npm run test:integration:reconcile
npm run test:whatsapp-all         # unit + integration
```

## Test harness

- `test/integration/harness/` — memory MongoDB, fake clock, env snapshot, crash hooks
- `WA_INTEGRATION_STUB=1` — deterministic Gupshup responses (no HTTP)
- `WA_TEST_CRASH_POINT` — `after_claim`, `before_send`, `after_provider_accept`, `after_db_write`
