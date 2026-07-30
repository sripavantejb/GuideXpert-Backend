# Flow V3 — the 34 restored LLM-writable fields (A-1)

**Branch:** `feat/flow-v3-foundation`  
**Schema:** [`constants/flowV3/flowV3LeadProfileSchema.js`](../constants/flowV3/flowV3LeadProfileSchema.js)  
**Context:** R-2b replaced a hand-written tool allowlist with the schema-derived
`canLlmWriteField`. That restored 34 fields the tool had wrongly denied even
though the schema already marked them `llmWritable: true`. Widening the LLM
write surface is only safe if none of those fields sit in the exclusion set.

## Exclusion set (must not appear)

- Group H — engagement metrics (code-computed)
- Group I — funnel / crisis state (code-owned)
- Groups J / K / SYS — code-owned artefacts and system fields
- `consentAt` · `consentVersion` · `isMinor`
- All Tier 3 fields (`category`, `gender`, `genderConstraint`, `firstGenerationCollege`, …)
- All Tier 4 fields (`accessibilityNeeds`, `crisisLocked`, `crisisHandoffId`, …)

## Verdict

**Bugs found: 0.** Every field below is outside the exclusion set, has
`llmWritable: true`, and `canLlmWriteField(path).allowed === true`. No reverts.

## The 34

| # | Field (dot-path) | Group | Tier | Stale | Why LLM write is safe |
|---|---|---|---|---|---|
| 1 | `name` | A | 2 | S | Stated identity content |
| 2 | `proxy` | A | 1 | S | Who is chatting (content) |
| 3 | `isParent` | A | 1 | S | Role flag stated by the student/parent |
| 4 | `callbackNumber` | A | 2 | S | Contact content (Tier 2; not consent-gated in schema today) |
| 5 | `altContact` | A | 2 | S | Contact content (same as above) |
| 6 | `qualification` | B | 1 | S | Academic slot — student-stated |
| 7 | `entryType` | B | 1 | S | Academic slot |
| 8 | `board` | B | 1 | S | Academic slot |
| 9 | `boardState` | B | 1 | S | Academic slot |
| 10 | `medium` | B | 1 | S | Academic slot |
| 11 | `targetAdmissionYear` | B | 1 | S | Academic slot |
| 12 | `attemptNumber` | B | 1 | V | Academic slot |
| 13 | `marks12Status` | B | 1 | V | Academic slot |
| 14 | `subjectStrengths` | B | 1 | F | Academic preferences |
| 15 | `mathComfort` | B | 1 | F | Academic preferences |
| 16 | `codingExposure` | B | 1 | F | Academic preferences |
| 17 | `careerGoal` | D | 1 | F | Goals content |
| 18 | `interests` | D | 1 | F | Goals content |
| 19 | `goalClarity` | D | 1 | F | Goals content |
| 20 | `dreamCollege` | D | 1 | F | Goals content |
| 21 | `higherStudyIntent` | D | 1 | F | Goals content |
| 22 | `abroadIntent` | D | 1 | F | Goals content |
| 23 | `conflict` | E | 2 | F | Decision-unit content |
| 24 | `decisionMakerPresent` | E | 1 | — | Decision-unit content |
| 25 | `advisorInfluence` | E | 1 | F | Decision-unit content |
| 26 | `cityPref` | F | 1 | F | Logistics content |
| 27 | `scholarshipFlag` | F | 1 | F | Logistics content |
| 28 | `relocationWillingness` | F | 1 | F | Logistics content |
| 29 | `maxTravelHours` | F | 1 | F | Logistics content |
| 30 | `hostelPreference` | F | 1 | F | Logistics content |
| 31 | `timelinePressure` | F | 1 | V | Logistics content — not funnel `leadStage` |
| 32 | `concerns` | G | 1 | F | Objection content |
| 33 | `hesitations` | G | 1 | F | Objection content |
| 34 | `competitorsMentioned` | G | 1 | — | Competitor/objection content |

## Cross-check method

```js
for (const field of THE_34) {
  assert(!['H','I','J','K','SYS'].includes(getFieldGroup(field)));
  assert(getFieldTier(field) !== 3 && getFieldTier(field) !== 4);
  assert(!['consentAt','consentVersion','isMinor'].includes(field));
  assert(!LLM_BLOCKED_FIELDS.includes(field));
  assert(isLlmWritableField(field) === true);
  assert(canLlmWriteField(field).allowed === true);
}
```

## Notes

- `callbackNumber` / `altContact` / `name` are Tier-2 contact fields. If product
  later marks them consent-gated, flip `llmWritable: false` on the schema; the
  load-time allowlist IIFE already covers Tier 3/4 and groups H/I.
- `timelinePressure` is group F (logistics), not group I (funnel). It must not be
  confused with `leadStage` / `bookingStatus`.
