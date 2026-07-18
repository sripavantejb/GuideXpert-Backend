# Phase 11 — Final Decision Hesitation Resolution

**Engine version:** `PHASE11_ENGINE_VERSION = v1.1.0`  
**Status:** **FROZEN** — [PHASE-11-PRODUCTION-BASELINE.md](./PHASE-11-PRODUCTION-BASELINE.md)  
**Plan:** [PHASE-11-IMPLEMENTATION-PLAN.md](./PHASE-11-IMPLEMENTATION-PLAN.md)

## Role

Resolve **final decision hesitation** after Phase 9 synthesis and Phase 10 Future Path Vision.

Identify hesitation → one personalized deterministic reply → confidence check → exit toward Phase 12 (stub: existing counseling invitation until Phase 12 ships).

## Must / Must not

| Must | Must not |
|------|----------|
| Identify hesitation via Phase 11 taxonomy | Restart Phase 7 |
| Personalized, empathetic reply (profile + Best Match anchor) | Compare / re-rank colleges |
| Confirm confidence (Yes / one optional second pass) | Regenerate recommendations |
| Additive state only (`phase11*`) | Replay Future Path Vision |
| Deterministic (no LLM) | Default-path counseling pitch |

## Taxonomy

- `decision_uncertainty`
- `parent_alignment`
- `wrong_choice_fear`
- `academic_manageability`
- `fit_confidence`

## One-on-One escalation (exceptional)

Not the default path. After confidence confirmation (or on explicit expert request), a deterministic check may recommend:

`https://www.guidexpert.co.in/one-on-one-session`

Escalate when thresholds are met (repeated unresolved hesitation, multiple distinct/simultaneous concerns, repeated reassurance, beyond deterministic capacity, or explicit expert request). Never escalate after a single resolved hesitation / ready fast path.

## State machine

```
phase_10_future_path_vision
        ↓ continue
phase_11_final_decision_hesitation
  hesitation_ask
    ├─ No / Ready  → exit (no escalate)
    ├─ Expert request → hesitation_escalation (One-on-One URL)
    └─ hesitation → hesitation_confirm
         ├─ Yes → escalate check → invitation stub OR escalation
         └─ No  → hesitation_second (max one) → escalate check
hesitation_escalation  [optional One-on-One form only]
        ↓ non-escalate exit
counseling_invitation   [stub until Phase 12]
```

## Files

| Area | Path |
|------|------|
| Constants | `constants/careerCounsellingV2FinalDecisionHesitation.js` |
| Core | `services/chatbot/careerCounselling/careerCounsellingV2FinalDecisionHesitationCore.js` |
| Parser | `services/chatbot/careerCounselling/careerCounsellingV2FinalDecisionHesitationParser.js` |
| Engine | `services/chatbot/careerCounselling/careerCounsellingV2FinalDecisionHesitationEngine.js` |
| Cert | `scripts/phase11ProductionCertification.js` |
| Baseline | `docs/PHASE-11-PRODUCTION-BASELINE.md` |

## Certification

```bash
node --test test/careerCounsellingJourney.test.js
node scripts/phase9ProductionCertification.js
node scripts/phase10ProductionCertification.js
node scripts/phase11ProductionCertification.js
```

## Next

**Do not implement Phase 12** until explicit approval.  
Related (also frozen under Phase 11 baseline): [NIAT-INTEREST-ONE-ON-ONE.md](./NIAT-INTEREST-ONE-ON-ONE.md)
