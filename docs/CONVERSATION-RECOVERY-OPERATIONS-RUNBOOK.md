# Conversation Recovery — Operations Runbook (v1.0.0)

## Service identity

- Cron: `GET/POST /api/cron/conversation-recovery` (Vercel every 15m)
- Admin: `/admin/conversation-recovery`
- Template env: `GUPSHUP_TEMPLATE_CONVERSATION_RECOVERY`
- Kill switch: Admin Config → disable campaign, or `CONVERSATION_RECOVERY_ENABLED=false`

## Daily checks

1. Open **Health** — scheduler status healthy; queue not growing unbounded.
2. Open **Alerts** — resolve critical (template missing, scheduler stale, high failure).
3. Spot-check **Students** delivery timeline for a recovered case.
4. Confirm **Audit** shows only expected admin actions.

## Common incidents

### Scheduler stale

- Verify cron secret + Vercel cron path `/api/cron/conversation-recovery`.
- Manually hit cron with secret.
- Check `ConversationRecoverySchedulerRun` latest row.

### Template missing / rejected

- Set `GUPSHUP_TEMPLATE_CONVERSATION_RECOVERY`.
- Ensure template params match `[firstName, topic]`.
- Failures classify as `template_missing` / `template_rejected`.

### Queue backlog

- Raise daily send limit if capped.
- Confirm send window / quiet hours not blocking all day.
- Check Gupshup rate limits (`rate_limit` failures).

### Duplicate sends suspected

- Inspect attempt `idempotencyKey` uniqueness.
- Confirm claim fields (`claimedAt`, `claimToken`) set before send.
- Already-processed attempts should skip with `skipped: true`.

### Student reply did not resume

- Confirm case status `awaiting_reply` or recovered with wiped bot state.
- Snapshot must exist with `journeyBlob`.
- Opt-out phrases stop recovery (`STOP`, etc.).

## Admin actions (all audited)

| Action | Effect |
|--------|--------|
| Retry | Queue next attempt immediately |
| Pause / Resume | Pause flag + status |
| Stop | Terminal stop; no further sends |
| Bulk retry failed | Reschedule cases with failed attempts |
| Assign human | Create handoff + pause case |

Always confirm in UI before destructive actions.

## Version freeze

Conversation Recovery & Follow-up Engine **v1.0.0 — Production Ready**.  
Do not change certified eligibility, resume hydration semantics, or Phase 1–14 engines without a new versioned iteration.
