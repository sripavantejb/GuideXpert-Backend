# P3 Hardening — Verification (Final Pass)

Companion to [P3_REMINDER_SCHEDULING_VERIFICATION.md](./P3_REMINDER_SCHEDULING_VERIFICATION.md). This documents production-hardening guarantees and honest limits.

## A. DB uniqueness guarantees

**Index:** unique `{ formSubmissionId: 1, messageKind: 1 }` on `WhatsAppReminderJob`.

**Writer behavior:** `upsertReminderJob` in [`whatsappReminderScheduler.js`](../services/whatsappReminderScheduler.js) catches Mongo `E11000` and retries with a non-upsert update.

**Ops script:** `node scripts/ensureWhatsAppReminderJobUniqueIndex.js [--execute]` dedupes legacy rows before index enforcement.

**Guaranteed:** At most one job document per submission per template kind after index is applied.

## B. Claim / lease protocol

| Field | Purpose |
|-------|---------|
| `claimedAt`, `claimedBy` | Audit who claimed |
| `claimToken` | Worker identity (cronRunId) |
| `leaseExpiresAt` / `claimedUntil` | Lease expiry (both set) |
| `dispatching` | In-flight send state |

**CAS claim filter:** pending+due with free lease OR `claimed`/`dispatching` with expired lease.

**Release:** `releaseJobClaim(jobId, claimToken)` only if token matches.

**Reclaim:** Expired lease rows are claimable again (fixes crash-after-claim stuck state).

## C. Dispatch ordering (fairness)

Per cron tick, `computeFairClaimLimits(limit)`:

- Default **80%** overdue (`scheduledSendAt <= now - overdueSlaMs`)
- **20%** fresh-due (within SLA window)

Sort within each bucket: `scheduledSendAt` ascending.

**Within tick:** fresh jobs receive a guaranteed minimum share. **Across ticks:** oldest overdue still drains first.

## D. Expiration semantics

| Kind | `expiresAt` |
|------|-------------|
| pre4hr | slot start |
| meet | slot start |
| 30min | slot + `WA_30MIN_EXPIRE_GRACE_MS` (default 15m) |

`expireDueReminderJobs` → `state: skipped`, `suppressionReason: expired`. No dispatch; visible in ops as **Expired** count.

## E. Lifecycle synchronization

[`whatsappReminderJobLifecycle.js`](../services/whatsappReminderJobLifecycle.js):

- Monotonic `JOB_STATE_RANK`
- `syncReminderJobFromRetryGroup` promotes jobs when events exist (including from `pending`/`claimed`/`dispatching`)
- Links `initialMessageEventId`, `rootMessageEventId`, `providerMessageId`

Webhook + `safeSendWhatsApp` call sync after writes (unchanged entry points via [`whatsappReminderJobSync.js`](../services/whatsappReminderJobSync.js)).

## F. Orphan repair

`repairReminderJobLifecycle` + `recoverStuckReminderJobs` run at cron start/end (bounded).

**Ops API:** `POST /whatsapp-ops/reminder-jobs/repair` (super-admin).

Health exposes `lifecycleMismatch.*` counts.

## G. Storm protection

| Env | Default | Effect |
|-----|---------|--------|
| `WA_REMINDER_JOB_BATCH_LIMIT` | 500 | Max claims per tick |
| `WA_REMINDER_JOB_MAX_DISPATCH_PER_RUN` | batch limit | Max executions |
| `WA_REMINDER_JOB_INTER_SEND_DELAY_MS` | 0 | Throttle between sends |

Cron stats: `backlogDepth`, `catchUpMode`, `fairSplit`, `oldestOverdueMs`, `dispatchThroughput`.

**Guarantee:** Non-expired jobs dispatch eventually over multiple ticks, not necessarily one tick.

## H. Stuck recovery

`recoverStuckReminderJobs`: expired `claimed`/`dispatching` → `pending` or sync to `dispatched` if attempt-1 event exists.

## I. Remaining distributed-system limits

- **Poll-based cron (~1m)** — not sub-minute scheduling precision
- **Vercel overlap** — two invocations can run; mitigated by CAS claim + event reservation
- **Provider duplicates** — Gupshup may accept duplicate API calls if crash between ACK and DB
- **Network partition** — lease expiry eventually recovers; brief window of duplicate attempt possible

## J. Duplicate-send probability (honest)

| Layer | Guarantee |
|-------|-----------|
| Job row | ≤1 per (submission, kind) |
| Event row | ≤1 attempt-1 per (retryGroupId, phone) via unique index + reservation |
| Active worker | ≤1 per job when `claimToken` guards honored |

**Theoretically still possible:** crash after provider accepts message but before `WhatsAppMessageEvent` insert; provider-side duplicate; lease TTL longer than cron overlap with buggy release. **Not claimed as impossible.**

## Auditability

`GET /whatsapp-ops/recipients/timeline?formSubmissionId=|phone=` — merged booking, jobs, events, webhooks.

## Tests

```bash
cd GuideXpert-Backend
npm run test:whatsapp-reminder-hardening
```
