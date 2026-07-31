# INCIDENT-V3-ROOT-CAUSE.md

Read-only history reconstruction, 2026-07-31 ~12:55 IST. Sources: git history (all branches),
Vercel CLI metadata, the agent-session transcript stored on this machine, and direct code
reads. Companion evidence file: `docs/INCIDENT-V3-LIVE-WINDOW.md`. Nothing was fixed.

## 1. Step 4 — how the registry entry and canary=100 happened

### 1a. The `guidedFlowRegistry.js` V3 entry

```
├── added by exactly one commit: bc9f322c82810e10a1ef95f900432340046a5832
│   ├── date:    2026-07-30 19:01:08 IST
│   ├── author:  GuideXper <guidexper@GuideXpers-Mac-mini.local>  (the workspace machine account)
│   ├── trailer: Co-authored-by: Cursor <cursoragent@cursor.com>  — written in an AI agent session
│   ├── subject: "feat(flow-v3): ship M-2–M-6 pipeline behind kill switch"
│   └── body:    "…so Flow V3 can take traffic without flipping CHATBOT_FLOW_V3_ENABLED by default."
├── branch: authored on local branch feat/flow-v3-golive, landed on main as a DIRECT push
│   (no merge commit, no PR — contrast: the distress hotfix went through GitHub PR #13)
└── feat/flow-v3-foundation is CLEAN of it: the foundation branch tip (5ec22b9) predates
    bc9f322 and never touched guidedFlowRegistry.js — `git log -- guidedFlowRegistry.js`
    shows bc9f322 as the only commit in its history that added the entry. The constraint
    "foundation must have no registry entry" was honored; the entry arrived via the
    separate go-live commit.
```

### 1b. Where canaryPercent became 100

```
├── NOT in any commit. The code default is 0 (flowV3Rollout.js getCanaryPercent returns 0
│   for unset/non-finite), and .env.example ships CHATBOT_FLOW_V3_CANARY_PERCENT=0.
├── it was a RUNTIME CONFIG FLIP with no code change: three Vercel production env vars
│   (CHATBOT_FLOW_V3_ENABLED=1, CHATBOT_FLOW_V3_MODE=live, CHATBOT_FLOW_V3_CANARY_PERCENT=100)
│   were created via the Vercel CLI ~19:30 IST on 2026-07-30 (the pre-incident vars listed
│   as "17h ago" at 12:35 IST Jul 31, moments before this session replaced them), followed
│   by production redeploys (Vercel user: sripavantejb).
├── who/what did it: the Cursor agent session recorded in this workspace's transcript
│   (agent-transcripts/c880bdcf-e76e-4a1f-9297-5d08d978db43). The transcript contains the
│   operator instruction "make it live and push to main" and 10 references to
│   CHATBOT_FLOW_V3_CANARY_PERCENT. The flip was executed by the agent in response to that
│   instruction, from this machine, same evening as bc9f322.
└── so: registry entry = one reviewed-by-nobody commit; canary=100 = a config write that
    left NO trace in git at all. Only the Vercel audit trail (env var timestamps, deploy
    user) records it.
```

### 1c. Was there a PR / review?

```
├── bc9f322 (pipeline + registry) — direct push to main. No PR. No review.
├── c5fe0f7 (sticky-V2 yield so the live canary could capture existing conversations,
│   +/api/health flowV3 status) — direct push to main, 19:35:36 IST, 34 minutes later.
│   Note what this commit is: the canary initially "looked dead" because existing V2
│   conversations were sticky, so a second change was made to let live V3 TAKE OVER
│   mid-conversation V2 sessions. That widened exposure by design.
├── the three same-evening merges (8627922 autoindex, f7e27bb foundation, dd94229 g2b)
│   — local merge commits, no PRs.
└── the ONLY change in the batch that went through a PR: hotfix/distress-turn-url-suppression
    (GitHub PR #13, merge 8ceace9).
```

### 1d. Does the wiring match M-5 (shadow mode), or skip straight to serving?

```
├── a real shadow mode EXISTS in the code: guidedFlowProcessors.maybeRunFlowV3Shadow()
│   runs the V3 dispatcher dark alongside V2 (mode:'shadow'), never sends the reply
│   (deliveryStatus 'shadow_only', shadowOnly:true), and V2 still answers the student.
│   flowV3Rollout defaults MODE to shadow when enabled. The M-5 design is implemented.
├── but it was NEVER exercised in production: the first-ever enablement set
│   CHATBOT_FLOW_V3_MODE=live + canary 100 in the same moment (~19:30 IST Jul 30).
│   Production went from off → live-at-100%, skipping the shadow phase entirely.
└── aggravating factor: even if shadow HAD been run first, its only output is turn logs —
    and the turn-log write has never succeeded in production (§3a below), so a shadow
    phase would have produced zero observable signal anyway.
```

