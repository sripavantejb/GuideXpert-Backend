# Conversation Recovery — Production Readiness

**Product:** Conversation Recovery & Follow-up Engine  
**Version:** v1.0.0  
**Status:** Production Ready  

Platform Feature #1 is frozen at this version for counseling behavior. This document covers operational hardening around the certified recovery core.

## Certification

```bash
cd GuideXpert-Backend
node scripts/conversationRecoveryCertification.js
node --test test/conversationRecovery.test.js
```

Optional Phase 1–14 proof (engines untouched):

```bash
node scripts/phase1to14Regression.js
```

Certification asserts (core + ops):

- Eligibility gates unchanged (journey/booking/opt-out/inactivity/max attempts)
- Schedule intervals 24h / 72h / 168h
- Message copy by phase with **no booking URLs**
- Idempotency key format + already-processed skip
- Quiet hours / send window evaluation
- Campaign config ops fields (limit, windows)
- Health / alerts / audit / timeline / campaign / preview exports
- Admin ops routes present
- Guided-flow snapshot hook + orchestrator resume intercept
- Phase engines under `careerCounselling/` contain **no** recovery references

## Operational controls (no redeploy)

Admin → Conversation Recovery → Config:

- Enable / disable campaign
- Delay + retry interval + max attempts
- Quiet hours
- Send window
- Daily send limit

Persisted in `AppSettings` key `conversationRecoveryConfig`.

## Distributed safety

- Unique `{caseId, attemptNumber}`
- Unique partial `idempotencyKey` = `conversationId:conversation_recovery:attemptNumber`
- Atomic claim: `claimedAt: null` + `deliveryStatus: queued` + `sentAt: null`
- Skip if attempt already sent/delivered/read

## Ops surfaces

| Surface | Path |
|---------|------|
| Health | `/admin/conversation-recovery/health` · `GET /api/admin/conversation-recovery/health` |
| Alerts | `/alerts` |
| Audit | `/audit` · `GET /audit-logs` |
| Timeline | `GET /students/:id/timeline` |
| Bulk | `POST /bulk` |
| Campaign perf | `GET /campaign-performance` |
| Message preview | `POST /message-preview` |
| Trends | `GET /trends` |

## Freeze rule

Do **not** edit Phase 1–14 engines for recovery behavior. Platform service only. See `.cursor/rules/conversation-recovery-platform.mdc`.

See also: `CONVERSATION-RECOVERY-OPERATIONS-RUNBOOK.md`.
