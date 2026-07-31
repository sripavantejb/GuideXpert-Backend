# STATUS_AUDIT_2.md

Read-only audit of the actual repository state. Every number below was produced by running the
command in this session on 2026-07-31; nothing is quoted from a prior report. Where prior
assumptions and the tree disagree, the tree is reported.

```
├── Repo:            /Users/guidexper/GuideXpert/GuideXpert-Backend
├── Current branch:  main
├── HEAD:            c5fe0f7  fix(flow-v3): yield sticky V2 so live canary can remount
├── origin/main:     c5fe0f7  (in sync — main is pushed)
├── Date of audit:   2026-07-31 (Asia/Kolkata)
├── Working tree:    CLEAN — `git status --porcelain` count 0 in this worktree
└── Other worktrees: also clean (see §10); the PARENT repo one level up is dirty (see §10)
```

**Read this first:** the premises this audit was asked to verify ("main should contain no V3
code", "guidedFlowRegistry.js has no V3 entry", "CHATBOT_FLOW_V3_ENABLED wired nowhere") are
all stale. Flow V3 was merged to main on 2026-07-30 (commits `f7e27bb`, `bc9f322`, `c5fe0f7`)
and is **live in production right now** — `GET /api/health` on the Vercel deployment returns
`"flowV3": {"enabled": true, "mode": "live", "canaryPercent": 100}` (fetched during this
audit). Details in §2, §9, §12.

## 1. BRANCH INVENTORY

Method: `git branch -a -v`, `git branch --merged main`, `git branch -r --merged main`,
`git rev-list --left-right --count main...<branch>`. PR/CI state is NOT locally verifiable —
`gh` is not installed on this machine; the only PR evidence in git is merge-commit messages.

```
├── hotfix/crisis-escalation-handoff        1a31ef6 fix(chatbot): create crisis handoff tickets and keep the crisis lock across subflow expiry
│   ├── exists: local + origin
│   ├── merged into main: **NO** — the ONLY branch not merged (git branch --merged confirms;
│   │   `git cherry main` shows 1a31ef6 unapplied; test/crisisEscalationHotfix.test.js absent from HEAD)
│   ├── diffstat vs main: 5 files, +194 −1
│   │   (constants/chatbotStates.js, services/chatbot/botStateService.js,
│   │    services/chatbot/chatbotOrchestratorService.js, test/crisisEscalationHotfix.test.js,
│   │    docs/hotfixes/crisis-escalation-handoff-reason.md)
│   ├── branch tests run in its worktree THIS session: 9 pass / 0 fail
│   └── PR state: unverifiable locally (no gh); no merge commit for it exists anywhere
├── chore/mongoose-autoindex-safety         1234c1d
│   └── merged: YES, via 8627922 (2026-07-30 18:52) · main is 12 commits ahead, branch 0 ahead
├── feat/flow-v3-foundation                 5ec22b9 docs(flow-v3): contract diff, DO-NOT-BUILD test, A-5 history close
│   └── merged: YES, via f7e27bb (2026-07-30 18:52) · main 10 ahead, branch 0 ahead
├── fix/g2b-multipart-delivery              af8b6b7 docs(chatbot): G-2b B-1/B-2 audit
│   └── merged: YES, via dd94229 (2026-07-30 18:53) — a LOCAL merge commit, not a PR merge (§8)
├── hotfix/distress-turn-url-suppression    503f5d4
│   ├── EXISTS: local + origin (it was uncertain — it is real)
│   └── merged: YES, via GitHub PR #13 (merge commit 8ceace9, 2026-07-30 18:42) — full detail in §5
├── FLAGGED — not in the prior batch:
│   ├── feat/flow-v3-golive                 bc9f322 feat(flow-v3): ship M-2–M-6 pipeline behind kill switch
│   │   ├── local only (no origin/feat/flow-v3-golive); its commit IS on main (fast-forwarded/merged)
│   │   └── this branch is what put the full V3 LLM pipeline + registry wiring on main
│   └── origin/test                         ca4cb49 Update .gitignore (2026-01-29 — six months stale)
│       └── merged into main long ago; dead branch, unrelated to this batch
└── 12 older flow-v2-era branches (fix/exact-rithika-welcome-copy, feat/flow-v2-career-counselling, …)
    └── all merged into main; historical, no action implied by this audit
```

## 2. WHAT IS ACTUALLY ON MAIN

```
├── git log --oneline -10 main:
│   ├── c5fe0f7 fix(flow-v3): yield sticky V2 so live canary can remount
│   ├── bc9f322 feat(flow-v3): ship M-2–M-6 pipeline behind kill switch
│   ├── dd94229 Merge branch 'fix/g2b-multipart-delivery'
│   ├── f7e27bb Merge branch 'feat/flow-v3-foundation'
│   ├── 8627922 Merge branch 'chore/mongoose-autoindex-safety'
│   ├── 8ceace9 Merge pull request #13 from sripavantejb/hotfix/distress-turn-url-suppression
│   ├── af8b6b7 docs(chatbot): G-2b B-1/B-2 audit — distress URL and core-fork claims
│   ├── 5ec22b9 docs(flow-v3): contract diff, DO-NOT-BUILD test, A-5 history close
│   ├── 346e29c chore(flow-v3): PR3 close-out — allowlist-34, exclusion suite, guards
│   └── 503f5d4 fix(chatbot): suppress booking URLs on R7-T1 and interrupt-resume turns
├── V3 code on main: **YES — all of it.** ~40 files under services/chatbot/flowV3LLM/**,
│   constants/flowV3/**, models/FlowV3LeadProfile.js, models/FlowV3TurnLog.js, plus live wiring:
│   guidedFlowRegistry.js has a career_counselling_flow_v3 entry (line 62), guidedFlowProcessors.js
│   calls processFlowV3Turn, chatbotOrchestratorService.js + guidedFlowOrchestrator.js call
│   resolveFlowV3Routing. The "should be no" expectation is stale by one day of history.
├── crisis hotfix on main: **NO** — expected "yes, if merged"; it was never merged (§1)
├── autoIndex guard on main: **YES** — config/mongooseSafety.js is tracked at HEAD and
│   required from config/db.js line 1; test/mongooseIndexSafety.test.js present and green
└── git diff --stat f8135bd..HEAD -- services/chatbot/flowV2 services/chatbot/careerCounselling:
    ├── **NOT EMPTY** — the instruction said "must be empty regardless of what else changed":
    │   ├── services/chatbot/flowV2/flowV2Dispatcher.js        | 37 ±
    │   └── services/chatbot/flowV2/flowV2DistressUrlGuard.js  | 102 + (new file)
    ├── sole commit responsible: 503f5d4 — the distress-URL hotfix itself (P-5). The frozen
    │   path was changed BY the safety hotfix, not by V3 work. careerCounselling/** is untouched.
    └── note: scripts/ci/flowV3Guards.js "frozen paths" check compares against HEAD/merge-base,
        so it passes trivially on main; it does not enforce the f8135bd baseline used here.
```

## 3. TEST SUITE — RUN THIS SESSION, NOT QUOTED

All commands run with `env -u MONGODB_URI -u MONGO_URI FLOW_V3_REQUIRE_MONGO=1` (offline).

```
├── node --test test/flowV3/*.test.js test/flowV3/golden/*.test.js test/outboundDuplicateGuard.test.js
│   └── tests 260 · suites 69 · pass 260 · fail 0 · skipped 0 · 2.5s
│       (prior reports' 218/226/227/231 were snapshots of a narrower, shifting scope — see §6;
│        the manifest guard tracks 259 source names and passes)
├── node --test test/careerCounsellingJourney.test.js
│   └── tests 25 · pass 25 · fail 0
├── node --test test/counselingOrchestration.test.js
│   ├── tests 8 · pass 6 · **fail 2**
│   ├── failing: "journey entry returns orchestration + capped reply"
│   │        and "college predictor bridge intent and seed" (isCounselingBridgeIntent is not a function)
│   └── EXACTLY the same 2 as the recorded baseline — names match docs/KNOWN-FAILING-BASELINE.md
│       and scripts/ci/counselingBaselineAllowlist.js line-for-line. Count and identity unchanged.
├── FULL suite: node --test 'test/**/*.test.js'  (offline: no Mongo, no LLM keys, no Gupshup)
│   ├── main (c5fe0f7):      tests 2219 · pass 2061 · **fail 158** · 30s
│   ├── baseline (f8135bd) run under IDENTICAL conditions in a throwaway /tmp clone:
│   │                        tests 1951 · pass 1793 · **fail 158**
│   ├── failing-test-name sets diffed: **IDENTICAL** (193 unique ✖ lines, byte-for-byte match)
│   ├── conclusion: the whole 2026-07-30 batch added 268 tests, all passing, and introduced
│   │   ZERO new failures. The 158 are pre-existing and concentrated in suites needing live
│   │   infra or drifted fixtures: intentClassifierService (39), collegePredictorProduction-
│   │   Certification (12), iitCounsellingStrategyIntentRouting (11), permissionGateSingle-
│   │   Inbound (10), sticky-session/multilingual/scope-firewall orchestrator suites, etc.
│   └── nothing timed out; nothing silently skipped (skipped 0)
└── scripts/ci/flowV3Guards.js run this session: all guards pass
    (frozen-paths-vs-HEAD, pepper name, manifest 259 names, no test deletions, mongooseIndexSafety green)
```

## 4. THE 34-FIELD ALLOWLIST — INDEPENDENTLY RE-VERIFIED

```
├── list located: docs/FLOW-V3-ALLOWLIST-34.md (exists, 34 rows, dot-paths + group/tier/staleness)
├── independent programmatic check run this session (node -e against
│   constants/flowV3/flowV3LeadProfileSchema.js), for each of the 34:
│   ├── group ∉ {H, I, J, K, SYS}                       → all 34 pass
│   ├── tier ∉ {3, 4}                                   → all 34 pass
│   ├── not consentAt / consentVersion / isMinor        → all 34 pass
│   ├── not in LLM_BLOCKED_FIELDS                       → all 34 pass
│   └── canLlmWriteField(field).allowed === true        → all 34 pass
├── negative sanity probes — all correctly DENIED by canLlmWriteField:
│   consentAt, isMinor, leadStage, bookingStatus, crisisLocked, crisisHandoffId,
│   category, gender, accessibilityNeeds, firstGenerationCollege, genderConstraint
├── exclusion-set test: test/flowV3/allowlistExclusionComplete.test.js — exists, run this
│   session: 8 pass / 0 fail (covers blocked-fields, blocked nested paths, system-write-blocked,
│   required H/I/Tier-3/Tier-4 membership, and drift-detecting snapshots of both sets)
├── belt-and-braces: the schema module itself throws at load time if any of
│   consentAt/isMinor/leadStage/bookingStatus/crisisLocked/category/gender/accessibilityNeeds
│   leaks into the writable set (assertAllowlistContract IIFE, schema lines 870-895)
└── verdict: **confirmed clean — the prior "0 bugs" claim is correct.** Total LLM-writable
    fields: 78 (the 34 restored are a subset). One deliberate nuance, documented: name /
    callbackNumber / altContact are Tier-2 contact fields left writable pending a product
    decision on consent-gating (also flagged in FLOW-V3-CONTRACT-DIFF.md §4).
```

## 5. THE DISTRESS-URL HOTFIX (P-5) — IT EXISTS AND IS MERGED

```
├── branch exists: local YES · origin YES (hotfix/distress-turn-url-suppression @ 503f5d4)
├── merged into main: YES — via GitHub PR #13, merge commit 8ceace9, 2026-07-30 18:42 IST
├── diffstat (503f5d4~1..503f5d4): 4 files, +302 −15
│   ├── services/chatbot/flowV2/flowV2DistressUrlGuard.js  (new, 102 lines)
│   ├── services/chatbot/flowV2/flowV2Dispatcher.js        (37 lines changed)
│   ├── test/flowV2DistressUrlSuppression.test.js          (new, 145 lines)
│   └── docs/hotfixes/distress-turn-url-suppression.md
├── test asserting zero URLs on an R7-T1 turn: YES — run this session, 6 pass / 0 fail:
│   ├── "flowV2Dispatcher — R7-T1 distress turn never ships a booking URL"      PASS
│   ├── "flowV2Dispatcher — interrupt-resume never ships a booking URL as part 2+" PASS
│   └── empathy reply delivery is asserted in the same suite (reply present, URL stripped)
└── ordering constraint vs fix/g2b-multipart-delivery:
    ├── on main, the ordering HELD: distress merged 18:42 (8ceace9), g2b merged 18:53 (dd94229)
    ├── BUT it held by sequence, not by enforcement:
    │   ├── 503f5d4 is NOT an ancestor of the g2b branch tip (git merge-base --is-ancestor: no)
    │   ├── g2b was merged via a local merge commit, so there was no PR body to carry the
    │   │   "blocked on distress hotfix" disclosure (§8)
    │   └── no CI check encodes the ordering (flow-v3-foundation.yml runs guards + suites only)
    └── the question "is g2b mergeable without the hotfix landing first" is now moot — both are
        on main in the safe order — but the enforcement the instruction asked for never existed.
```

## 6. A-5 TEST-DELTA RESOLUTION

```
├── was the 218→228→226 (−2) delta named? — the git-history search WAS performed and is
│   recorded in docs/FLOW-V3-TEST-DELTA.md (on main):
│   ├── git log --diff-filter=D --all -- test/  → empty (no tracked test deletions, re-confirmed
│   │   independently this session by flowV3Guards "no test/ deletions" passing)
│   ├── 2069e3e (first commit introducing test/flowV3) already carried 226 names
│   └── git reflog → no orphan commits holding an intermediate 218/228 tree
├── resolution: **UNRECOVERABLE, and honestly documented as such** — the two missing test
│   titles only ever existed in an UNTRACKED working tree before the first commit; there is
│   no git object to name them from. No commit removed them; they were never committed.
└── fallback mitigation recorded: YES — all ten M-1 acceptance criteria re-proven from scratch
    (docs/FLOW-V3-R5-ACCEPTANCE.md, referenced from the delta doc), and future silent deletions
    are gated by flowV3Guards manifest check (259 names, strict mode available).
```

## 7. LEAD_PROFILE_CONTRACT.md STATUS

```
├── present in docs/: YES — docs/LEAD_PROFILE_CONTRACT.md (19,499 bytes, tracked on main)
├── docs/FLOW-V3-CONTRACT-DIFF.md produced against it: YES (A-6 is unblocked). It finds:
│   ├── §3 DO-NOT-BUILD: clean — no banned field patterns; enforced by a load-time throw in the
│   │   schema AND by test/flowV3/contractDoNotBuild.test.js
│   ├── all four type-conflict resolutions (parentConstraintsList, collegeOfInterestList,
│   │   coreInterest derived-bool, goalPriority[0] scalar): MATCH as designed
│   ├── one real divergence to track: contract table says isMinor is "derived from
│   │   passingYear/qualification"; code (flowV3MinorPolicy) FORBIDS that derivation and
│   │   defaults conservatively to true until stated age. Code is stricter; diff doc says keep
│   │   code, amend contract wording later (product/legal)
│   └── one optional product decision: Tier-2 contact fields (name/callbackNumber/altContact)
│       are LLM-writable pending consent-copy; freeze them if product wants consent-gating first
└── nothing downstream silently assumed a different contract: the schema header documents each
    resolution in place, and the exclusion suite pins the writable/blocked sets by snapshot.
```

## 8. PR 4 (G-2b) — CURRENT STATE

```
├── open / draft / unopened: **NEVER OPENED as a PR.** The branch was merged straight into
│   main with a local merge commit (dd94229) and pushed. gh is not installed, but the git
│   evidence is conclusive: PR-merge commits in this repo say "Merge pull request #N from …"
│   (see 8ceace9); dd94229 says only "Merge branch 'fix/g2b-multipart-delivery'".
├── the three required PR-body disclosures were therefore never presented for review:
│   ├── "blocked on the distress-URL hotfix" — moot in outcome (distress merged 11 minutes
│   │   earlier), but the gate was never surfaced anywhere reviewable
│   ├── "blocked on product sign-off for 5 core-fork claims" — **this gate was BYPASSED.**
│   │   docs/G2B-SECOND-BUBBLE-AUDIT.md (on main) explicitly records: parts 2-3 ship five
│   │   factual/comparative claims with zero defaultApplied owners, and "product sign-off …
│   │   remains the Branch 4 merge gate". The branch merged anyway, sign-off unrecorded.
│   └── "already-live inert index" note — exists only inside the audit doc, not in any PR
└── has anything merged it: YES — it is on main (dd94229) and pushed to origin/main. There is
    no release branch in this repo; main is the deploy branch (Vercel deploys from it).
```

## 9. CONFIG / ENV STATE

```
├── .env.example — all five requested vars present, uncommented, safe defaults, plus two more:
│   ├── CHATBOT_FLOW_V3_ENABLED=0          (line 336)
│   ├── CHATBOT_FLOW_V3_MODE=shadow        (line 339)
│   ├── CHATBOT_FLOW_V3_CANARY_PERCENT=0   (line 342)
│   ├── FLOW_V3_PHONE_HASH_PEPPER=         (line 345)
│   ├── FLOW_V3_DEFAULT_BOOKING_SERVICE=   (line 347)
│   ├── FLOW_V3_REQUIRE_MONGO=0            (line 349)
│   └── ALLOW_REMOTE_AUTO_INDEX=0          (line 351)
└── "is CHATBOT_FLOW_V3_ENABLED referenced anywhere that would make it live if flipped?
    (should be: nowhere yet, since guidedFlowRegistry.js has no V3 entry)"
    ├── **the premise is FALSE on today's main.** guidedFlowRegistry.js HAS a full V3 entry
    │   (career_counselling_flow_v3, line 62). The flag is read by flowV3Rollout.js, which is
    │   called from chatbotOrchestratorService.js, guidedFlowProcessors.js AND
    │   guidedFlowOrchestrator.js. Flipping it makes V3 live. 
    ├── **and it IS flipped, in production, right now:** GET https://guide-xpert-backend.vercel.app/api/health
    │   (fetched during this audit) → "flowV3": {"enabled": true, "mode": "live", "canaryPercent": 100}
    └── the local untracked .env mirrors this (ENABLED/MODE/CANARY set, pepper set,
        FLOW_V3_DEFAULT_BOOKING_SERVICE empty locally; production has it set to one_on_one)
```

## 10. UNACCOUNTED FILES / STATE

```
├── worktrees (git worktree list — three exist):
│   ├── /Users/guidexper/GuideXpert/GuideXpert-Backend            main @ c5fe0f7 — CLEAN (0 dirty)
│   │   └── needed: yes (primary)
│   ├── /Users/guidexper/GuideXpert-crisis-hotfix                 hotfix/crisis-escalation-handoff @ 1a31ef6 — CLEAN
│   │   └── needed: yes, until the crisis branch is merged (it is the one outstanding branch)
│   └── /Users/guidexper/GuideXpert/GuideXpert-Backend-g2b-audit  fix/g2b-multipart-delivery @ af8b6b7 — CLEAN
│       └── needed: no — its branch is fully merged; removable via `git worktree remove`
├── nothing untracked or modified-but-uncommitted in ANY of the three backend worktrees
└── FLAGGED — the PARENT repo /Users/guidexper/GuideXpert (a separate git repo that tracks
    GuideXpert-Backend as a gitlink/submodule pointer, mode 160000) is dirty:
    ├──  M GuideXpert-Backend        — pointer recorded at acdadc0 but the subrepo is at c5fe0f7
    │                                  (five merges' worth of drift, uncommitted at parent level)
    ├── ?? .github/workflows/flow-v3-foundation.yml — a stray COPY of the CI workflow at the
    │                                  parent root; the real one is committed inside the backend repo
    └── ?? GuideXpert-Backend-g2b-audit/ — the worktree directory, untracked by the parent repo
```

## 11. OPEN DECISIONS D-1..D-7

```
├── PRELIMINARY FINDING: no architecture doc containing "§14" or the D-1..D-7 labels exists
│   anywhere in this tree (rg across all *.md in all worktrees: zero hits). The decision
│   register lived outside the repo. Each item below is therefore assessed against CODE.
├── D-1 (LLM provider)      — **resolved in code, unrecorded.** services/ai/providers/
│   OpenAiCompatibleProvider.js is on main; provider is whatever LLM_BASE_URL/LLM_MODEL point
│   at (production currently targets an NVIDIA-hosted OpenAI-compatible endpoint and is
│   serving live traffic). No decision record in the tree.
├── D-2 (JSON mode)         — **resolved in code.** llmLoop.js forces
│   response_format {type:"json_object"} on the final envelope pass, with parse/repair ladder.
├── D-3 (pricing claim)     — **partially addressed, decision unrecorded.** system_prompt.v1.md
│   line 50 forbids inventing free/paid claims beyond existing product copy; no product
│   decision document exists.
├── D-4 (multilingual)      — **still open.** Zero language handling in the V3 prompt,
│   dispatcher, or buildTurnContext (rg for language/telugu/hindi in flowV3 paths: no hits).
├── D-5 (firewall default)  — **resolved in code.** gateChain G-SCOPE denies policy/
│   prompt-injection categories unconditionally; production health shows scopeFirewall
│   enforceMode: true, shadowMode: false.
├── D-6 (booking serviceKey)— **resolved by config, not by decision.** flowV3BookingConfig
│   keeps the deterministic profile→serviceKey map EMPTY by design and returns
│   {needs:['serviceKey']} unless FLOW_V3_DEFAULT_BOOKING_SERVICE is set; production sets it
│   to one_on_one. The "single funnel-wide default" product decision itself is unrecorded.
└── D-7 (catalog editorial/paid · counsellor core-engineering coverage) — **still open.**
    getCuratedCatalog serves Phase-5 CURATED_MODERN_CATALOG only; no editorial/paid marker
    and no counsellor-coverage decision anywhere in code or docs.
```

## 12. HEADLINE SUMMARY

```
├── SAFE TO MERGE RIGHT NOW, NO CAVEATS:
│   └── hotfix/crisis-escalation-handoff (1a31ef6) — the only unmerged branch. Clean +194/−1
│       diff, its 9 tests pass (run this session), it touches nothing V3. Until it lands,
│       production is missing the crisis-handoff-ticket + crisis-lock-persistence fix, which
│       is a safety gap given V3 is live.
├── BLOCKED, AND ON WHAT:
│   ├── nothing is mechanically blocked — everything else already merged AND deployed
│   ├── outstanding product/legal items (not code): D-4 multilingual, D-7 catalog/counsellor
│   │   coverage, consent-disclosure copy (isMinor/consentAt remain write-blocked until then),
│   │   and retroactive product sign-off for the 5 core-fork claims G-2b shipped without it
│   └── FlowV3TurnLog audit-trail verification in production: a smoke test on 2026-07-30
│       delivered a live V3 reply but the corresponding turn-log document was not found by the
│       polling query — unconfirmed whether write or query was at fault; worth a targeted check
├── SINGLE MOST IMPORTANT DISCREPANCY:
│   └── **This audit's own premises describe a repo one day in the past.** Flow V3 is not
│       "foundation-only, dark, unwired": it is fully merged to main, pushed, and LIVE in
│       production at 100% canary (health endpoint verified during this audit). Every control
│       question in §2/§9 that "should be no" is yes. Second place: G-2b merged to main via a
│       local merge with no PR, bypassing its own recorded product-sign-off merge gate (§8).
└── SHORTEST PATH:
    ├── (a) "PR 1-3 all on main" — ALREADY DONE (autoindex 8627922, foundation f7e27bb,
    │       distress 8ceace9; plus g2b dd94229 and the go-live pair bc9f322/c5fe0f7).
    │       The one real step remaining is merging hotfix/crisis-escalation-handoff.
    └── (b) "a working D-1/D-2 decision unblocking M-2" — M-2 is not blocked; it shipped and
            is serving production traffic. D-1/D-2 are decided de facto by the code
            (OpenAI-compatible env-configured provider + json_object envelope). What is missing
            is a one-page decision record committing those choices, so the next audit does not
            have to reverse-engineer them from llmLoop.js again.
```
