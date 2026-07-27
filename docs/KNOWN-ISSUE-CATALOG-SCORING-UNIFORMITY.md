# Known issue: curated new-age catalog scoring is uniform across all 10 colleges

**Status:** Open. Not a hypothetical — this is live production behavior today.
**Severity:** Medium. Shortlist ordering for a real, currently-shipping student flow is effectively arbitrary once you look past a single ad-hoc keyword heuristic.
**Filed:** 2026-07-27, during Flow v2 Phase 6 (B5/B6) build. Flow v2 is a separate, unreleased chatbot track — you do not need any context about it to understand or fix this ticket.

## What's broken

`services/chatbot/careerCounselling/careerCounsellingV2RecommendationMatrix.js` scores colleges against a student profile using 9 weighted dimensions (`RECOMMENDATION_WEIGHTS` in `constants/careerCounsellingV2Shortlisting.js`): course match, career-goal alignment, evaluation priorities, learning-style fit, budget fit, location fit, career-priority signal, parent constraints, concern mitigation.

For the **curated new-age college catalog** (`CURATED_MODERN_CATALOG` in `constants/careerCounsellingV2ExploreModernColleges.js` — Plaksha, Scaler SoT, Newton SoT, Kalvium, NIAT, Masters' Union, Krea, Ahmedabad University, UPES, SRM AP), this scoring is used via `careerCounsellingV2ShortlistingEngine.js`'s `generateFromCuratedCatalog()`, which converts the catalog into the matrix's expected input shape via a private helper, `curatedCatalogAsColleges()`:

```javascript
function curatedCatalogAsColleges(_profile = {}) {
  return CURATED_MODERN_CATALOG.map((item) => ({
    college_name: item.name,
    college_address: '',
    district_enum: '',
    ...
    branches: [{ branch_name: 'Computer Science / Emerging Tech', branch_code: 'CSE', fee: null, cutoff: null }],
  }));
}
```

Every college gets a **blank address, a null fee, and the exact same generic branch name**. Because of this, most of the matrix's scoring dimensions can never actually differentiate between colleges for the same student — they produce the same score for every one of the 10 colleges, every time.

### Reproduction

```bash
cd GuideXpert-Backend
node -e "
const { scoreEligibleColleges } = require('./services/chatbot/careerCounselling/careerCounsellingV2RecommendationMatrix');
const { CURATED_MODERN_CATALOG } = require('./constants/careerCounsellingV2ExploreModernColleges');

const colleges = CURATED_MODERN_CATALOG.map((item) => ({
  college_name: item.name, college_address: '', district_enum: '',
  branches: [{ branch_name: 'Computer Science / Emerging Tech', branch_code: 'CSE', fee: null, cutoff: null }],
}));

const profile = { preferredCourse: 'B.Tech Engineering', careerGoal: 'software career', careerPriority: 'placements', budgetPreference: '3 lakhs', preferredLocation: 'Hyderabad' };
const scored = scoreEligibleColleges(colleges, profile);
console.log([...new Set(scored.map(s => s.matchScore))]);
"
# => [ 0.656 ]   (one single value — every one of the 10 colleges ties exactly)
```

The only thing that currently breaks this tie — including giving NIAT its edge over the other 9 — is a separate, small, **private/unexported** tag-matching heuristic, `justifiedCuratedBoost()`, also in `careerCounsellingV2ShortlistingEngine.js`. It adds up to +0.2 based on whether the student's free-text profile signals mention words matching a college's static `tags` array (e.g. `projects`, `industry`, `mentoring`), plus a NIAT-specific +0.1 when AI/project/industry language is present.

## Why it matters

`generateFromCuratedCatalog()` is not a fallback path or an edge case — it is **the actual, currently-running production code path** for every counseling student who reaches Stage 7 "AI Shortlisting" without an exam + rank on file (i.e., anyone who didn't come in through the College Predictor bridge). This is a large fraction of real counseling conversations today.

Practical consequence: the 9-dimension, carefully-weighted `RECOMMENDATION_WEIGHTS` matrix is, for this catalog, mostly decorative. The real "ranking logic" for these 10 colleges is a ~15-line keyword-matching function that:
- is not covered by any dedicated test file for its scoring behavior specifically,
- is not exported, so nothing outside this one file can inspect, reuse, or independently verify it,
- silently degrades to a stable-sort-order tie (i.e., whatever order `CURATED_MODERN_CATALOG` happens to declare colleges in) for any student whose profile text doesn't happen to contain one of the matched keywords.

If `justifiedCuratedBoost()` is ever removed, refactored incorrectly, or its regexes stop matching (e.g. because unrelated wording elsewhere changes what ends up in `profile.evaluationPriorities`/`studentPriorities`/`biggestConcerns`), shortlist ordering quietly reverts to catalog-declaration order for every student, with no error, no test failure, and no visible signal that personalization stopped working.

## Suggested direction (not prescriptive)

Give the catalog real, differentiated data per college — at minimum approximate fee bands and city/region, and, if branch-level differentiation is ever needed, real per-college branch offerings — so the matrix's own weighted dimensions (budget fit, location fit, course match) can differentiate colleges on their actual merits instead of relying entirely on keyword-tag matching as a substitute for real scoring data.

A smaller, lower-effort mitigation: promote `justifiedCuratedBoost()` (and its tag-matching helper) to a properly tested, exported, documented function in its own right, since it is — in practice — the primary scoring signal for this catalog today, not a minor tie-breaker.

## Note for whoever picks this up

The unreleased Flow v2 chatbot track has, as of this ticket's filing date, written its own small local duplicate of `curatedCatalogAsColleges()` and `justifiedCuratedBoost()` inside `services/chatbot/flowV2/nodes/b5Shortlist.js`, specifically because those two helpers are private/unexported in `careerCounsellingV2ShortlistingEngine.js` and Flow v2 is not permitted to modify existing `careerCounsellingV2*.js` files. If this ticket is fixed by changing the scoring/adapter approach, please check whether `b5Shortlist.js`'s local copy should be updated (or ideally unified with the fix) at the same time, so the two call sites don't drift further apart.
