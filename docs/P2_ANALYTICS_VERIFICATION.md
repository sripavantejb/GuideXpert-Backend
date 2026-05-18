# Priority-2 Analytics Normalization — Verification (A–J)

## A. Canonical model

- **Module:** `services/whatsappOpsCanonicalMetrics.js`
- **Schema:** `schemaVersion: 3`, `metricsMode: recipient_primary_v3`
- **Cohort anchor:** `booking_ist_slot_day` (submission slot date in IST, not `createdAt`)
- **Recipient key:** `{ lineageId, phone, messageKind }` per template; `{ phone }` for all-templates view
- **Delegation:** `whatsappOpsRecipientAnalytics.js` uses canonical rollup, funnel, exclusions, failure reasons

## B. Status precedence (mutually exclusive terminal bucket)

| Order | Bucket | Rule |
|-------|--------|------|
| 1 | `delivered` | `everDelivered` |
| 2 | `permanent_failed` | `finalPermanentFailed` (permanent pattern or exhausted, no delivery) |
| 3 | `reconcile_pending` | `anyReconcilePending` (`awaiting_final_dlr` grace) |
| 4 | `transient_unresolved` | `finalUnresolved` without permanent or reconcile |
| 5 | `excluded` | retry exclusion reason present |
| 6 | `in_flight` | in-flight statuses, not terminal |
| 7 | `other` | cohort edge (e.g. accepted-only) |

`read` is tracked in totals but does not displace the delivered bucket.

## C. Cross-day / range rules

- Range summary sums **per IST slot-day cohort** (`computeRecipientRangeSummary`).
- Same phone on two slot days = **two cohort rows** (intentional; not globally deduped).
- Month API primary series: `recipientTrendDays`; attempt rows under `diagnostic.attemptLevelDays`.

## D. Exclusion taxonomy (`OPS_EXCLUSION_TAXONOMY`)

Single mapper `toCanonicalExclusionReason()` used for:

- Day `exclusionBreakdown` (one reason per recipient, max priority)
- Unresolved list / recovery preview labels
- Export CSV `canonicalExclusionReason`

## E. Retry funnel reconciliation

- `retryFunnelByAttempt`: recipient-level flags per attempt
- `retryFunnelReconciliation`: bridges with `carriedForward`, `recoveredOnRetry`, `stillUnresolved`, `excluded`, `permanentFailed`
- Invariant checked in `waAnalyticsIntegrity.js`

## F. Recovery & exports

- `computeUnresolvedRecipients`: `cohortDate` / `cohortDateIso` scopes to slot-day; `reconciliation_pending` group; canonical bucket fields on rows
- `exportUnresolvedCsv`: `canonicalBucket`, `canonicalExclusionReason` columns
- `exportRecipientSummaryCsv`: one row per recipient for cohort day (optional operator export)

## G. Charts & UI

- Overview KPIs, month trend, failure reasons: **recipient-primary**
- Attempt `byStatus` / `byKind` and month `attempts`/`failed` lines: **diagnostic toggle only**
- `metricDefinitions` on API responses; in-page metrics glossary on Overview

## H. Integrity checks

- `utils/waAnalyticsIntegrity.js` → `validateRecipientAnalyticsInvariants()`
- Wired: day overview `integrityWarnings`; operational health `analyticsIntegrity`

## I. Edge cases (documented limitations)

1. All-templates view groups by phone only — one template’s delivery can mask another’s failure.
2. Raw `exportCsv?type=messages` remains event-grain (audit trail).
3. Recovery jobs in progress may briefly skew in-flight vs overview until webhooks land.
4. Range rollup loops day-by-day (N queries) — acceptable for current scale.

## J. Verdict

Operator-facing KPIs, funnels, charts, recovery lists, and canonical exports share **one recipient-primary model** aligned with V4 reconciliation semantics. Residual caveats above are exposed in API `metricDefinitions` and operator copy (no unqualified “Failed” — use **Permanent failed**, **Transient unresolved**, **Reconciliation pending**).

**Tests:** `node --test test/whatsappOps*.test.js test/waAnalyticsIntegrity.test.js`