## 2. Step 4b — reconciling artifacts nobody has a record of

Every artifact below traces to the SAME single commit. None is unexplained in git terms;
what is missing is any report/decision record outside git.

```
├── llmLoop:            services/chatbot/flowV3LLM/llm/llmLoop.js (211 lines)
│   └── entire history: bc9f322, 2026-07-30 19:01 IST, feat/flow-v3-golive → main direct.
│       Never existed on feat/flow-v3-foundation.
├── validateEnvelope:   services/chatbot/flowV3LLM/validate/validateEnvelope.js (177 lines)
├── fallbackLadder:     services/chatbot/flowV3LLM/validate/fallbackLadder.js (64 lines)
│   └── both: entire history = bc9f322, same commit, same session.
├── LLM provider actually called in production:
│   ├── call path: llmLoop → OpenAiCompatibleProvider.chatCompletion →
│   │   `new OpenAI({ apiKey: LLM_API_KEY, baseURL: LLM_BASE_URL })` →
│   │   `client.chat.completions.create({ model: process.env.LLM_MODEL, … })`
│   ├── real strings (workspace .env; the production copies are stored as Sensitive in
│   │   Vercel and cannot be read back, but the prior session's live probe against the
│   │   production endpoint succeeded with the same config):
│   │   LLM_BASE_URL = https://integrate.api.nvidia.com/v1
│   │   LLM_MODEL    = openai/gpt-oss-20b        (NVIDIA NIM hosting an OpenAI-OSS model)
│   └── WHO decided D-1: nobody, explicitly. The NVIDIA provider config predates V3 by
│       eight weeks — commit e6e188c, 2026-06-04, "Add Phase 4 Sprint 1 NVIDIA LLM via
│       knowledge assistant". bc9f322 extended that existing provider (+69 lines: tool
│       calls, response_format) and V3 inherited the knowledge-assistant's endpoint/model
│       by reuse. D-1 was decided by defaulting, not by decision.
├── prompts/system_prompt.v1.md — authored by a person or generated?
│   ├── created in bc9f322, author GuideXper + Co-authored-by: Cursor — i.e. GENERATED in
│   │   the agent session, not separately authored/signed off by product.
│   ├── contradiction on record: promptLoader.js's own header says the prompt "is
│   │   student-facing copy and is owned by product… never a silently invented default" —
│   │   the file's provenance violates the module's stated ownership rule.
│   └── content vs the M-4 shape: it DOES match — "## Hard rules (never violate)" (10 rules
│       incl. grounding rule 2 and no-invented-URLs rule 8), the JSON reply envelope with
│       parts/profile_patch/grounding/booking_url_slot, tool contract, WhatsApp limits.
│       Live evidence agrees: the shipped LLM replies were plain slot questions with no
│       URLs/colleges/numbers (see live-window doc §5).
└── COMBINED TIMELINE (all IST, 2026-07-30 unless noted):
    ├── Jun 04        e6e188c — NVIDIA provider added for knowledge assistant (pre-V3)
    ├── ~18:42        PR #13 merged (distress hotfix)
    ├── 18:52–18:53   foundation / autoindex / g2b merged to main (local merges)
    ├── 18:53:10      production deploy bnzhy2sve (pre-pipeline)
    ├── 19:01:08      bc9f322 — registry entry + llmLoop + validator + fallback + prompt
    │                 + rollout, ONE commit, direct to main
    ├── ~19:30        Vercel env flip: ENABLED=1 / MODE=live / CANARY=100 (no commit)
    ├── 19:35:36      c5fe0f7 — sticky-V2 yield (widens live capture), direct to main
    ├── 19:35:53      production deploy llawaup7k — the live-window deployment
    ├── 19:42–19:49   the only V3 traffic ever (owner's test number, 4 replies, 2× "true")
    └── Jul 31 12:29  kill-switch deploy (this session)
    → ONE coordinated session, sequential steps, single build — NOT multiple uncoordinated
      sessions. The gap is not in git; it is that none of it was reported to or signed off
      by the project owner outside that session.
```

**Unresolved items (stated per instructions, not guessed):**

```
├── the exact runtime failure mode of the turn-log write (§3a lists the two candidates the
│   code supports; zero documents + zero error output means it cannot be pinned further
│   without a controlled write test, which was out of scope for a read-only task)
└── nothing else — every artifact's origin resolved to bc9f322 / the agent session.
```

## 3. Step 4c — the two live defects, swept across the V3 tree (DOCUMENT ONLY)

### 3a. Silently swallowed errors (`.catch(() => {})` and equivalents)

The turn-log write failure is hidden by THREE stacked layers:

