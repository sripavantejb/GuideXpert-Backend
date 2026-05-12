# WhatsApp Ops recipient-based redesign

## Architecture (short)

- **Cohort**: IST calendar day of `FormSubmission.step3Data.slotDate` (slot day), joined from `WhatsAppMessageEvent` with phone/`createdAt` fallbacks when needed (`cohortFallbackCount` in API).
- **Lineage**: `lineageId = canonicalRetryGroupId || retryGroupId`; one recipient per `(messageKind, phone, lineageId)` in aggregates.
- **Retries**: `whatsappRetryOrchestrator` uses per-row `eligibleAtMs`, stale in-flight eligibility, campaign `isRetryableFailure`, `WhatsAppRetryGroup.nextPromotionDueAt`, cron time budget (`WHATSAPP_RETRY_CRON_BUDGET_MS`).
- **Webhooks / sends**: `gupshupWebhookController` and `safeSendWhatsApp` align permanent campaign failures with `RETRY_EXCLUSION_REASON.permanentFailure` and `terminalFailureKind`.
- **Manual recovery**: One `batchRetryGroupId` per job, `candidateLineage` snapshot, `isStillUnresolved(..., candidateCreatedAt)`, post-start counters (`delivered`, `failed`, `excluded`, …).
- **Snapshots**: `captureSnapshot` / `getLatestSnapshot` day+month payloads include `schemaVersion: 2` recipient blocks; Overview uses snapshots for **past** slot days when present.

## Verification checklist (A–J)

| ID | Check | How |
|----|--------|-----|
| A | Retry delay ordering | Unit: `getRetryDelayMsAfterAttempt`, `filterRetryPromotionRows` cooldown from `failedAt`. |
| B | Stale in-flight promotion | Orchestrator integration / staging: rows in `IN_FLIGHT_PROMOTION_STATUSES` older than `inFlightPromotionStaleMsForKind` appear in promotion candidates. |
| C | Permanent failure excluded from promotion | Campaign webhook `failed` with non-retryable text sets `retryEligible: false`; orchestrator skips. |
| D | No duplicate promotion | CAS `attempt2BatchId` / `attempt3BatchId` unchanged; `filterRetryPromotionRowsV2` duplicate phone exclusions. |
| E | Recipient rollup golden | Staging DB: known events → `computeRecipientDayOverview` totals vs hand count. |
| F | Manual recovery job | Start job with mocked `safeSendWhatsApp`; assert `candidateLineage`, `attemptNumber`, `canonicalRetryGroupId` on written events. |
| G | Snapshot read path | `GET /admin/whatsapp-ops/snapshots/latest?scope=day&date=…` returns `payload.schemaVersion === 2`. |
| H | Funnel stage counts | Compare Overview recipient funnel to aggregation export for a fixed date/kind. |
| I | Unresolved export | `GET .../unresolved/export` includes extended columns (`retriesAttempted`, `retryGroupId`, reasons). |
| J | `nextPromotionDueAt` | After promotion batch, open `WhatsAppRetryGroup` has `nextPromotionDueAt` ≈ batch end + `retryDelayMinutes`. |

## Manual QA

1. Capture day snapshot: `POST /admin/whatsapp-ops/snapshots/capture` with `scope=day`, `date`, optional `messageKind`.
2. Open Admin → WhatsApp Ops → Overview: pick a **past** date; confirm “Frozen snapshot” when snapshot exists, else live data.
3. Run manual recovery preview; confirm CSV columns include `lineageId`, `maxAttemptAtStart`.

## Env knobs (reference)

- `WHATSAPP_RETRY_CRON_BUDGET_MS` — promotion sweep budget.
- `WA_CAMPAIGN_INFLIGHT_STALE_MS` / `WA_SLOT_BOOKED_INFLIGHT_STALE_MS` — stale in-flight promotion.
- `WHATSAPP_RECOVERY_INFLIGHT_STALE_MINUTES` — manual recovery stale threshold.
