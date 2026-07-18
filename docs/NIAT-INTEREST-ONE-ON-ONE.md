# NIAT Interest → One-on-One Counseling

**Status:** **FROZEN** (Phase 11 production baseline v1.1.0)  
**Funnel:** `source: niat_interest` (separate from `source: phase11_hesitation`)  
**Baseline:** [PHASE-11-PRODUCTION-BASELINE.md](./PHASE-11-PRODUCTION-BASELINE.md)

## Role

When a student shows **explicit** NIAT join / admission / apply interest, immediately recommend an optional One-on-One Counseling Session.

Not:

- Phase 11 hesitation / objection escalation  
- Triggered by mere NIAT mentions or comparisons  

## Official URL

https://www.guidexpert.co.in/one-on-one-session

## Detector

Deterministic patterns only (no LLM). Requires NIAT mention **plus** interest/admission/join/apply intent. Blocks informational (“What is NIAT?”) and comparison (“NIAT vs …”) phrasing.

## Messaging

Focus on profile evaluation, admission guidance, eligibility, academic pathway, and personalized counseling. Do **not** reuse the hesitation-escalation narrative.

## Analytics (frozen)

| Event | Purpose |
|-------|---------|
| `niat_interest_detected` | Explicit interest observed |
| `one_on_one_recommended` | OOO form shared (`source: niat_interest`) |
| `niat_one_on_one_link_clicked` | NIAT click alias when available |
| `one_on_one_form_submitted` | Form submit when integration available (`source: niat_interest`) |

## Certification

```bash
node scripts/niatInterestOneOnOneCertification.js
node --test test/careerCounsellingJourney.test.js
```
