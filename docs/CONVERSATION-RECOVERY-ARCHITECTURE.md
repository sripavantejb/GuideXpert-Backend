# Conversation Recovery Architecture

Platform Feature #1 — Conversation Recovery & Follow-up Engine.

## Purpose

Recover students who abandon an in-progress AI counseling journey after inactivity (24h / 72h / 7d), restore **exact** journey state on reply, and expose operations metrics in Admin — without modifying Phases 1–14 counseling engines.

## Non-goals

- No Phase 15 / counseling logic changes
- No booking reminders, CRM writes, or counselor auto-assignment (Assign Human is a thin handoff wrapper only)
- Not the same as WhatsApp Ops “manual recovery” (that recovers failed DLR delivery)

## Architecture

```
Student WhatsApp
  → ConversationMonitor (snapshots + lastActivityAt)
  → RecoveryEligibilityEngine
  → RecoveryScheduler (cron)
  → RecoveryMessageGenerator (phase-bucket copy)
  → Gupshup template send
  → DLR → ConversationRecoveryAttempt
  → Student reply → ResumeEngine → Frozen AI Engine (Phases 1–14)
  → Admin Recovery Dashboard
```

## Why snapshots are mandatory

| Today | Recovery need |
|-------|----------------|
| Journey in `WhatsAppBotState.context.careerCounselling` | Multi-day follow-up |
| `SUBFLOW_TTL_MS = 30m` wipes idle state | Exact phase/profile must survive |
| Session WhatsApp window ~24h | Recovery uses Gupshup **templates** |

Platform owns snapshots + restore. Phases 1–14 stay read-only consumers after hydrate.

## Package layout

`GuideXpert-Backend/services/conversationRecovery/`

| Module | Role |
|--------|------|
| `conversationRecoveryConfig.js` | Intervals, maxAttempts, feature flag, template env |
| `conversationRecoveryCore.js` | Pure eligibility + phase mapping |
| `conversationRecoverySnapshotService.js` | Upsert after counselling turns |
| `conversationRecoveryEngine.js` | Scan + schedule cases/attempts |
| `conversationRecoveryScheduler.js` | Claim due attempts + cron entry |
| `conversationRecoveryMessageGenerator.js` | Personalized copy (no booking URLs) |
| `conversationRecoveryDeliveryService.js` | Template send + DLR apply |
| `conversationRecoveryResumeService.js` | Inbound hydrate before TTL wipe |
| `conversationRecoveryAggregates.js` | Dashboard KPIs |
| `conversationRecoveryAnalytics.js` | Platform analytics events |

## Models

- `ConversationRecoverySnapshot` — durable journey blob + flags
- `ConversationRecoveryCase` — one case per phone/conversation
- `ConversationRecoveryAttempt` — attempt lifecycle + Gupshup IDs

## Wiring points (platform only)

1. **Snapshot:** `guidedFlowProcessors.processCareerCounsellingTurn` after `handleCareerCounsellingMessage`
2. **Resume:** `chatbotOrchestratorService` before TTL → `main_menu` reset
3. **Cron:** `GET/POST /api/cron/conversation-recovery` (+ Vercel every 15m)
4. **DLR:** `gupshupWebhookController` → `applyDeliveryStatusToAttempt`
5. **Admin:** `/api/admin/conversation-recovery/*` + FE `/admin/conversation-recovery`

## Eligibility (all required)

- `journeyCompleted == false`
- `bookingCompleted == false`
- `optedOut == false`
- Inactive past next interval threshold
- `attemptCount < maxAttempts`

## Resume

On inbound, if case is `awaiting_reply` (or recovered but bot state lost), load snapshot `journeyBlob` into `context.careerCounselling`, transition to `career_counselling_v2`, mark `recovered`. Opt-out phrases stop the case.

## Config

Env:

- `CONVERSATION_RECOVERY_ENABLED` (default on unless `false`)
- `GUPSHUP_TEMPLATE_CONVERSATION_RECOVERY`

Admin overrides (intervals / maxAttempts / featureEnabled) persist in `AppSettings` key `conversationRecoveryConfig`.
