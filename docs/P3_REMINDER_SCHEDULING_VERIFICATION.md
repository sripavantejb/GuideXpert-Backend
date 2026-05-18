# P3: Deterministic Reminder Scheduling — Verification

## A. Scope

| In scope | Out of scope (unchanged) |
|----------|--------------------------|
| `FormSubmission` + `save_step3` | `slot_booked` immediate send |
| Cron: `send-reminders`, `send-meetlinks`, `send-30min-reminders` | IIT counselling reminders |
| `WhatsAppReminderJob` durable queue | Retry orchestrator, webhooks, reconciliation |
| Job coverage in ops analytics | P2 recipient-primary event rollup |

## B. Scheduling intent (deterministic T−X)

At booking, `ensureReminderJobsForSubmission` upserts three jobs (`pre4hr`, `meet`, `30min`) with:

`scheduledSendAt = slotDate − offsetMs` (same env offsets as pre-P3: `WA_PRE4HR_OFFSET_MS`, meet/30min equivalents).

**Invariant:** For each registered booking with a valid future `step3Data.slotDate`, `booked === scheduledJobs` per cohort day/kind (ops `coverageGap → 0` after backfill).

## C. Execution (at-least-once dispatch)

Cron (every ~1 min) claims jobs where:

- `state === 'pending'`
- `scheduledSendAt <= now`
- claim lease expired

Late registration: `save_step3` calls `dispatchDueJobsForSubmission` for catch-up.

Dispatch still calls `getCampaignReminderEligibility` — **no send before** eligibility window.

## D. P1/P2 preservation

- `safeSendWhatsApp` + pre-created `retryGroupId` per job
- `retry-whatsapp` cron unchanged
- Webhook / reconcile monotonic rules unchanged
- `reminderSent` / `meetLinkSent` / `reminder30MinSent` remain WA-success-only
- P2 delivery KPIs still from `WhatsAppMessageEvent` rollup; jobs add scheduling coverage only

## E. Observability

- `reminderJobHealth` on operational health API
- `GET /whatsapp-ops/reminder-jobs/summary`
- WhatsApp Ops Overview: cohort flow shows `scheduledJobs`, `coverageGap`, `scheduledJobFunnel`
- WhatsApp Ops Cron: reminder job queue panel

## F. Backfill

```bash
cd GuideXpert-Backend
node scripts/backfillWhatsAppReminderJobs.js              # dry-run
node scripts/backfillWhatsAppReminderJobs.js --execute    # apply
```

Idempotent via unique index `{ formSubmissionId, messageKind }`.

## G. Hardening (final pass)

See [P3_HARDENING_VERIFICATION.md](./P3_HARDENING_VERIFICATION.md) for claim/lease protocol, fairness, expiration, lifecycle repair, storm caps, and honest duplicate-send limits.

## H. Tests

```bash
cd GuideXpert-Backend
node --test test/whatsappReminder*.test.js test/backfillWhatsAppReminderJobs.test.js test/whatsappOps*.test.js
```

Covers plan cases A–J (scheduler offsets, dispatcher due/claim semantics, analytics coverage, backfill idempotency stats, P2 rollup unchanged).

## I. Honest limits

| Topic | After P3 |
|-------|----------|
| Rolling-window permanent miss | **Solved** — pending until due or skipped |
| Sub-minute precision | **No** — poll-based ~1m cron |
| Exactly-once delivery | **No** — at-least-once with claim leases |
| Provider / invalid WhatsApp | Still blocks delivery (not a scheduling miss) |
| Serverless `maxDuration` | May cap jobs per tick (`WA_REMINDER_JOB_BATCH_LIMIT`) |
| IIT / non–FormSubmission | Excluded |

## Resolution claims

| Issue | Status |
|-------|--------|
| Rolling-window loss | Solved for GuideXpert campaign reminders |
| Low template population vs booked | Solved in metrics (`scheduledJobs` / `coverageGap`) |
| Early sends before T−X | Still prevented (`scheduledSendAt` + eligibility) |
| P2 analytics truthfulness | Preserved |
