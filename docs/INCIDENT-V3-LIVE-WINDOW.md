# INCIDENT-V3-LIVE-WINDOW.md

Raw findings only. Captured 2026-07-31 ~12:45 IST, immediately after the kill switch was
verified off. Sources: production MongoDB (read-only queries), Vercel deployment metadata
(`vercel ls` / `vercel inspect`), git history, and a local `vercel build` trace of the same
tree to establish what the deployed bundle contained. No fixes were made.

## 1. The live window (exact)

```
├── code that wired V3 (registry entry + pipeline): commit bc9f322, 2026-07-30 19:01:08 IST
├── production deploys carrying it (vercel inspect, IST):
│   ├── 18:53:10  guide-xpert-backend-bnzhy2sve  (pre-bc9f322 — did NOT contain V3 wiring)
│   ├── ~19:0x–19:2x  three more production deploys (2uswnkba0, 45k0jesba, 104goalxf)
│   └── 19:35:53  guide-xpert-backend-llawaup7k  — final live-window deploy; matches commit
│       c5fe0f7 (19:35:36, "yield sticky V2 so live canary can remount")
├── env flags (CHATBOT_FLOW_V3_ENABLED=1, MODE=live, CANARY=100) set in Vercel ~19:30 IST
│   Jul 30 (listed as "17h ago" at 12:35 IST Jul 31, before replacement)
├── WINDOW START (V3 capable of serving): between 19:01 and 19:35 IST, 2026-07-30
│   — first observed V3-authored outbound: 19:42:45 IST (14:12:45 UTC), see §3
├── WINDOW END: kill-switch deploy dpl_4pX8RnBNG919b4DnjtDeHDkkPhWQ created
│   2026-07-31 12:29:44 IST, aliased to guide-xpert-backend.vercel.app ~12:30 IST
└── total wall-clock exposure: ~16.9 hours flag-on; actual V3 traffic occupied
    ~7 minutes of it (19:42–19:49 IST on Jul 30), all from one test number (§2)
```

## 2. Who was in the window — COUNTS

Queried collections: `whatsappinboundmessages`, `whatsappoutboundmessages`,
`whatsappbotstates`, `whatsappconversations`, `flowv3turnlogs`. Window bounds used for
queries: 2026-07-30 18:30 IST → 2026-07-31 12:30 IST (deliberately wider than §1).

```
├── inbound messages in window (ALL engines):          12
├── distinct phones in window (ALL engines):            2
│   ├── 9347763131  — the project owner's own number, used for smoke tests in the
│   │                 prior session (documented in that session's transcript). TEST.
│   └── 9502694366  — handled ENTIRELY by Flow V2 (botState career_counselling_flow_v2,
│                     no flowV3 context, lastIntent career_counselling_flow_v2; all 7 of
│                     its outbounds are V2 scripted copy — interest picker, checklist,
│                     shortlist offer). NEVER touched V3.
├── phones that touched the V3 path — ever, not just window:  1  (9347763131)
│   ├── evidence: exactly one botState in the entire DB has context.flowV3
│   │   (engine "flow_v3", mode "live", promptVersion "v1",
│   │    lastTurnId v3_8b157e36-4829-4364-bff7-f17e2f116c1b, updated 19:49:36 IST Jul 30)
│   └── conversations with lastIntent matching flow_v3: 0
├── REAL (non-test) students through V3:               **0**
├── V3-handled turns:                                   4 outbound (of 6 total to that phone
│                                                       in the window; first 2 were V2)
└── flowv3turnlogs documents — in window AND in the entire collection's history: **0**
    (see §5 — the V3 audit log has never successfully written in production)
```

## 3. Every outbound on the V3 path, verbatim

Full interleaved transcript for 9347763131 (the only V3 conversation). Times UTC.

```
├── 13:56:49 IN   "hi"
├── 13:56:56 OUT  [V2 — scripted welcome, interactive_list, flowv2_qual_* rows]   read
│                 "👋 Hi! Welcome to GuideXpert.\nI'm Rithika from the GuideXpert
│                  Counselling Team. 😊 …First, may I know your current qualification?"
├── 14:01:31 IN   "hi"
├── 14:01:37 OUT  [V2 — scripted re-ask]                                          read
│                 "First, may I know your current qualification?"
├── 14:12:32 IN   "Hi, I need guidance choosing the right college and course."
├── 14:12:45 OUT  [V3 — LLM-GENERATED]                                            read
│                 "What is your highest qualification? (e.g., 10th, 12th, B.Tech,
│                  B.Sc, etc.)"
├── 14:18:05 IN   "Hi"
├── 14:18:23 OUT  [V3 — FALLBACK-LADDER DEFECT]                                   read
│                 "true"
├── 14:18:37 IN   "What"
├── 14:18:56 OUT  [V3 — LLM-GENERATED]                                            read
│                 "Could you share your qualification?"
├── 14:19:15 IN   "12th completed"
└── 14:19:36 OUT  [V3 — FALLBACK-LADDER DEFECT]                                   delivered
                  "true"
```

