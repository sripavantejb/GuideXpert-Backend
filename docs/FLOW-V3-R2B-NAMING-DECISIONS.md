# Flow V3 R-2b naming decisions

`LEAD_PROFILE_CONTRACT.md` was not on disk at reconciliation time. Decisions
below treat [`flowV3LeadProfileSchema.js`](../constants/flowV3/flowV3LeadProfileSchema.js)
as authoritative — it was authored against that contract and carries the
load-time allowlist assertions.

## Write allowlist

**Winner:** schema-derived `LLM_BLOCKED_FIELDS` / `canLlmWriteField` on
`flowV3LeadProfileSchema.js`.

**Loser deleted:** `constants/flowV3/flowV3WriteAllowlist.js`.

### Tool-only names (24) — REMOVED from the LLM write surface

These appeared on the deleted hand-written allow list and are **not** schema
fields. The LLM cannot write them. If the attached contract later proves any
belong as V3-new fields, add them to the schema with an explicit freeze waiver.

| Tool name | Schema status | Decision |
|---|---|---|
| `schoolBoard` | live as `board` | rename → use `board` |
| `course` | absent | remove |
| `careerDirection` | nearest: `careerGoal` | remove (do not alias) |
| `learningStyle` | absent | remove |
| `workStyle` | absent | remove |
| `motivation` | absent | remove |
| `urgency` | absent | remove |
| `urgencyReason` | absent | remove |
| `commitmentLevel` | absent | remove |
| `priorAttempts` | nearest: `attemptNumber` | remove (do not alias) |
| `locationPreference` | nearest: `cityPref` | remove (do not alias) |
| `hostelNeeded` | nearest: `hostelPreference` | remove (do not alias) |
| `mustHave` | absent | remove |
| `dealBreakers` | absent | remove |
| `opennessToAlternatives` | absent | remove |
| `comparisonInterest` | absent | remove |
| `confidenceLevel` | absent | remove |
| `hesitationThemes` | nearest: `hesitations` | remove (do not alias) |
| `infoNeeds` | nearest: `concerns` | remove (do not alias) |
| `academicYear` | document root, not profile | remove from LLM patch |
| `conversationGoal` | conversation pin, not profile | remove from LLM patch |
| `openThreads` | conversation pin, not profile | remove from LLM patch |
| `promisedNext` | conversation pin, not profile | remove from LLM patch |
| `lastAsk` | conversation pin, not profile | remove from LLM patch |

### Schema fields the tool wrongly denied (34) — RESTORED

The schema already marks these `llmWritable: true`. With the tool preflight
now reading the schema, they are writable again (subject to capture meta):

`name`, `proxy`, `qualification`, `entryType`, `careerGoal`, `interests`,
`cityPref`, `scholarshipFlag`, `isParent`, `callbackNumber`, `concerns`,
`hesitations`, `conflict`, `altContact`, `board`, `boardState`, `medium`,
`targetAdmissionYear`, `attemptNumber`, `marks12Status`, `subjectStrengths`,
`mathComfort`, `codingExposure`, `goalClarity`, `dreamCollege`,
`higherStudyIntent`, `abroadIntent`, `decisionMakerPresent`, `advisorInfluence`,
`relocationWillingness`, `maxTravelHours`, `hostelPreference`,
`timelinePressure`, `competitorsMentioned`.

Note: `callbackNumber` / `altContact` / `name` remain Tier-2 contact fields —
writable by the schema flags today. If the attached contract later marks them
consent-gated, flip `llmWritable: false` on the schema (the load-time assertion
path already covers Tier 3/4 and group H/I).

## Staleness

**Winner:** schema `stale:'V'` → `VOLATILE_FIELDS`.

**Loser deleted:** `constants/flowV3/flowV3ProfileSchema.js` (hand-written
`VOLATILE_SLOTS` + `ACADEMIC_YEAR_BOUND_SLOTS`).

### Facade-only volatile names (11) — NO LONGER AGED OUT

None of these except `timelinePressure` exist on the schema. They are not
volatile because they are not fields:

`urgency`, `urgencyReason`, `commitmentLevel`, `confidenceLevel`, `objections`,
`hesitationThemes`, `infoNeeds`, `openThreads`, `promisedNext`, `lastAsk`,
`conversationGoal`.

(`objections` is a schema field but tagged `stale: null` — append-only history,
not aged out.)

### Schema-V fields now aged out (were silently immortal under the facade)

`timeline`, `examType`, `rank`, `percentile`, `category`, `gender`, `quota`,
`region`, `admissionType`, `predictedColleges`, `filtersUsed`, `isMinor`,
`attemptNumber`, `marks12Status`, `examResults`, plus `timelinePressure`
(the one overlap).

## Re-open if the contract lands

When `LEAD_PROFILE_CONTRACT.md` is attached, diff this file against §1 / §5.2
and open additive schema PRs for any name this list removed incorrectly.
Do not resurrect the hand-written allowlist or volatile list.