```
├── layer 1 — turnLog.js:57-59: writeTurnLog wraps everything in try/catch and RETURNS
│   { ok:false, error } instead of throwing ("never throws to caller" by design)
├── layer 2 — both call sites DISCARD that return value
├── layer 3 — both call sites are FLOATING PROMISES (no await) with .catch(() => {}):
│   ├── flowV3Dispatcher.js:83 → :96   writeTurnLog(...).catch(() => {})   [gate-terminated turns]
│   └── flowV3Dispatcher.js:208 → :232 writeTurnLog(...).catch(() => {})   [main turn log]
└── consequence on Vercel serverless: the response returns while the insert is still
    in flight; the container freezes and the write dies. This mechanism requires no error
    at all and is consistent with the observed ZERO documents ever + zero error output.
    Secondary candidate visible in code: turnLog.js:18 returns
    { ok:false, error:'conversationId_required' } silently if the in-memory inbound object
    lacked conversationId at call time (the STORED inbound docs do have it).
```

Complete sweep of other error-swallowing sites under `services/chatbot/flowV3LLM/**`
(classified; the fully-silent ones are the finding):

```
├── FULLY SILENT (no log, no propagation, no marker):
│   ├── flowV3Dispatcher.js:96   — turn log (gate path), as above
│   ├── flowV3Dispatcher.js:232  — turn log (main path), as above
│   ├── fallbackLadder.js:22-24  — nextFlowV3Slot() failure → slot=null → silently degrades
│   │   the fallback from Tier A (re-ask slot) to Tier B/C (holding reply / static ack)
│   ├── rollingSummary.js:80-82  — summary build failure → summary=null, no trace
│   ├── flowV3SlotMeta.js:218-220 — catch → return false, no trace
│   ├── llmLoop.js:91-93         — tool-call JSON.parse failure → args={} — the tool then
│   │   RUNS with empty arguments instead of the turn being flagged
│   └── promptLoader.js:49-51    — unreadable prompts dir → returns [] (partially mitigated:
│       loadPrompt itself then throws PromptNotFoundError)
├── CAUGHT BUT SURFACED (not defects of this class):
│   ├── flowV3Dispatcher.js:110-112 (context error → recorded), :137-139 (LLM error → reason
│   │   feeds fallback), :185-187 (regen failure → fallback reason 'regen_failed')
│   ├── buildTurnContext.js:93-95 — missing prompt marked { missing:true, error } explicitly
│   ├── parseEnvelope.js:23-25 — deliberate brace-slice JSON repair, by design
│   ├── profile/index.js:155+ and flowV3ProfileStore.js:96-98 — CAS/duplicate-key handling
│   │   with explicit reasons / rethrow
│   └── guidedFlowProcessors.js shadow paths — console.warn (visible in logs)
└── net: the turn log is NOT the only safety signal that can vanish silently — fallback-tier
    selection (fallbackLadder:22), tool-call arguments (llmLoop:91), and the rolling summary
    (rollingSummary:80) can all degrade with zero trace.
```

### 3b. The truthy-`||` boolean-shortcut class (`slot.askable || template`)

```
├── the original: fallbackLadder.js:27-29 —
│       const ask = slot.askable || `Quick check — can you share your …?`
│   `askable` in LEAD_PROFILE_SCHEMA is a BOOLEAN flag (schema line: `askable: true`), not
│   copy. Boolean true short-circuits the template → replyText: true → shipped as "true".
│   Reproduced this session: runFallbackLadder({profile:{}}) → { tier:'A', replyText: true }.
│   This is the ONLY use of `askable` as reply copy in the ladder — the identical bug does
│   not repeat elsewhere in fallbackLadder.js.
├── the SAME CLASS (non-string silently coerced to a string instead of rejected) exists in
│   the envelope path, and is what let "true" pass every downstream check:
│   ├── validateEnvelope.js:21 (collectBodies) — `if (part.body) bodies.push(String(part.body))`
│   │   validation COERCES a non-string body rather than rejecting it; there is no
│   │   `typeof part.body === 'string'` check anywhere in validateEnvelope.js
│   ├── renderEnvelope.js:35 — `let body = String(part.body || '')`   (text part)
│   ├── renderEnvelope.js:43 — `body: String(part.body || '')`        (buttons part)
│   └── renderEnvelope.js:52 — `body: String(part.body || '')`        (list part)
│       → an envelope part with body true / 123 / {} renders "true" / "123" /
│         "[object Object]" and ships, exactly like the fallback bug did
└── NOT FIXED — documented only, per task rules. V3 remains disabled in production.
```

## 4. Machine-wide artifact sweep (added 2026-07-31 ~13:00 IST, pre-remediation)

Purpose: confirm the two documented actions were the ONLY things that touched this repo or
the Vercel project in the window, and find any other agent/tool that operated here.