Classification basis:
```
├── "What is your highest qualification? (e.g., 10th, 12th, B.Tech, B.Sc, etc.)" and
│   "Could you share your qualification?" exist NOWHERE in the repository
│   (rg across the full tree excluding node_modules: zero hits) — they could only have
│   come from the LLM. So the LLM path did produce and ship replies.
└── "true": reproduced deterministically this session WITHOUT any LLM —
    runFallbackLadder({profile:{}, slotMeta:{}, reason:'llm_failed'}) returns
    { tier: 'A', slot: 'qualification', replyText: true }  ← boolean, not a string.
    Mechanism visible in code: fallbackLadder.js:27-29 does `slot.askable || <template>`,
    and `askable` in LEAD_PROFILE_SCHEMA is the BOOLEAN `true`, so the truthy boolean
    short-circuits the template and becomes the reply, string-coerced downstream to "true".
    Both "true" turns therefore mark turns where the LLM/parse path failed and the
    fallback ladder fired — and the fallback itself was broken.
    (NOT FIXED in this task, per instructions.)
```

## 4. System prompt — was it there at runtime?

```
├── premise being tested: "possibly no system prompt"
├── prompts/system_prompt.v1.md IS committed on main (blob 3ffc86c) — v1,
│   sha256-prefix hash 814fe2e1cab11ba6, 2,299 bytes
├── vercel.json includeFiles lists only "assets/**,data/rankPredictor/**" — prompts/ is
│   NOT explicitly included, which made runtime presence uncertain
├── empirical check: ran `vercel build` locally on the same tree; Vercel's file tracing
│   DID pull the directory into the function bundle:
│   .vercel/output/functions/server.js.func/prompts/system_prompt.v1.md  (present)
│   .vercel/output/functions/server.js.func/prompts/TOOL_CONTRACT.md     (present)
├── corroboration from runtime data: the surviving botState pins promptVersion "v1",
│   which promptLoader only resolves by successfully listing/reading the prompts dir —
│   and promptLoader THROWS (PromptNotFoundError) rather than inventing a default, so a
│   missing file would have produced fallback-ladder output on EVERY turn, not the two
│   novel LLM-phrased questions observed
└── conclusion: the LLM calls ran WITH prompts/system_prompt.v1.md (hash 814fe2e1cab11ba6)
    as the system message. The "no prompt" premise is not supported by the evidence.
```

## 5. Flag scan — colleges / URLs / numbers / booking links

Automated scan of every outbound in the window to V3-touched phones, matching: any
`http(s)://` URL, any college name from `CURATED_MODERN_CATALOG`, ₹ / percentages /
placement / LPA / 4+-digit numbers, and booking-link markers (`one-on-one-session`,
"booking").

```
├── URLs shipped on the V3 path:                    0
├── college names shipped on the V3 path:           0
├── price / placement / numeric claims:             0
├── booking links:                                  0
└── the harmful content that DID ship: the literal string "true", twice, as a
    counsellor reply to a live WhatsApp session (both read/delivered)
```

## 6. The missing audit trail (observation only, no fix)

```
├── flowv3turnlogs contains 0 documents — not just for this window, EVER. Every V3 turn
│   (including all 4 above) ran with no turn log, so promptHash / llmCalls / toolCalls /
│   raw model output for those turns are unrecoverable from the DB.
├── code observation: flowV3Dispatcher.js:96 ends the turn-log write with
│   `.catch(() => {})` — a write failure is swallowed with no log line, which is
│   consistent with zero documents and zero errors observed.
├── Vercel runtime logs for the window: no longer retrievable (short retention; the
│   live-window deployment has also been superseded by the kill-switch deploy).
└── consequence for this incident: reply classification in §3 rests on DB message
    records + code-path reproduction, not on turn logs — because there are none.
```

## 7. Post-kill verification artifacts (for completeness)

```
├── health after kill deploy: {"flowV3":{"enabled":false,"mode":"shadow","canaryPercent":0}}
├── post-kill probe (synthetic phone 919000000777, 12:34 IST Jul 31): routed to
│   career_counselling_flow_v2, scripted V2 welcome with flowv2_qual_* list rows,
│   no flowV3 context, 0 new flowv3turnlogs
└── the probe phone is synthetic/test and is OUTSIDE the incident window counts in §2
```