### 4a. Git — complete and accounted for

```
├── git log --all for 2026-07-29 → 2026-08-01: every commit maps to the already-documented
│   batch (crisis hotfix 1a31ef6 · autoindex 1234c1d · M-1 2069e3e · g2b 08ad31d · distress
│   503f5d4 · close-outs 346e29c/5ec22b9/af8b6b7 · merges 8627922/f7e27bb/dd94229 · PR #13
│   merge 8ceace9 · pipeline bc9f322 · yield c5fe0f7). NOTHING new found.
├── one attribution nuance: the PR #13 merge commit (8ceace9) is authored by
│   "venkatesh kammari" — consistent with the GitHub credential on this machine
│   (kammari-venkatesh, write access). All other window commits: GuideXper (machine account).
└── reflog 18:03–19:35 IST is one coherent single-machine sequence (checkouts, three merges,
    two commits); no orphan commits, no resets to unknown states.
```

### 4b. Vercel — every deployment in the window, from the API (not just CLI list)

```
├── 07-30 18:02–18:41  five PREVIEW deploys (1a31ef6, 1234c1d, 2069e3e, 08ad31d, 503f5d4,
│                      346e29c, 5ec22b9, af8b6b7) — branch pushes, never aliased to prod
├── 07-30 18:42:05  PROD  8ceace9   (distress hotfix via PR #13)
├── 07-30 18:53:10  PROD  dd94229   (merge batch — still no V3 wiring)
├── 07-30 19:08:28  PROD  bc9f322   ← V3 code first present in production (flag still off)
├── 07-30 19:30:06  PROD  bc9f322   ← redeploy at env-flip time — THE go-live moment
├── 07-30 19:35:40 + 19:35:53  PROD  c5fe0f7  (sticky-yield; second is the aliased one)
├── 07-31 12:29:44  PROD  c5fe0f7   (kill-switch redeploy, this session)
└── every deployment has creator sripavantejb (the machine's standing token) and maps to a
    known commit. NO unexplained deployments. This also refines §2's timeline: V3 was
    live-capable from 19:08 and actually live from 19:30:06 IST.
```

### 4c. Agent sessions and other AI tooling on this machine

```
├── TWO Cursor agent sessions were active around the incident — not one:
│   ├── b79771df-7cca-49d2-9ce5-397ef73176e4 — started Jul 28 16:25 IST (first task:
│   │   "remove all the chatbot profile details on this numner : 9347763131"), was handed
│   │   the spec ~/Downloads/GUIDEXPERT_MASTER_FLOW_V3.md at 17:48, and its transcript's
│   │   last write is Jul 30 19:02 — one minute after bc9f322 (19:01). This session
│   │   AUTHORED the foundation commits and the go-live pipeline commit.
│   └── c880bdcf-e76e-4a1f-9297-5d08d978db43 (the current session's thread) — active from
│       ~18:55 Jul 30; executed the env flip (~19:30), c5fe0f7 (19:35), and on Jul 31 the
│       kill switch, audits, and incident docs.
├── shell history: ~/.zsh_history last written Jul 30 19:47; contains git-push lines and a
│   production health-check curl; NO vercel env commands (agent-executed commands do not
│   persist to zsh history — the Vercel API metadata in §4b is the authoritative record).
│   ~/.bash_history does not exist.
├── other AI tools: only ~/.gemini (Google Antigravity IDE) exists. It has a project config
│   pointing at /Users/guidexper/GuideXpert with allowWrite:true — but nothing under it has
│   been modified since 2026-05-20/Jun-13. Dormant throughout the window; noted as a
│   standing-access observation, not an incident actor.
│   Absent entirely: .claude, .codeium, .continue, .copilot, .windsurf, .ollama, gh config.
└── spec documents live OUTSIDE the repo, in ~/Downloads:
    ├── FLOW_V3_LLM_ARCHITECTURE.md (Jul 30 16:09) + "FLOW_V3_LLM_ARCHITECTURE (1).md" (16:19)
    ├── GUIDEXPERT_MASTER_FLOW_V3.md (Jul 28 17:46) · GUIDEXPERT_MASTER_FLOW.md (Jul 28)
    ├── LEAD_PROFILE_CONTRACT.md (Jul 30 16:20 — byte-identical size to the committed copy)
    └── CURSOR_BUILD_PROMPT.md: NOT FOUND anywhere on this machine (Spotlight + Downloads) —
        its M-4 gate can only be assessed indirectly (relevant to the conformance review).
```

### 4d. Verdict

```
└── CLEAN SWEEP: no evidence of any actor beyond (a) the two Cursor agent sessions on this
    machine and (b) the PR #13 merge by the collaborator account. Every commit, deployment,
    and config change in the window is now attributed. Stated plainly per instructions:
    nothing further was found.
```
