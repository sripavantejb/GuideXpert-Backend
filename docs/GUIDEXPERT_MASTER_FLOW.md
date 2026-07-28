```
╔═══════════════════════════════════════════════════════════════════════════════════════════╗
║  GUIDEXPERT · MASTER CONVERSATION FLOW · v3 FINAL                                          ║
║  WhatsApp counselling bot · entry → router → happy path → predictor → confirmed booking    ║
║                                                                                            ║
║  This document supersedes v2 and the standalone B1–B10 happy-flow spec.                    ║
║  The happy path has been REBUILT on the company's 10-stage flow and renumbered B1 → B10.   ║
║  Every router bucket, interrupt, fork, skip rule and matrix in this document has been      ║
║  re-pointed at the new spine. Nothing from v2 was dropped — it was remapped.               ║
║                                                                                            ║
║  ⚠ NODE IDs HAVE CHANGED FROM v2. See PART 2 for the old → new map before you              ║
║    reference anything from a v2 conversation or an old ticket.                             ║
╚═══════════════════════════════════════════════════════════════════════════════════════════╝
```

---

# CONTENTS

```
PART 0   LEGEND · HOW TO READ THIS
PART 1   THE WHOLE FLOW IN ONE PICTURE
PART 2   ★ RECONCILIATION — v2 → v3, AND THE TWO THINGS THAT SURFACED
PART 3   DECISIONS — LOCKED, AND STILL OPEN
PART 4   THE FOURTEEN LAWS  (override everything below them)
PART 5   NODE 0 · THE OVERRIDE
PART 6   THE ROUTER · 13 BUCKETS
PART 7   R1 · THE HAPPY PATH · B1 → B10
           B1 QUALIFY · B2 GOAL · B3 INTEREST · B3.2 CORE FORK (3 sub-paths)
           B4 PRIORITY · B5 CHECKLIST · B6 PERMISSION · B6.5 CONSTRAINTS
           B7 TWO MODELS · B8 SHORTLIST · B9 FIT · B10 BOOK · B10-F FOLLOW-UPS
PART 8   R2 – R13 · EVERY OTHER BUCKET IN FULL
PART 9   R4 · JUMPS AHEAD · SUB-CASES A–G
PART 10  R4-P · THE COLLEGE PREDICTOR
PART 11  THE INTERRUPTS · I-1 – I-10
PART 12  THE SKIP MATRIX · B1 → B10
PART 13  THE DATA LAYER · LEAD PROFILE + SLOT REGISTRY
PART 14  EXIT STATES
PART 15  BEFORE / AFTER
PART 16  WHAT SHIPS UNTOUCHED FROM THE CURRENT BUILD
PART 17  WHAT TO INSTRUMENT
PART 18  BUILD ORDER
PART 19  OPEN BEFORE SHIP
```

---

# PART 0 · LEGEND

```
👤 / 🟩  STUDENT          what the student sends
🤖 / 🟦  BOT              exact copy, verbatim, as shipped
🟧  WHY                   the reasoning — for you, never shown to the student
🟥  ⚠ GUARD RAIL          a hard rule. Breaking it costs a lead or does harm.
🟪  ✂ CUT                 deleted, with the reason
🟢  ✓ KEEP                already good — ships unchanged
▣   SAVED                 written to the lead record
◆   DECISION              engine branches here
⚡   INTERRUPT             fires on detection, answers inline, returns
►►  EXITS TO              leaves this node for another
↩   RETURNS               comes back to the node it left
★   THE IMPORTANT ONE
{slot}                    read from the lead record at render time
```

**Every node below has the same seven sections. A missing section does not apply.**

```
├── PURPOSE ......... why this beat exists at all
├── FIRES ........... the exact condition that runs it
├── SKIP IF ......... the condition that bypasses it SILENTLY
├── 🤖 COPY ......... the verbatim message the student sees
├── 🎛 INPUT ......... buttons / list / free text, WhatsApp limits respected
├── ▣ SAVES ......... what is written to the lead record
├── ⚠ GUARDS ........ the things that must never happen here
└── ✎ CHANGED ....... what moved, and the counselling reason
```

```
ARCHITECTURAL BOUNDARY — holds everywhere in this document

   THE ENGINE ROUTES.  THE MODEL ONLY VOICES COPY.

   Every ◆ decision, every skip, every interrupt trigger and every
   slot write is deterministic code. The LLM's only job is rendering
   a message for a node the engine already chose. No LLM routing. Ever.
```

```
WHATSAPP HARD LIMITS — every input in this document respects these

   Reply buttons ........ 3 maximum, 20 chars each
   List rows ............ 10 maximum, 24 chars title + 72 chars description
   List sections ........ 10 maximum
   Free text ............ always accepted, never demanded

   ⚠ An 11th list row does not error. It silently disappears.
```

---

# PART 1 · THE WHOLE FLOW IN ONE PICTURE

```
                                  👤 "hi"
                                     │
                    ⚡ NODE 0 · OVERRIDE — checked before EVERY node
                       booking intent? → B10 immediately, questions later
                                     │
                          ╔══════════▼══════════╗
                          ║  B1 · QUALIFY       ║  greeting + 1 list
                          ╚══════════╤══════════╝
                                     │
                          ◆ HOW DID THEY REPLY?  (silent classification)
                                     │
   ┌────────┬────────┬────────┬──────┴──┬────────┬────────┬────────┬────────┐
   ▼        ▼        ▼        ▼         ▼        ▼        ▼        ▼        ▼
  R1       R2       R3       R4        R5       R6      R7–R9   R10–R12    R13
 TAPS    TYPES    OVER-    JUMPS     ASKS    DEFLECTS  EMOTION  EDGE /   SILENCE
  IT       IT    ANSWERS   AHEAD    ABOUT US           NON-TEXT HOSTILE
  55%     20%      8%       7%        4%       2%       3%       <1%       —
   │        │        │        │         │        │        │        │        │
   │        └────────┴────┬───┴─────────┴────────┴────────┴────────┴────────┘
   │                      │
   │              R4-A only ─► ╔═══════════════════════╗
   │                           ║  R4-P · PREDICTOR     ║  real API,
   │                           ║  slots → API → results║  rank-gated colleges
   │                           ╚═══════════╤═══════════╝
   │                                       │ ⑤ the honest bridge
   │                                       │   (names the two catalogs)
   │  ◄────────────────────────────────────┘
   ▼
╔═══════════════════════════════════════════════════════════════════════════════╗
║                        R1 · THE HAPPY PATH · B1 → B10                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                                ║
║   B1        B2        B3        B4        B5        B6                        ║
║ QUALIFY →  GOAL  →  INTEREST → PRIORITY → CHECKLIST → PERMIT                  ║
║  1 tap     1 tap     1 tap      1 tap     0 taps     1 tap                    ║
║                        │                     ▲          │                     ║
║                        │  ⚡ B3.2 CORE FORK  │          │                     ║
║                        │  ├─ convert  → B4   │          │                     ║
║                        │  ├─ tell more → back│      THE ONLY                  ║
║                        │  └─ pure core → honest exit ► GATE                   ║
║                        │                  FIRST VALUE   │                     ║
║                        │                  RETURNED      │                     ║
║                                                          ▼                     ║
║              ┌──────────────────────────────────────────┘                     ║
║              ▼                                                                 ║
║          B6.5         B7          B8         B9        B10                    ║
║       CONSTRAINTS → TWO MODELS → SHORTLIST → FIT  →   BOOK                    ║
║        2 taps ⚠     0 taps      0 taps      1 tap    2 taps + name           ║
║        (conditional)               ▲                     ▲                     ║
║                                 PAYLOAD              the close                 ║
║                                                                                ║
╚═══════════════════════════════════════════════════════════════════════════════╝
                                     │
                                     ▼
                    ╔══════════════════════════════════╗
                    ║  CONFIRMED SLOT + COUNSELLOR     ║ → helper mode
                    ╚══════════════════════════════════╝

   TOTAL:  8 student turns (10 if B6.5 fires) · 1 permission gate ·
           1 typed answer · value at turn 5 · colleges at turn 7
```

---

# PART 2 · ★ RECONCILIATION — v2 → v3

## 2.1 · The node ID map

v2's happy path was seven beats. v3's is ten, rebuilt on the company's flow. **The same IDs now mean different things.** Read this before quoting any v2 node number.

```
v2 NODE              v2 MEANING                    v3 NODE      v3 MEANING
──────────────────────────────────────────────────────────────────────────────────
Node E              greeting + qualification      B1           QUALIFY (merged in)
—                   —                             B2           GOAL (new question)
B2  BRANCH          which field pulls you         B3           INTEREST (widened)
B2.2 CORE FORK      the mechanical bridge         B3.2         CORE FORK (unchanged
                                                                content, new ID)
B1  GOAL            what matters most             B4           PRIORITY (widened
                                                                to 9 rows)
—                   —                             B5           CHECKLIST  ★ NEW
—                   —                             B6           PERMISSION ★ NEW
B3  CONSTRAINTS     budget + location             B6.5         CONSTRAINTS ⚠ MOVED
B4  BRIDGE          one-bubble framing            B7           TWO MODELS (rewritten
                                                                honest, both sides)
B5  SHORTLIST       5 colleges, 3 tiers           B8           SHORTLIST (3 flat
                                                                + disclosure)
B6  THE CASE        compare → recommend → vision  B9           FIT (condensed,
                                                                + honest pass)
B7  BOOK            invite + URL                  B10          BOOK (now completes:
                                                                slot, name, confirm)
—                   —                             B10-F        FOLLOW-UPS ★ NEW
```

**Global find-and-replace for any v2 artefact you still hold:**

```
"B1 GOAL"        → B4 PRIORITY
"B2 BRANCH"      → B3 INTEREST
"B2.2"           → B3.2
"B3 CONSTRAINTS" → B6.5 CONSTRAINTS
"B4 BRIDGE"      → B7 TWO MODELS
"B5 SHORTLIST"   → B8 SHORTLIST
"B6 THE CASE"    → B9 FIT
"B7 BOOK"        → B10 BOOK
"Node E"         → B1 QUALIFY
```

## 2.2 · ⚠ THING ONE — the company flow never asks budget or location

```
★ THIS IS THE MOST IMPORTANT FINDING IN THE MERGE.

  The RECOMMENDATION_WEIGHTS matrix carries budgetFit 12 and
  locationFit 14 — 26 of the total weight, the second-largest block
  after courseMatch.

  The company's 10-stage flow asks for NEITHER.

  Run the merged flow as the company wrote it and B8 produces a
  shortlist scored on a matrix with a quarter of its inputs empty.
  It will still return three colleges. They will look confident.
  They will be materially less accurate, and there is no way for the
  student to tell.

  It gets worse at one specific point: B4 offers "💰 Fees &
  scholarships" as a priority row. A student who taps it has told you
  money is their binding constraint — and the flow then never asks
  what their range is. That is the single most visible hole in the
  merged design.
```

**The resolution, and why it sits where it does:**

```
B6.5 · CONSTRAINTS is reinstated from v2 — but MOVED.

  v2 asked budget and location at beat 3, BEFORE the student had
  received anything. That is two personal questions in exchange for
  nothing, and it is the highest-friction placement available.

  v3 asks them at beat 6.5 — AFTER the checklist has been given and
  AFTER the student has explicitly said "yes, show me colleges."
  Same two taps, entirely different felt cost: they are now
  refinements to something they asked for, not a toll on the way in.

  It fires CONDITIONALLY. Any student who already volunteered budget
  or city — R3, R4-C, free-text extraction — skips it silently. On
  current bucket volumes roughly a third of leads never see it.

  ◆ OPEN: if you want the flow at exactly 8 turns, delete B6.5 and
    accept a shortlist scored without budgetFit or locationFit. That
    is a real option and it is defensible for a catalog of only 3
    colleges. It is NOT defensible if B8 ever expands past 3, or if
    the "Fees & scholarships" row stays in B4. Your call — this is
    the one place I have added a beat you did not ask for, and it is
    one line to remove.
```

## 2.3 · ⚠ THING TWO — B4's priority list drops two real segments

```
  v2's B1 carried six rows: placements · AI & future tech · affordable ·
  HIGHER STUDIES LATER · STARTUP / ENTREPRENEURSHIP · not sure.

  The company flow's Stage 4 carries seven, and neither of those two
  survives. A student aiming at an MS abroad and a student who wants to
  build something both have to pick a row that misrepresents them —
  and the shortlist then gets weighted for the wrong thing entirely.

  ✅ RESOLVED: B4 now carries NINE rows. WhatsApp allows ten, so both
     segments are restored at zero cost. See B4.
```

## 2.4 · The four conflicts between the two documents, resolved

```
┌───┬────────────────────────┬──────────────────────────────────────────────┐
│ 1 │ SHORTLIST SIZE         │ v2: 5 colleges in 3 tiers                    │
│   │                        │ v3-happy: 3 colleges, flat, no ranking       │
│   │ ✅ RESOLVED            │ 3 flat + disclosure is the default. The       │
│   │                        │ wider catalog moves behind a tap at B8.4.     │
│   │                        │ ⚠ v2's medals (🥇🥈🥉) are DELETED either way. │
│   │                        │ Computed tiering is defensible; medals on     │
│   │                        │ three partner colleges are not.               │
├───┼────────────────────────┼──────────────────────────────────────────────┤
│ 2 │ THE BRIDGE             │ v2 B4: one bubble, "projects and mentorship  │
│   │                        │ move the needle" — persuasive, one-sided     │
│   │                        │ v3 B7: two models, honest trade-offs both    │
│   │ ✅ RESOLVED            │ ways. B7 SUPERSEDES v2's B4 entirely.        │
│   │                        │ Reason: B7 has to survive being read by the  │
│   │                        │ student's father. v2's version does not.      │
├───┼────────────────────────┼──────────────────────────────────────────────┤
│ 3 │ THE RECOMMENDATION     │ v2 B6: 3 bubbles — compare, recommend, vision │
│   │                        │ v3 B9: 1 ask + 1 answer + honest pass        │
│   │ ✅ RESOLVED            │ B9 is the default. v2's comparison table      │
│   │                        │ survives as B9.4, on tap. v2's "vision"       │
│   │                        │ bubble is CUT — it is the least earned copy   │
│   │                        │ in either document.                           │
├───┼────────────────────────┼──────────────────────────────────────────────┤
│ 4 │ FOLLOW-UP CADENCE      │ v2 L12: one nudge, ever                      │
│   │                        │ company flow: three, inside three hours      │
│   │ ✅ RESOLVED            │ TWO nudges, at +4h and +2 days, and only      │
│   │                        │ after a shortlist has been delivered. One     │
│   │                        │ nudge everywhere else. See L12 and B10-F.     │
└───┴────────────────────────┴──────────────────────────────────────────────┘
```

---

# PART 3 · DECISIONS — LOCKED, AND STILL OPEN

## 3.1 · Applied defaults, so this document is shippable

```
┌──────┬────────────────────────────┬──────────────────────────────────────────┐
│ B4-a │ PRIORITY LIST              │ ✅ LOCKED: 9-ROW LIST                    │
│      │ 7 rows vs 9                │ Higher studies and startup restored.     │
│      │                            │ Costs nothing; missing them mis-weights  │
│      │                            │ the entire shortlist for those students. │
├──────┼────────────────────────────┼──────────────────────────────────────────┤
│ 6.5-a│ CONSTRAINTS BEAT           │ ✅ LOCKED: ON, CONDITIONAL, AT 6.5       │
│      │ keep / cut / move          │ ↔ flip: delete the node. One line.       │
│      │                            │ See 2.2 before you flip it.              │
├──────┼────────────────────────────┼──────────────────────────────────────────┤
│ B8-a │ SHORTLIST SIZE             │ ✅ LOCKED: 3 FLAT + tap for more         │
│      │ 3 flat vs 5 tiered         │ ↔ flip: B8.4 becomes the default view.   │
├──────┼────────────────────────────┼──────────────────────────────────────────┤
│ B8-b │ THE CATALOG                │ ✅ LOCKED: EDITORIAL + disclosed         │
│      │ editorial vs paid          │ ⚠ If placement in the shortlist is PAID, │
│      │ placement                  │ the B8 disclosure line must say so       │
│      │                            │ explicitly. "We work with" is not enough │
│      │                            │ if money changes the ORDER.              │
├──────┼────────────────────────────┼──────────────────────────────────────────┤
│ CORE │ DO HUMAN COUNSELLORS       │ ✅ LOCKED: NO → VARIANT B (honest exit)  │
│      │ COVER CORE BRANCHES?       │ Variant A is written at 3.2-F2-A.        │
│      │                            │ ⚠ Getting this wrong OPTIMISTICALLY is   │
│      │                            │ the expensive mistake.                   │
├──────┼────────────────────────────┼──────────────────────────────────────────┤
│ B10-a│ COUNSELLOR CREDENTIAL      │ ✅ LOCKED: "senior counsellor"           │
│      │ "IITian" vs generic        │ ↔ flip ONLY if the roster guarantees it. │
└──────┴────────────────────────────┴──────────────────────────────────────────┘
```

## 3.2 · Two assumptions this document makes about your business

```
ASSUMPTION 1 — the 1-on-1 session is FREE.
   Used in: B1, B10.1, R5, I-7.
   ⚠ If it is paid, the price appears in B1 and in every R5/I-7 answer.
     Discovering a fee at the booking step is the fastest way to lose
     trust and get reported as spam.

ASSUMPTION 2 — GuideXpert's depth is engineering + tech in India, CSE/AI-led.
   Used in: R11, I-6, B3.2 fork 2, B9 honest pass.
   ⚠ If you DO cover medical / law / MBA, delete R11's decline and route
     properly. Only claim what is true — in both directions.
```

---

# PART 4 · THE FOURTEEN LAWS

*Merged from v2's twelve and the happy-flow's ten. Where a node's copy conflicts with a law, the law wins.*

```
 L1  ▸ DISTRESS OVERRIDES EVERYTHING.
       ⚡ I-10 outranks every other rule in this document, including
       Node 0. Build this classifier before you build the shortlist
       engine. It must run BEFORE the router in the pipeline, not as
       a branch inside the flow.

 L2  ▸ BOOKING INTENT IS ANSWERED IMMEDIATELY.
       Node 0 fires from any node, at any time, mid-question included.
       Never make a student who asked to book answer questions first.
       This is the single most expensive bug in the current build.

 L3  ▸ ANSWER THE NEED THEY STATED. THEN REJOIN.
       Never substitute your preferred flow for the thing they actually
       asked for. If you can't deliver it, get them someone who can.
       Offering counselling to a student who asked for predictions is
       the same error as offering a shortlist to a student who asked
       to book.

 L4  ▸ NEVER RE-ASK ANYTHING THEY VOLUNTEERED.
       Extraction runs on EVERY inbound message. Pre-filled slots are
       skipped SILENTLY — never confirmed, never re-asked.

 L5  ▸ NEVER SAY "PLEASE SELECT FROM THE OPTIONS."
       They answered. The answer just arrived in the wrong format.
       It is the single most robotic sentence this bot could produce.

 L6  ▸ GUESS, THEN CONFIRM IN ONE TAP. NEVER REJECT INPUT.
       A tap costs the student two seconds. A rejection costs the lead.

 L7  ▸ GREET EXACTLY ONCE.
       "hi" then "hello?" then "anyone there" is ONE entry, not three.
       Re-greeting is the loudest possible tell that nothing is
       remembered.

 L8  ▸ ANSWER "ARE YOU A BOT" HONESTLY, ALWAYS.
       One evasion discounts every recommendation that follows.

 L9  ▸ NEVER INVENT.
       No fees, cutoffs, deadlines, placement percentages, quota rules,
       or confidence tiers. If you don't have it, say so and route to
       the 1-on-1. This is the category where being wrong costs a year.

 L10 ▸ ONE HUMAN LINE BEFORE ANY BUTTON, WHEN EMOTION IS PRESENT.
       A student who says "i failed" and gets an instant menu feels
       processed, not heard.

 L11 ▸ HONOUR "STOP" INSTANTLY AND PERMANENTLY.
       No retention attempt. Not even one. Never "may I ask why?"

 L12 ▸ TWO NUDGES MAXIMUM, AND ONLY AFTER A SHORTLIST WAS DELIVERED.
       Everywhere else: ONE. A student who never got value gets one
       nudge; a student who got a shortlist and didn't book gets two,
       spaced +4h and +2 days. A third gets you blocked and reported.
       ✂ The company flow's 30min / 1h / 3h cadence is deleted. Three
         chases inside three hours is exactly the behaviour B1's copy
         promises we are not.

 L13 ▸ COMMERCIAL RELATIONSHIPS ARE DISCLOSED. ★ NEW IN v3
       Once, plainly, at B8. Never buried, never softened, never moved
       to the end. If money affects the ORDER of the shortlist and not
       just its membership, that must be said too.

 L14 ▸ A BEAT THAT GIVES NOTHING CANNOT ASK FOR ANYTHING. ★ NEW IN v3
       Every question after B5 must be preceded by something the
       student received. This is why B6.5 sits where it sits.
```

```
🟥 THREE SENTENCES BANNED PRODUCT-WIDE
   ✗ "every branch ends up as a CS job"
   ✗ "a CS student can do any other branch's JOB"    ← say INDUSTRY
   ✗ "core branches are a waste"

🟥 THREE MORE, ADDED IN v3 — from the company flow's Stage 7
   ✗ "traditional colleges focus on exams over skills"
   ✗ "placements usually start in the final year"
   ✗ any claim about an entire CATEGORY of college stated as fact

   All six are checkable and false. One disprovable claim discounts
   your recommendation AND your counsellor. The father who did his BE
   at a government college is often the person reading over the
   student's shoulder.
```

---

# PART 5 · ⚡ NODE 0 · THE OVERRIDE

*Checked before every single node, including mid-question, including mid-predictor.*

```
NODE 0  ·  THE OVERRIDE
   fires from ANY node · at ANY time · outranked only by ⚡ I-10

├── 🟧 PURPOSE
│   Catch a ready-to-buy student and stop asking them things.
│
├── ◆ FIRES ON
│   "book" · "call me" · "talk to someone" · "counsellor" · "counselor" ·
│   "session" · "human" · "phone number" · "connect me" · "agent"
│
├── 🟩 STUDENT
│   "can someone just call me"
│
├── 🟦 BOT — bubble 1 · straight to the booking
│   Absolutely — let's get you booked.
│
│   When suits you?
│
│   [ list of live slots — see B10.2 ]
│
├── ►► JUMPS TO B10.2 · slot → name → confirmation
│   B1–B9 are backfilled afterwards ONLY if the student volunteers.
│
├── 🟦 BOT — bubble 2 · the optional backfill, AFTER the slot is locked
│   Booked ✅ One quick thing so your counsellor walks in already
│   knowing you — what matters most to you?
│
│   [ Placements ]  [ AI & future tech ]  [ Affordable & safe ]
│
├── ▣ SAVES
│   booking_status = booking_started · temperature = hot ·
│   door = booking_intent
│
└── 🟥 ⚠ GUARD RAILS
    ├── 0.1  fires from ANY node, at ANY time, including mid-question,
    │        mid-predictor, mid-comparison.
    ├── 0.2  never make a student who asked to book answer questions
    │        first. Single most expensive bug in the current build.
    ├── 0.3  backfill is OPTIONAL and comes AFTER the slot is locked.
    │        No answer is fine — the counsellor gets a thinner profile,
    │        but you got the booking.
    ├── 0.4  ONE yes = ONE booking flow. Never an "are you sure?" step.
    └── 0.5  ✎ CHANGED IN v3 — v2 sent a form URL here. v3 books in
             the chat, because a URL that gets opened and abandoned
             looks identical to a booking in your data and isn't one.
```

---

# PART 6 · THE ROUTER · 13 BUCKETS

```
ROUTER
├── 🟧 PURPOSE
│   The reply to the greeting sets TEMPERATURE, and temperature sets
│   the PACE for the whole session. A hot lead pushed through cold-lead
│   discovery is the single biggest conversion killer in this product.
│
├── 🟥 ⚠ Classification is SILENT. The student never sees a routing
│      message, never sees a bucket name, never sees "I've understood
│      you as…". Zero turns spent.
│
└── THE BUCKETS — rejoin points renumbered for the B1→B10 spine
    ├── R1  · TAPS A ROW ............ ►► B2 ................... ~55%
    ├── R2  · TYPES THE ANSWER ...... ►► B2 ................... ~20%
    ├── R3  · OVER-ANSWERS .......... ►► B4, then B5 .........   ~8%   ⭐
    ├── R4  · JUMPS AHEAD ........... ►► sub-case A–G ........   ~7%
    ├── R5  · ASKS ABOUT US ......... ►► answer → B1/B2 ......   ~4%
    ├── R6  · DEFLECTS / RESISTS .... ►► soft handle .........   ~2%
    ├── R7  · EMOTIONAL ............. ►► human line → B2 .....   ~2%   ⚠
    ├── R8  · NOT THE STUDENT ....... ►► parent track ........   ~1%
    ├── R9  · NON-TEXT .............. ►► OCR / re-ask ........   ~1%
    ├── R10 · AMBIGUOUS ............. ►► guess + confirm .....   <1%
    ├── R11 · OUT OF SCOPE .......... ►► ⚡ I-6 ...............   <1%
    ├── R12 · HOSTILE / TESTING ..... ►► redirect once .......   <1%
    └── R13 · SILENCE / RETURNING ... ►► nudge, then resume ..     —
```

```
🟥 ⚠ THE ROUTER'S OWN GUARD RAIL

   "talk to someone" / "call me" / "book" / "counsellor" is NOT R4.
   It is NODE 0 · THE OVERRIDE. Book first, backfill after.
   This holds from every bucket and from every beat.
```

---

# PART 7 · ▼▼▼ R1 · THE HAPPY PATH · B1 → B10 ▼▼▼

> **OPTION 3 SHIPPED (company Stage 1–10 overlay):** Runtime PCM happy path
> uses company verbatim copy in `services/chatbot/flowV2/nodes/*`. After B6
> permission Yes, **B6.5 is skipped** → B7 TWO MODELS. B8 shows **3 medals**
> (Newton · NIAT · Scaler). B10 uses **IITian** offer copy. Company 30m/1h/3h
> Maybe Later chase is **not** restored — see `GUIDEXPERT_HAPPY_FLOW_B8_B10.md`.
> Historical B6.5 / five-flat / senior-counsellor text below is retained for
> skip-matrix / non-happy-path reference only.

```
   B1        B2        B3        B4        B5        B6
 QUALIFY →  GOAL  → INTEREST → PRIORITY → CHECKLIST → PERMIT
  1 tap     1 tap    1 tap      1 tap      0 taps     1 tap
                       │                     ▲          │
                  ⚡ B3.2 fork            FIRST VALUE  THE GATE
                                                         │
            ┌────────────────────────────────────────────┘
            ▼
       B7          B8          B9         B10
   TWO MODELS → SHORTLIST → FIT  →     BOOK
    0 taps      0 taps      1 tap    hybrid slots
                (3 medals)           (IITian copy)

   Student turns: ~8 on PCM happy path (B6.5 skipped)   Gates: 1
```

---

## B1 · QUALIFY

```
B1  ·  QUALIFY   (was: Node E · GREETING)
   1 message · 1 list · ~55% tap · ~20% type

├── 🟧 PURPOSE
│   Make them feel they've reached a person, not a form. Kill the two
│   silent objections before they're asked. Get the ONE answer that
│   gates every downstream catalog decision.
│
├── ◆ PRE-CHECK · is this phone already in the DB?
│   ├── YES ──► R13 · RETURNING — resume at lead.stage, B1 SKIPPED
│   └── NO  ──► ▣ create lead
│                ▣ name = profile.name  (WhatsApp gives you this — never ask)
│                ▣ source = campaign / organic
│                ▣ raw_first_message stored VERBATIM
│
├── SKIP IF
│   `qualification` already extracted from the inbound message.
│   e.g. "im in 12th mpc looking for cse" → B1 does not fire, go
│   straight to B2, say nothing about skipping.
│
├── 🤖 COPY
│
│      Hey {name} 👋
│
│      I'm Rithika, from GuideXpert's counselling desk. We help
│      students pick a college that actually fits them — not just
│      the ones with the biggest ads.
│
│      Takes about 2 minutes, and it's free.
│
│      First — where are you right now?
│
├── 🎛 INPUT — WhatsApp LIST. Button: "Choose your stage"
│
│      1  Class 10
│      2  Class 11
│      3  12th — MPC / PCM
│      4  12th — BiPC / PCB
│      5  12th — MEC / CEC / Commerce
│      6  12th — Arts
│      7  Diploma
│      8  Dropper / gap year
│      9  Already in college
│      10 Something else
│
│      ⚠ Exactly 10 rows — the WhatsApp cap. An 11th silently vanishes.
│
├── 🟧 WHY EACH LINE EXISTS
│   ├── "Hey {name} 👋" ........... name from the webhook profile. Human
│   │                               from word one. Zero typing.
│   ├── "from GuideXpert's ........ honest framing. Survives "are you a
│   │    counselling desk"          bot?" intact. The bot never claims
│   │                               20 years of personal experience —
│   │                               attribute experience to the DESK.
│   ├── "actually fits them — ..... states a POINT OF VIEW. Signals
│   │    not the biggest ads"       counsellor, not catalogue. This is
│   │                               the best sentence in the company
│   │                               flow and it is kept verbatim.
│   ├── "2 minutes, and it's ...... kills both unspoken objections —
│   │    free"                      "how long is this?" and "will they
│   │                               charge me?" — before they fire.
│   └── "First —" ................. promises there aren't ten questions
│                                   coming.
│
├── ▣ SAVES
│      phone · name · language (detected) · source / campaign ·
│      raw_first_message (verbatim) · created_at · qualification ·
│      stream · entry_type · door · temperature · stage
│
└── 🟥 ⚠ GUARD RAILS
    ├── B1.1  Greet ONCE. (L7)
    ├── B1.2  Do NOT ask for name — WhatsApp hands it to you. If the
    │         push name is an emoji or nickname ("💫King💫"), drop it
    │         entirely and open with "Hey 👋". Never guess, never ask.
    ├── B1.3  Do NOT ask for city, budget or marks here. Those are
    │         B6.5, or extracted silently.
    ├── B1.4  Only say "free" if it IS free. (Assumption 1)
    ├── B1.5  Log raw_first_message even when they ALSO tap. A student
    │         who types "12th mpc, want cse" and taps [12th — MPC] has
    │         given two facts. Never let the button overwrite the
    │         richer free text.
    └── B1.6  Set temperature at message 2. Taps = warm. Types 3 facts
              = hot. Asks "how much" = cold.
```

### B1.7 · Where each list row goes

```
├── Class 10
│   🟦 Nice — you're early, which is genuinely an advantage. Most
│      students only start thinking about this in 12th.
│      Are you choosing your 11th stream right now?
│      [ Yes, choosing stream ]  [ Just exploring ]  [ Parent asked me to ]
│   ►► STREAM-ADVICE TRACK — not the college shortlist
│   🟥 ⚠ do NOT shortlist colleges for a Class 10 student. Wrong advice,
│      wrong time, and it burns the lead for two years.
│
├── Class 11
│   🟦 Good timing — you've got room to prepare properly.
│      Entrance exams, or more about which colleges to target?
│      [ Exams ]  [ Colleges ]  [ Both ]
│   ►► B2, with ▣ timeline = next_year
│
├── 12th — MPC / PCM ............... ►► B2 · the default engineering path
│
├── 12th — BiPC / PCB
│   🟦 Got it. BiPC usually points toward medical or life sciences —
│      are you set on that, or open to tech too? Plenty of BiPC
│      students move into bioinformatics or AI in healthcare.
│      [ Medical ]  [ Open to tech ]  [ Not sure ]
│   ├── [ Medical ] ─────────────────► R11 · OUT OF SCOPE
│   └── [ Open to tech ] / [ Not sure ] ►► B2
│
├── 12th — MEC / CEC / Commerce
│   🟦 Commerce stream — so business, finance, design or management
│      rather than engineering. Which direction pulls you?
│      [ Business/Mgmt ]  [ Design ]  [ Finance ]  [ Not sure ]
│   ►► B2, catalog pre-filtered to non-engineering
│   🟥 ⚠ if the catalog carries no business programs → ⚡ I-6
│
├── 12th — Arts
│   🟦 Got it. Design, media, law and management are the usual routes
│      from Arts — is one of those pulling you, or still open?
│      [ Design ]  [ Media ]  [ Law ]  [ Still open ]
│   🟥 ⚠ if the catalog has nothing here, say so at ⚡ I-6 rather than
│      running them through nine beats to a shortlist you can't give.
│
├── Diploma
│   🟦 Diploma's a solid route — and you've got a real advantage:
│      lateral entry straight into 2nd year B.Tech. Is that what
│      you're after?
│      [ Yes, lateral entry ]  [ Full B.Tech ]  [ Job instead ]
│   ▣ entry_type = lateral   ►► B2
│
├── Dropper / gap year
│   🟥 ⚠ HIGH SENSITIVITY. Usually carrying shame and family pressure.
│      Lead with dignity.
│   🟦 Good — and for what it's worth, a drop year is normal and it
│      works. Colleges care where you're heading, not the gap.
│      Reattempting an exam, or looking at direct admission this year?
│      [ Reattempting ]  [ Direct admission ]  [ Both ]
│   ►► B2
│
├── Already in college
│   🟦 Understood. Looking to switch, or thinking about what comes
│      after — higher studies or placements?
│      [ Switch college ]  [ After graduation ]  [ Just exploring ]
│   🟥 ⚠ transfers are genuinely hard mid-degree. Be honest about that
│      rather than encouraging a bad move.
│   ►► B2, or the 1-on-1 route
│
└── Something else
    🟦 No problem — tell me in your own words where you're at and
       I'll take it from there.
    → free text → extract → route
    🟥 ⚠ this is the ONE place free text is correct at entry.
```

---

## B2 · GOAL

```
B2  ·  GOAL   (★ NEW — no v2 equivalent)
   fires immediately after qualification · 1 tap · 3 buttons

├── 🟧 PURPOSE
│   Find the ONE thing the student actually came for. A "which branch"
│   student and a "which college" student need different framing from
│   the same catalog — and a "career scope" student needs B8 to lead
│   with roles rather than campuses.
│
├── FIRES .......... immediately after B1.
│
├── SKIP IF ........ `goal` already stated — "which branch should i
│                    take" in the first message fills it.
│
├── 🤖 COPY  (MPC / PCB / Diploma / Dropper path)
│
│      Perfect — MPC keeps engineering and tech wide open for you.
│
│      What would help you most right now?
│
├── 🎛 INPUT — WhatsApp BUTTONS (3 — the maximum, so this fits)
│
│      [ Which branch suits me ]
│      [ Careers with good scope ]
│      [ Best colleges for me ]
│
├── 2.1 · THE ACKNOWLEDGEMENT VARIES BY QUALIFICATION
│      12th — MPC ....... "Perfect — MPC keeps engineering and tech
│                          wide open for you."
│      12th — BiPC ...... "Got it."
│      12th — MEC/CEC ... "Got it — commerce opens up business,
│                          finance and design routes."
│      Diploma .......... "Good — and lateral entry gives you a real
│                          head start."
│      Dropper .......... "Good — and a drop year works more often
│                          than people think."
│      Already in coll. . "Understood."
│
├── ▣ SAVES
│      goal          branch_fit | career_scope | college_fit
│      temperature   college_fit → warm (further along the decision)
│
├── ⚠ GUARDS
│   ├── B2.1  Do not editorialise the buttons. "Best colleges for me"
│   │         must never become "Best colleges for me (recommended)".
│   │         Nudging the first question is how a counselling flow
│   │         becomes a funnel the student can feel.
│   ├── B2.2  [ Careers with good scope ] shifts B8's copy from
│   │         college-first to role-first. Same beats, different
│   │         framing. Do NOT add a beat for it.
│   └── B2.3  A goal is NOT a priority. "I want to be a software
│             engineer" fills career_goal, not B4's slot. Filling one
│             does not fill the other, and assuming it does produces
│             a badly weighted shortlist.
│
└── ✎ CHANGED
       ✅ Kept exactly as the company wrote it. Three options, three
         buttons, one tap. This stage was already right. The only edit
         is the trailing space and double question mark in the original.

►► B3
```

---

## B3 · INTEREST

```
B3  ·  INTEREST   (was: v2 B2 · BRANCH)
   fires after B2 · courseMatch 28 — the highest-weight field in the
   matrix · 1 tap · list · multi-select

├── 🟧 PURPOSE
│   Capture what the student is actually drawn to, in their own terms.
│   Input to B5's personalisation, B8's scoring and B9's fit reasoning.
│
├── SKIP IF ........ `interests` already has ≥1 value, or
│                    branch_interest known from R3 / R4-D / a
│                    branch-specific ad / a predictor branch filter.
│
├── 🤖 COPY
│
│      Good — that helps.
│
│      Which of these actually interest you? Pick as many as you like.
│
├── 🎛 INPUT — WhatsApp LIST. Button: "Pick your interests"
│      Section: "Tap one, then tap more if you want"
│
│      1  💻 Computers & software
│      2  🤖 Artificial Intelligence
│      3  📊 Data Science
│      4  ☁️ Cloud Computing
│      5  🔐 Cyber Security
│      6  📱 App Development
│      7  🌐 Web Development
│      8  🎮 Game Development
│      9  ⚙️ Core engineering (Mech / Civil / ECE / EEE)
│      10 🤔 Not sure yet — help me figure it out
│
│      After the first tap, ONE short line:
│
│      Noted 👍 Tap any others, or send "done" when you're finished.
│
├── 3.1 · WHAT EACH ROW DOES
│      Rows 1–8 ......... ▣ interest_cluster = software | data_ai |
│                            infra_security
│                         🟦 "Solid — and it's the most flexible base
│                             you can pick right now."          → B4
│      Row 9 ............ ▣ branch = core
│                         ▣ core_interest = mechanical|civil|ece
│                         ⚡ TRIGGERS B3.2 · THE CORE FORK
│      Row 10 ........... ▣ interest_cluster = undecided
│                         ⚡ I-1 · do NOT push a default branch
│
├── ▣ SAVES
│      interests[] · interest_cluster · branch · core_interest
│
├── ⚠ GUARDS
│   ├── B3.1  "Not sure yet" is a legitimate answer and the most honest
│   │         one a 17-year-old can give. It is NOT a failure to
│   │         answer. It sets undecided, B5 and B9 adapt, and it does
│   │         NOT loop.
│   ├── B3.2  ⚡ Row 9 exits the happy path to the core fork. Our
│   │         catalog is CS/AI-weighted; recommending it to a committed
│   │         Mechanical student is the dishonest move this product
│   │         exists to avoid. The row is there so the student can tell
│   │         us the truth — not so we can sell to them.
│   ├── B3.3  Cap at 4 selections. Beyond that the signal is noise and
│   │         B9's fit reasoning stops being defensible.
│   ├── B3.4  The three banned category-claims (Part 4) live near here.
│   └── B3.5  Never re-ask the branch. If R4-D captured it, B3 SKIPS.
│
└── ✎ CHANGED
       ✂ Buttons → LIST (WhatsApp 3-button limit).
       ✎ Added row 9, Core engineering. The company flow's nine options
         are ALL software. A PCM student who wants Mechanical has no
         honest answer available and will either pick something false
         or leave. Giving them a true option loses a lead we were never
         going to serve well — and keeps the flow honest for the ones
         we do.
       ✎ "I'm Not Sure Yet" → "help me figure it out". Same meaning,
         reads as an invitation instead of an admission.

►► B4   (or ⚡ B3.2 on row 9)
```

---

## ⚡ B3.2 · THE CORE-ENGINEERING FORK   (was: v2 B2.2)

```
🟧 THE STRATEGIC READ, BECAUSE THIS ONE IS EASY TO GET WRONG

   NIAT is CSE-only. That makes a core-engineering lead worth MORE
   effort than any other bucket — and it also makes this the one node
   in the whole flow where you can genuinely mis-sell.

   Push a mechanical student into NIAT and they discover in semester
   one that there is no mechanical anything. You haven't won a lead.
   You've bought a refund request and a bad review from someone whose
   parents are angry.

   The design goal is NOT "convert to CSE."
   It is: make ONE excellent, honest case — then fork cleanly either
   way. Both forks must reach a good ending. Neither is a dead end.
```

### 3.2-P1 · The joke, calibrated

```
┌─────────────────────────────────────────────────────────────────────┐
│  HALF 1  —  "any branch ends up in CS jobs"                         │
│                                                                      │
│  ✅ TRUE, and students already know it.                              │
│     Mass recruiters hire across branches into software roles.        │
│     Every engineering student in India has heard this joke.          │
│     It lands BECAUSE it's recognised truth, not despite it.          │
│                                                                      │
│  → USE IT. It's your strongest line.                                 │
├─────────────────────────────────────────────────────────────────────┤
│  HALF 2  —  "a CS student can go to any branch using AI"            │
│                                                                      │
│  ⚠ Depends entirely on one word.                                     │
│                                                                      │
│  ✅ "any INDUSTRY"  — TRUE. Automotive, aerospace, healthcare,       │
│     finance, agriculture all run on software now.                    │
│                                                                      │
│  ❌ "any BRANCH'S JOB" — FALSE. A CSE grad cannot sign off a         │
│     structure, cannot sit GATE-Mechanical for a PSU, cannot take     │
│     a licensed civil role.                                           │
│                                                                      │
│  → SAY "INDUSTRY". One word, and the joke becomes bulletproof.       │
└─────────────────────────────────────────────────────────────────────┘

🟧 THE COUNSELLOR'S TRICK
   The caveat makes the joke land HARDER. Adding "what a CS grad can't
   do is sign off a bridge" is self-aware, gets a smile, and buys
   enormous credibility — because you just argued against your own
   pitch and the student noticed.

   A pitch with no downside sounds like a pitch.
   A pitch with one honest downside sounds like advice.
```

### 3.2-P2 · The four-beat sequence

```
B3.2  ·  CORE ENGINEERING FORK
   fires on interest row 9 · ONCE ever · every path ends well

├──⓪ TRIGGER
│  ├── 🟩 taps "Core engineering" or types mechanical · civil · ECE ·
│  │      EEE · aero · auto
│  └── ▣ core_interest = mechanical | civil | ece  ← STORE THE SPECIFIC
│      ▣ bridge_attempted = true                   ← never fires twice
│
│      🟧 The SPECIFIC field matters — the whole sequence is written
│         to be filled in with their field, never generic "core".
│
├──① RESPECT — earn the right to say the next thing
│  ├── 🟦 BOT
│  │   Mechanical's a genuinely strong field — I'd never talk anyone
│  │   out of it.
│  │
│  │   Before I shortlist though, let me be straight with you about
│  │   something most counsellors won't say out loud.
│  ├── 🟧 Two jobs in three lines. Validates them, and "most
│  │      counsellors won't say this" opens a loop — they will READ
│  │      the next message instead of skimming it.
│  └── 🟥 ⚠ NEVER SKIP THIS BEAT. Jumping to "you should do CSE" makes
│         them defensive, and a defensive student stops tapping.
│
├──② THE JOKE — social proof, not a lecture · TWO bubbles, never one
│  ├── 🟦 BOT — bubble 1
│  │   There's a running joke in Indian engineering: whatever branch
│  │   you join, half the batch ends up writing code on placement day
│  │   anyway 😄
│  │
│  │   It's funny because it's largely true — the big recruiters hire
│  │   across branches for software roles.
│  ├── 🟦 BOT — bubble 2
│  │   The flip side is the bit people miss.
│  │
│  │   A CS student can work in almost any INDUSTRY — automotive,
│  │   aerospace, healthcare, finance — because all of them run on
│  │   software now. What they can't do is sign off a bridge 😄
│  │
│  │   So it's not that core is weaker. It's that the software door
│  │   is wider, and it opens from both sides.
│  └── 🟧 WHY IT WORKS
│      ├── A joke they've already heard reads as shared truth, not a
│      │   sales line.
│      ├── "Can't sign off a bridge" is the credibility purchase. You
│      │   conceded something. They noticed.
│      └── "Not that core is weaker" protects their identity. Nobody
│          books with someone who just insulted their dream.
│
├──③ THE OFFER — a tap, not a question
│  └── 🟦 BOT
│      So here's what I'd actually suggest.
│
│      Let me show you colleges where you learn AI and coding
│      properly — and you can still point that at robotics,
│      automation or EV, which is where mechanical is heading anyway.
│
│      You keep the interest. You just get the wider door.
│
│      Want to see those?
│
│      [ Yes, show me ]  [ I want pure mechanical ]  [ Tell me more first ]
│
└──④ THE FORK — three outcomes
```

### 3.2-F1 · [ Yes, show me ] — the convert · ~60% expected

```
╔══════════════════════════════════════════════════════════════════════╗
║  ▣ branch = cse_ai                                                   ║
║  ▣ core_interest = mechanical   ← KEPT. This is critical.            ║
║  ▣ bridge_attempted = true                                           ║
║                                                                       ║
║  🟦 Good call — that's the combination that actually holds up.       ║
║                                                                       ║
║  ►► B4 · PRIORITY.  NIAT now eligible for the shortlist.             ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 3.2-F3 · [ Tell me more first ] — one bubble, then back · ~10%

```
One evidence bubble, FIELD-SPECIFIC — then back to the same three
buttons. Never a second full pitch. Concrete roles, not adjectives.

├── 🟦 MECHANICAL
│   Short version — mechanical is going software-heavy fast.
│   Robotics and factory automation, EV battery and motor control,
│   simulation and digital twins, CAD automation.
│   Every one of those needs someone who can code. That person is
│   usually the one leading the project, not assisting on it.
│
├── 🟦 CIVIL
│   Short version — civil is going digital fast.
│   BIM, smart infrastructure, structural simulation, drone survey
│   and site analytics.
│   The person who can code is the one running those projects.
│
└── 🟦 ECE / EEE
    Honestly, ECE sits closest of all to this.
    Embedded systems, IoT, robotics, chip design tooling — all of it
    is code on top of hardware. Adding AI properly means you can go
    hardware OR software, and you keep both doors open.

Then:

🟦 BOT
   Want me to show you programs built around exactly that?

   [ Yes, show me ]   [ I want pure mechanical ]
```

### 3.2-F2 · [ I want pure mechanical ] — THE HONEST EXIT · ~30%

```
🟧 THE HARDEST MESSAGE IN YOUR ENTIRE FLOW, AND WORTH GETTING RIGHT

   This student has answered three questions honestly and is now going
   to be told you can't help them. Handled badly, that's a bait-and-
   switch — and the people who feel bait-and-switched are the ones who
   tell their friends. Handled well, it's the message that makes you
   look like the only honest counsellor they spoke to.

   The good news: B3 is the EARLIEST POSSIBLE HONEST MOMENT. You
   haven't asked budget, city, or anything personal yet. Three taps of
   their time. That's recoverable.
```

```
THE THREE JOBS THIS MESSAGE MUST DO

1 ▸ OWN THE LIMIT — never imply the problem is their choice
    ❌ "we don't really cover that"        ← sounds like a brush-off
    ✅ "that's my limit, not your choice"  ← sounds like a professional

2 ▸ PAY THEM ON THE WAY OUT
    One genuinely useful piece of free advice. It costs nothing and it
    is the entire difference between "they wasted my time" and "that
    guy was straight with me."

3 ▸ LEAVE ONE DOOR OPEN, THEN STOP
    One soft re-offer. Not two. Nagging after a clean decline turns a
    neutral exit into a bad review.
```

```
B3.2-F2  ·  PURE CORE — THE HONEST EXIT     ✅ VARIANT B (locked default)
   terminal node · warm close · no nudge sequence

├── 🟩 STUDENT
│   [ I want pure mechanical ]
│
├── 🟦 BOT — bubble 1 · respect the decision, fully
│   Respect — and honestly, if mechanical is what you want, you
│   should do mechanical. Clear decisions beat hedged ones.
│
├── 🟦 BOT — bubble 2 · own the limit
│   I should be straight with you about my own limits though.
│
│   GuideXpert's depth is in CSE and AI-based careers — that's what
│   I can genuinely shortlist and compare properly. For pure
│   mechanical I'd be guessing, and I'd rather tell you that than
│   send you somewhere wrong.
│
├── 🟦 BOT — bubble 3 · ★ THE GIFT
│   What I can do is hand you the checklist I'd use if I were
│   picking a mechanical college myself:
│
│   •  Go SEE the workshop and labs. Photos lie.
│   •  Ask which simulation tools they actually teach —
│      SolidWorks, ANSYS, CATIA — and who teaches them.
│   •  Ask for CORE placement numbers specifically, not the
│      overall percentage. The gap is usually large.
│   •  Ask about internship tie-ups with auto or manufacturing
│      firms, by name.
│   •  If a PSU is the goal, ask what GATE support looks like.
│
│   Ask any college those five and you'll learn more than a
│   brochure will ever tell you.
│
├── 🟦 BOT — bubble 4 · one door, then stop
│   And if you ever want to look at the AI-plus-mechanical route —
│   robotics, automation, EV — I'm right here. No pressure at all.
│
│   All the best, genuinely. 👍
│
│   [ Thanks, that helps ]   [ Actually, tell me about that route ]
│
├── 🟧 WHY BUBBLE 3 IS THE WHOLE MESSAGE
│   Everything before it is you saying no. Bubble 3 is you giving them
│   something you didn't have to give.
│
│   That checklist is real senior-counsellor advice — the core-vs-
│   overall placement gap alone will save this student from one bad
│   decision. It costs nothing, can't be misused, and reframes the
│   exchange from "they couldn't help me" to "they helped me anyway."
│
│   ★ That's the bubble that earns the referral. A mechanical student
│     with a CSE-bound friend is worth more than the shortlist you
│     couldn't give them.
│
├── 🟧 WHY B3 IS THE RIGHT PLACE TO DISCLOSE SCOPE
│   Three taps spent, nothing personal asked. Putting "we only cover
│   CSE" in B1 instead would kill the ~60% who convert at the bridge.
│   → Revisit ONLY if the anger-rate at this node runs high.
│
└── ▣ SAVES
    branch = core · core_interest · bridge_attempted = true ·
    bridge_closed = true · status = out_of_scope_core ·
    stage = parked_core · exit_reason = scope_limit

    ★ bridge_closed matters most. If this person returns in three
      months and this flag isn't checked, the bot runs the whole
      mechanical pitch at them a second time — and that is the version
      that gets screenshotted.
```

### 3.2-F2-A · VARIANT A — if human counsellors DO cover core

```
⚠ NOT ACTIVE. Locked default is Variant B. Written and ready.

   Variant A converts a "lost" lead into a booking.
   Variant B is an honest, warm exit.

   🟥 Only use Variant A if it is TRUE. Booking a mechanical student
      with a CSE-only counsellor is worse than not booking them —
      that's the version they complain about publicly.

Bubble 2 changes:

🟦 BOT (2 — variant A)
   Quick note on how this works: I'm the AI side, and my depth is
   CSE and AI careers. But our human counsellors do cover core
   branches properly.

   So rather than me guessing at mechanical, let me put you with
   someone who actually knows it.

Bubble 3 (the checklist) stays EXACTLY as above.

Bubble 4 becomes a booking:

🟦 BOT (4 — variant A)
   Want me to book you a session with a counsellor who covers
   core branches?

   [ Yes, book it ]   [ Just the checklist is fine ]
   → [ Yes, book it ] ►► B10.2 · straight to slot selection
```

### 3.2-F2 · The follow-up branches

```
╔══════════════════════════════════════════════════════════════════════╗
║  [ Thanks, that helps ]                          the clean exit      ║
╠══════════════════════════════════════════════════════════════════════╣
║  🟦 Good luck with it — and if a friend's looking at CSE or AI,      ║
║     send them my way 🙂                                              ║
║                                                                       ║
║  ▣ status = out_of_scope_core   ▣ stage = parked_core                ║
║  🟥 ⚠ NO follow-up nudges. Not at 4h, not at 24h, not at 2 days.     ║
║       This lead is closed WARMLY, not paused. B10-F does not fire.   ║
╚══════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════╗
║  [ Actually, tell me about that route ]          they came back      ║
╠══════════════════════════════════════════════════════════════════════╣
║  🟦 Happy to. Two quick taps and I'll show you programs where you    ║
║     build AI and coding properly, with project work that runs into   ║
║     robotics and automation.                                          ║
║                                                                       ║
║  ▣ branch = cse_ai   ▣ core_interest = mechanical  (KEPT)            ║
║  ►► B4 · PRIORITY. Normal flow through to B10.                       ║
║                                                                       ║
║  🟥 ⚠ Do NOT re-run the joke or the pitch. They already heard it and ║
║     came back on their own. Acknowledge in one line and move. Never  ║
║     a word of "I told you so" — not even implied warmth about them   ║
║     changing their mind.                                              ║
╚══════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════╗
║  😠 "so you wasted my time" / "why did you even ask"                 ║
╠══════════════════════════════════════════════════════════════════════╣
║  🟦 That's fair, and I'm sorry — I should have flagged my scope      ║
║     earlier. You're right to be annoyed.                             ║
║                                                                       ║
║     The checklist above is the same one I'd give a student who paid  ║
║     for a session, so at least take that with you. Genuinely wishing ║
║     you well with it.                                                 ║
║                                                                       ║
║  🟥 ⚠ Apologise ONCE, cleanly. No defending, no explaining the       ║
║     business model, no re-pitching. Then stop talking.               ║
║  🟥 ⚠ Flag for ops review — repeated anger here means the scope      ║
║     should surface earlier.                                          ║
╚══════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════╗
║  🟩 they ask a mechanical question anyway                            ║
║     "which is better, NIT Warangal or VIT for mech?"                 ║
╠══════════════════════════════════════════════════════════════════════╣
║  🟦 I'd be guessing if I ranked those for you, and you deserve       ║
║     better than a guess. What I'd do is run both through those five  ║
║     questions above — especially core placement numbers. That'll     ║
║     separate them faster than any ranking will.                      ║
║                                                                       ║
║  🟥 ⚠ Never fabricate a comparison to seem useful. Redirect to the   ║
║     METHOD instead of the answer — that IS useful, and it's honest.  ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 3.2-P4 · Paying off the conversion — the part everyone forgets

```
🟧 IF YOU CONVERT THEM AT B3, YOU MUST PAY IT OFF AT B8 AND B9.
   Otherwise the student books, arrives, finds pure software, and
   churns — which costs more than never converting.

   core_interest was stored for exactly this reason.

B8 · SHORTLIST — the NIAT line rewrites itself
──────────────────────────────────────────────────────────────────
DEFAULT
  "NIAT — AI-first and project-heavy, with a placement-focused
   structure."

WHEN core_interest = mechanical
  "NIAT — AI-first and project-heavy. Their project work runs into
   robotics and automation, which is exactly where your mechanical
   interest points."

WHEN core_interest = civil
  "NIAT — AI-first and project-heavy, with strong simulation and data
   work — the same skills driving BIM and smart infrastructure."

B9 · FIT — one extra reason line fires
──────────────────────────────────────────────────────────────────
  "You came in leaning mechanical, and this keeps that door open —
   robotics and automation are where those two fields meet."

🟥 ⚠ GUARD RAIL
   Only write these lines if they are TRUE of NIAT's actual
   curriculum. If NIAT has no robotics or automation project work,
   delete this section entirely and convert on the honest pitch alone.
   A promise made at B8 that the campus doesn't keep is a refund, not
   a conversion.        ← OPEN ITEM ◆ NIAT-2
```

### 3.2-P5 · Fork guard rails

```
🟥  RUN THE BRIDGE ONCE. EVER.
    bridge_attempted = true. If they said "pure mechanical", the
    subject is closed permanently. Raising it again reads as a
    salesman who didn't listen.

🟥  NEVER SAY THESE — checkable, and they break you
    ✗ "core branches are a waste"
    ✗ "you won't get placed in mechanical"
    ✗ "CSE students can do any other branch's JOB"     ← use INDUSTRY
    ✗ any specific placement % or salary you cannot source
    ✗ "unfortunately we can't help you"                — passive, cold
    ✗ "mechanical isn't really our thing"              — dismissive
    ✗ "you should reconsider CSE"                      — you asked once

🟥  THE PURE-CORE PATH IS NOT A FAILURE STATE.
    Under Variant A it shortlists honestly, reaches B10, and books.
    Under Variant B it exits warmly and earns referrals. If your
    catalog genuinely has nothing for a core student, say so and route
    to the 1-on-1 — do not fake a shortlist.

🟥  IF is_parent = true — SWAP THE JOKE FOR THE ROI VERSION.
    Parents don't want banter, they want the money argument:
    "Both are good fields. The practical difference is that software
     roles hire in larger numbers and across more industries, so the
     job market is simply wider. That's the honest reason I'd nudge
     toward it."
    And on the exit, drop the emoji and tighten it — parents read
    hedging as evasion.

🟥  DO NOT FIRE THIS AT R7 TIER-1 STUDENTS.
    Someone who just said "i failed" or "my parents are forcing me" is
    not in a state to be nudged on branch choice. Handle the emotion,
    let them pick freely, move on. If they reached the bridge anyway,
    skip the fork and go straight to the checklist + warm exit.

🟥  EXPECT ROUGHLY A THIRD TO HOLD FIRM ON CORE. BUILD THAT PATH PROPERLY.
    A student who says "no thanks, I want mechanical" and still gets a
    thoughtful checklist and a dignified close is worth more than a
    reluctant CSE conversion — because they'll tell their friends you
    were the counsellor who actually listened. That referral is
    cheaper than any ad you're running.
```

---

## B4 · PRIORITY

```
B4  ·  PRIORITY   (was: v2 B1 · GOAL)
   fires after B3 · the strongest reweighting signal in the flow
   1 tap · list · ★ 9 rows, up from the company flow's 7

├── 🟧 PURPOSE
│   Capture the single dimension the student will actually judge a
│   college on. This is what B5 and B9 pay back, and what B8's weights
│   turn on.
│
├── SKIP IF ........ `priority` already stated — "i just want good
│                    placements" anywhere earlier fills it.
│
├── 🤖 COPY
│
│      Last question — then I've got something useful for you.
│
│      When you're choosing a college, what matters most to you?
│
├── 🎛 INPUT — WhatsApp LIST. Button: "What matters most"
│
│      1  💼 Placements
│      2  🚀 Internships & real projects
│      3  📚 Updated, industry-relevant curriculum
│      4  👨‍🏫 Faculty quality
│      5  🏫 Campus life, clubs & sports
│      6  💰 Fees & scholarships
│      7  📍 Location — close to home
│      8  🎓 Higher studies later (MS / MBA)      ← ★ RESTORED
│      9  🚀 Startup / building my own thing      ← ★ RESTORED
│
├── 4.1 · WHAT EACH ROW DOES
│      Placements ....... ▣ careerGoalAlignment ↑ · placement tags ↑
│                         🟦 "Noted — placements first. That genuinely
│                             changes what I'd recommend, so thanks
│                             for being clear."
│      Internships ...... ▣ project/industry tags ↑
│      Curriculum ....... ▣ curriculum-recency tags ↑
│      Faculty .......... ▣ faculty tags ↑
│      Campus life ...... ▣ campus tags ↑
│      Fees ............. ▣ budgetFit ↑↑ · scholarship_flag = true
│                         ▣ budget hint = likely under ₹2L
│                         🟦 "Completely fair — and there are genuinely
│                             good options in that range."
│      Location ......... ▣ locationFit ↑↑
│      Higher studies ... ▣ research / PG tags ↑
│                         🟦 "Useful to know — that changes which
│                             colleges actually make sense."
│      Startup .......... ▣ innovation tags ↑
│                         🟦 "Good — that's a different filter
│                             entirely, and a useful one."
│
├── 4.2 · IF THEY TYPE INSTEAD OF TAPPING
│      "i want good salary" ....... ▣ placements
│      "want to do research" ...... ▣ higher_studies
│      "want to start a company" .. ▣ entrepreneurship
│      "both placements and ai" ... ▣ [placements, curriculum] — the
│                                     ARRAY is fine, weight both
│      "i don't know" ............. ⚡ I-1
│
├── ▣ SAVES
│      priority (single or array) · priority_weight ·
│      scholarship_flag · budget hint
│
├── ⚠ GUARDS
│   ├── B4.1  "Last question" is a PROMISE. After B4, nothing may be
│   │         asked until the student has received B5. If a future
│   │         edit adds a question between B4 and B5, this line must
│   │         be removed. Breaking a stated promise in beat 4 poisons
│   │         the permission gate in beat 6. (L14)
│   │         ⚠ B6.5 does not violate this — it fires after B5 AND
│   │           after the student has said yes at B6.
│   ├── B4.2  If they tap "Fees & scholarships", B8 MUST lead with fee
│   │         reality — including for catalog colleges that are
│   │         expensive. Suppressing the fee for a partner college
│   │         when the student named fees as their top priority is the
│   │         exact bait-and-switch this flow exists to remove.
│   │         ⚠ It also makes B6.5 non-optional for this student.
│   └── B4.3  Multiple priorities are fine. Store the ARRAY.
│
└── ✎ CHANGED
       ✂ Buttons → LIST.
       ✎ Merged "Campus Life" and "Sports & Clubs" — same concern to a
         student, and it frees a row.
       ✎ "Affordable Fees" → "Fees & scholarships". Widens it to
         students whose constraint is funding rather than price, and
         matches what B10 offers.
       ✎ ★ RESTORED rows 8 and 9 from v2's B1. Without them, an
         MS-bound student and a founder-type both have to pick a row
         that misrepresents them, and the shortlist gets weighted for
         the wrong thing. WhatsApp allows 10 rows; using 9 costs
         nothing. See 2.3.
       ✎ Added "Last question". Four questions with no return is the
         steepest drop-off risk in this flow. Naming the end of the
         questioning is the cheapest possible fix.

►► B5
```

---

## ★ B5 · THE CHECKLIST — the first thing the student receives

```
B5  ·  CHECKLIST   (★ NEW — no v2 equivalent)
   fires always · ZERO taps · ONE bubble
   ★ the most important beat in the flow, and it asks for nothing

├── 🟧 PURPOSE
│   Pay back four questions with something genuinely useful the
│   student could act on even if they never reply again.
│
│   This beat is what BUYS the permission at B6. Cutting it to save a
│   turn collapses the gate — the yes-rate at B6 is the direct
│   measurement of whether B5 worked.
│
├── SKIP IF ........ never skipped on a first session.
│                    checklist_sent = true prevents re-send on return.
│
├── 🤖 COPY
│
│      Got it — {interest_phrase}, and {priority_phrase} is what
│      matters most.
│
│      Before I get to any college names, here's the part most
│      students skip.
│
│      Whatever college you're looking at — ours, someone else's, or
│      one your relatives recommend — check these seven before you
│      say yes:
│
│      ✅ When was the curriculum last updated?
│      ✅ Do students get real internships, or just certificates?
│      ✅ Does coding start in year 1, or year 3?
│      ✅ Are industry tools part of the syllabus, or extra classes
│         you pay for?
│      ✅ What percentage got placed — and at what median salary,
│         not the highest one?
│      ✅ How many faculty have actually worked in the industry?
│      ✅ Is there an alumni network you can reach today?
│
│      {priority_line}
│
│      Ask these at every campus visit. They'll tell you more than
│      any brochure.
│
├── 🧩 {interest_phrase} — read from interest_cluster
│      software .......... "so you're leaning towards software"
│      data_ai ........... "so AI and data is where your head is"
│      infra_security .... "so cloud and security interests you"
│      core (converted) .. "so you're coming at this from mechanical"
│      undecided ......... "so you're still weighing it up —
│                           completely normal at this stage"
│
├── 🧩 {priority_line} — ONE line, tied to their B4 answer
│      Placements ..... "Since placements matter most to you: ask for
│                        the median package and the percentage placed,
│                        not the highest package. One student with a
│                        ₹40L offer can carry a whole brochure."
│      Internships .... "Since internships matter most to you: ask
│                        which companies took interns last year, by
│                        name, and how many converted to jobs."
│      Curriculum ..... "Since curriculum matters most to you: ask to
│                        see the actual syllabus PDF for year 1. If it
│                        takes more than a day to produce, that tells
│                        you something."
│      Faculty ........ "Since faculty matter most to you: ask how
│                        many are PhD-holders versus industry-
│                        experienced. You want both, in different
│                        subjects."
│      Campus life .... "Since campus life matters most to you: ask to
│                        visit on a normal working day, not an open
│                        day. Ask a second-year student, not a guide."
│      Fees ........... "Since fees matter most to you: ask for the
│                        full four-year cost — tuition, hostel, exam
│                        fees, everything — and get the scholarship
│                        criteria in writing before you pay a deposit."
│      Location ....... "Since staying close to home matters most to
│                        you: check the actual commute at 8am on a
│                        weekday, not on Google Maps at midnight."
│      Higher studies . "Since you're thinking MS or MBA later: ask
│                        what percentage of their grads go on to
│                        postgrad, and whether faculty write
│                        recommendation letters that carry weight."
│      Startup ........ "Since you want to build something: ask
│                        whether there's an incubator you can actually
│                        access as an undergrad, and how many student
│                        companies came out of it last year."
│
├── ▣ SAVES
│      checklist_sent = true    ← B5 never re-sends, even days later
│
├── ⚠ GUARDS
│   ├── B5.1  NO college name appears in this beat. None. The
│   │         checklist is credible precisely because it is given
│   │         before we have anything to sell. Naming a college here
│   │         converts advice into an ad and the student feels the
│   │         switch.
│   ├── B5.2  The checklist must be one the student can genuinely use
│   │         AGAINST US. If any item is written so that only our
│   │         catalog can pass it, it is no longer advice. Re-read it
│   │         before every edit with that test.
│   ├── B5.3  Send as ONE bubble. Splitting it turns a useful artefact
│   │         into a wall of notifications.
│   └── B5.4  This bubble is the thing students screenshot and forward.
│             Write it to survive being read with no context.
│
└── ✎ CHANGED
       ✅ The seven checks are kept from the company's Stage 5 — the
         strongest content in that document, and the reason the flow
         works at all.
       ✎ Each check sharpened from a yes/no into a question the student
         can actually ask out loud. "How good are the placements?" is
         not answerable. "What's the median package and placed
         percentage?" is.
       ✎ Added {priority_line}. Four questions were asked; this is
         where the answers visibly come back. Without it, B3 and B4
         read as data collection.
       ✎ Added "ours, someone else's, or one your relatives recommend".
         Explicitly inviting the student to point the checklist at US
         is what makes it land.
       🟪 ✂ REPLACES v2's entire Phase 4 modern-education block — six
          turns of pedagogy theory delivered to a student who has seen
          zero colleges. That block was v2's #1 predicted drop-off.

►► B6
```

---

## ★ B6 · PERMISSION — the only gate in the path

```
B6  ·  PERMISSION   (★ NEW — no v2 equivalent)
   fires immediately after B5, same turn, separate bubble · 1 tap

├── 🟧 PURPOSE
│   Get an explicit yes before recommending anything. The yes is what
│   makes B8 feel requested rather than pushed, and it is the cleanest
│   intent signal in the whole conversation.
│
├── SKIP IF ........ the student already asked for colleges — "which
│                    college should i join", "suggest colleges" —
│                    anywhere earlier. Do not ask for permission that
│                    was already given. ►► B6.5
│
├── 🤖 COPY
│
│      Want me to shortlist a few colleges that actually match this —
│      instead of a random top-10 list?
│
├── 🎛 INPUT — WhatsApp BUTTONS (2)
│
│      [ Yes, show me 👍 ]      [ Not right now ]
│
├── ▣ SAVES
│      permission_recommend = true | false
│      temperature = hot (on yes)
│
├── ⚠ GUARDS
│   ├── B6.1  "Not right now" is a REAL answer and is honoured. It
│   │         does NOT loop, re-ask, or re-pitch in the same turn:
│   │
│   │            No problem 😊 The checklist above works on any
│   │            college, so you've got something to use either way.
│   │
│   │            I'm here whenever you want the shortlist — just
│   │            message me.
│   │
│   │         → ONE follow-up at 24h, then silence. (L12 — this
│   │           student never got a shortlist, so they get one nudge,
│   │           not two.)
│   └── B6.2  Never re-ask this gate later in the same session.
│             Asking twice is the moment the student realises the "no"
│             was decorative.
│
└── ✎ CHANGED
       ✅ Kept — the best structural decision in the company flow.
       ✎ "Maybe Later" → "Not right now". "Maybe" invites us to
         re-ask. "Not right now" is a clean no we can honour, which is
         the entire point of having a gate.
       ✎ Kept "instead of a random top-10 list" — it names what the
         student is actually afraid of getting.

►► B6.5   (if yes)
►► EXIT 2 · soft-close, ONE follow-up in 24h   (if no)
```

---

## ⚠ B6.5 · CONSTRAINTS — conditional

```
B6.5  ·  CONSTRAINTS   (was: v2 B3 · LIMITS — MOVED)
   fires ONLY if budget or city is unknown · up to 2 taps
   ⚠ THE ONE BEAT ADDED BEYOND THE COMPANY'S TEN — see PART 2.2

├── 🟧 PURPOSE
│   Make the shortlist realistic. budgetFit 12 + locationFit 14 = 26
│   of the weights matrix. Without these, B8 scores on a matrix with a
│   quarter of its inputs empty and no way for the student to tell.
│
├── 🟧 WHY IT SITS AT 6.5 AND NOT AT 3
│   v2 asked these at beat 3, before the student had received
│   anything — two personal questions in exchange for nothing, the
│   highest-friction placement available.
│
│   Here they land AFTER the checklist and AFTER an explicit "yes,
│   show me". Same two taps, entirely different felt cost: they are
│   refinements to something the student asked for, not a toll on the
│   way in. (L14)
│
├── FIRES ONLY IF ... budget_band is unknown, OR city_pref is unknown.
│                     Asks ONLY the missing one. Never both if only
│                     one is missing.
│
├── SKIP ENTIRELY IF  both already known — R3 over-answerers, R4-C
│                     fees-first entrants, or anyone who volunteered
│                     a city. On current volumes ≈ a third of leads
│                     never see this beat.
│
├── 🤖 COPY — the framing line, sets the expectation that this is short
│
│      Two quick ones so the list stays realistic 👇
│
├── 6.5.1 · BUDGET
│
│      🤖 What's comfortable for your family, per year?
│
│         [ Under ₹2L ]   [ ₹2–5L ]   [ ₹5L+ ]
│
│         _Why I ask: it keeps the options practical._
│
│      ├── ▣ budget_band saved
│      ├── [ Under ₹2L ] → ▣ scholarship_flag = true, aid surfaced
│      │                     in the B8 lines themselves
│      ├── "not sure" / "depends" →
│      │      🤖 No problem — I'll show a range and we can narrow
│      │         later.
│      │      ▣ budget_band = unknown → 6.5.2
│      └── "we can't afford much" → ⚡ I-2
│
├── 6.5.2 · LOCATION
│
│      🤖 Last one — near home, or open to moving?
│
│         [ Near home ]   [ Open to move ]   [ Metro cities ]
│
│         _Why I ask: location changes what's realistic._
│
│      ├── ▣ city_pref saved
│      ├── [ Near home ] → uses `state` from profile if known
│      │      ◆ if state unknown → 🤖 "Which city are you in?"
│      │        (free text — one of the few places it's correct)
│      └── "hyderabad only" → ▣ city = Hyderabad  ✅ accept typed
│
├── ▣ SAVES
│      budget_band · scholarship_flag · city_pref · city · state
│
├── ⚠ GUARDS
│   ├── 6.5a  KEEP the "Why I ask" lines. They are the single
│   │         strongest counsellor signal in the existing engine, and
│   │         they are already written. Use them MORE, not less.
│   ├── 6.5b  "Last one" is a PROMISE. Nothing may be asked after it
│   │         before B8. Everything else is an interrupt now.
│   ├── 6.5c  Never react to a low budget with anything but warmth.
│   └── 6.5d  ⚠ NON-OPTIONAL if priority = fees. A student who named
│             money as their binding constraint and is never asked
│             their range gets a shortlist that cannot honour it.
│
├── 🟪 ✂ WHAT v2 ASKED HERE AND THIS DOES NOT
│      family view ........ → ⚡ I-3, fires only if THEY raise it
│      biggest concern .... → ⚡ I-4, fires on detection
│      hostel ............. → answered at B8 / B10 if asked
│      coding experience .. → inferred, or ⚡ I-9
│      higher studies ..... → now a B4 row, not a separate question
│
└── ◆ OPEN DECISION 6.5-a
      Delete this node and the flow runs at exactly 8 turns, scoring
      without budgetFit or locationFit. Defensible for a 3-college
      catalog. NOT defensible if B8 ever expands past 3, or while the
      "Fees & scholarships" row stays in B4. One line to remove.

►► B7
```

---

## B7 · TWO MODELS — how to read the list that's coming

```
B7  ·  TWO MODELS   (was: v2 B4 · BRIDGE — rewritten)
   fires after permission = true · ZERO taps · ONE bubble
   ⚠⚠ THE HIGHEST-RISK BEAT IN THE FLOW FOR CREDIBILITY

├── 🟧 PURPOSE
│   Give the student the frame they need to read B8's shortlist, and
│   name the trade-off honestly in BOTH directions before we show a
│   catalog that leans one way.
│
├── SKIP IF ........ student is already enrolled / has admission
│                    confirmed.
│
├── 🤖 COPY
│
│      Before the names — one thing that'll help you read them.
│
│      You're really choosing between two models, not just two
│      campuses.
│
│      🏛️ *Established colleges* — university degree, known name, big
│      alumni base, usually cheaper. Curriculum updates on a
│      university cycle, so it moves slower. Quality varies enormously
│      between the good ones and the rest.
│
│      🚀 *Newer industry-linked institutes* — coding and projects
│      from year 1, curriculum updated yearly, close industry ties.
│      But they're new: smaller alumni networks, shorter placement
│      track records, and usually higher fees. Some are excellent.
│      Some are marketing.
│
│      Neither one wins by default. The checklist above is how you
│      tell a good one from a bad one *within* either group — and
│      that's the honest answer.
│
├── ▣ SAVES
│      frame_sent = true
│
├── ⚠ GUARDS
│   ├── B7.1  ⚠⚠ If this reads as an argument for one side, everything
│   │         after it is discounted — including B8, which is the
│   │         payload. The trade-offs listed AGAINST the new-age model
│   │         are not softeners. They are the reason the beat is
│   │         believed.
│   ├── B7.2  "Some are excellent. Some are marketing." STAYS IN. It
│   │         is the line that tells the student we are not simply
│   │         selling the second column — and it is true.
│   ├── B7.3  No college is named here. Names are B8.
│   ├── B7.4  Never claim established colleges "start placements in
│   │         the final year" or "focus on exams over skills" as a
│   │         CATEGORY. Not true of NITs, IIITs, BITS, VIT, or a long
│   │         list of state colleges. A student holding one of those
│   │         offers catches it instantly, and one false claim costs
│   │         the whole thread.
│   └── B7.5  NO permission gate here. Do not ask "does that make
│             sense?" The student did not come for a lesson.
│
└── ✎ CHANGED
       ✂ CUT: the company Stage 7's six-bullet negative column against
         traditional colleges — "curriculum updates less frequently",
         "more focus on exams than practical skills", "placements
         usually start in the final year". Stated as facts about a
         whole category, and not defensible. The father who did his BE
         at a government college is often the person reading over the
         student's shoulder.
       ✎ REPLACED with an honest two-model comparison naming real costs
         on both sides. This converts BETTER, not worse: a student who
         sees us volunteer the weakness of the option we're about to
         recommend trusts the recommendation.
       ✅ KEPT the underlying insight, which was correct — the
         difference that matters is how well the college prepares you
         for work, not the campus. It survives as the closing sentence,
         tied back to the checklist.
       🟪 ✂ SUPERSEDES v2's B4 one-bubble bridge ("projects, mentorship
          and internships are what move the needle"). That version was
          persuasive and one-sided; this one survives being read by a
          parent. v2's two-bubble variant is retired with it.

►► B8
```

---

## ★ B8 · SHORTLIST — the payload

```
B8  ·  SHORTLIST   (was: v2 B5 · LIST)
   fires after B7 · ZERO taps — they receive, they don't choose yet
   ★ THIS IS TURN 7. In the current shipped build it is turn ~11.

├── ▣ ENGINE — RECOMMENDATION_WEIGHTS, unchanged from v2
│      courseMatch 28 · locationFit 14 · careerGoalAlignment 12 ·
│      priorities 12 · budgetFit 12 · learningStyle 8 ·
│      careerPriority 8 · concernMitigation 8 · parentConstraints 6
│
│      ⚠ budgetFit + locationFit = 26 of that total. They are only
│        populated if B6.5 fired or the slots were volunteered.
│
├── SKIP IF ........ never skipped once permission = true.
│                    Does NOT fire at all if interest_cluster = core
│                    and the student took the pure-core exit at B3.2.
│
├── 🤖 COPY
│
│      From what you've told me — {interest_phrase},
│      {priority_phrase} — these five are worth looking at:
│
│      *Newton School of Technology* — {differentiator_1}
│      *NIAT* — {differentiator_2}
│      *Scaler School of Technology* — {differentiator_3}
│      *Plaksha University* — {differentiator_4}
│      *Kalvium* — {differentiator_5}
│
│      Straight up: these are colleges GuideXpert works with, so we
│      know them well — and you should weigh that. Run all five
│      through the seven checks above, and run any other college
│      you're considering through the same list.
│
│      They're different from each other in learning style, fees and
│      location, so the right one depends on you.
│
├── 🧩 THE DIFFERENTIATORS — ⚠ OPEN ITEM, must be written before ship
│
│      ONE line per college. A factual, verifiable structural
│      difference — never an adjective. Written by the content team,
│      approved once, stored as data, read at render time and ordered
│      by `priority`.
│
│      Template:  {structural fact} + {what that means for THEIR
│                  stated priority}
│
│      Example shape (fill with verified facts):
│        "four-year degree with X, project-based from semester 1 —
│         strongest fit if you want internships early"
│
│      ⚠ If a factual differentiator cannot be verified, that college
│        does not appear. An unverifiable line is worse than a missing
│        college.
│
├── 8.1 · CORE-CONVERT OVERRIDE
│      if core_interest is set → the NIAT line rewrites itself per
│      3.2-P4. This is the payoff for converting at B3.2, and skipping
│      it is how a converted student churns in semester one.
│
├── 8.2 · SCHOLARSHIP OVERRIDE
│      if scholarship_flag = true → aid must be surfaced in the LINES
│      THEMSELVES, not deferred to B10.
│
├── 8.3 · PRIORITY = FEES OVERRIDE
│      B8 leads with fee reality, including for catalog colleges that
│      are expensive. See B4.2. This is non-negotiable.
│
├── 8.4 · THE WIDER CATALOG — on tap only
│      👤 "show me all" / "what are the other options" / "full list"
│      🤖 the wider institution list —
│         Masters' Union · Krea · Ahmedabad Univ · UPES · SRM AP
│      ⚠ same disclosure line applies.
│
├── ▣ SAVES
│      shortlist_shown[] (in display order) · shortlist_timestamp
│
├── ⚠ GUARDS
│   ├── B8.1  ✂ NO RANKING. The company flow ranked these 🥇🥈🥉.
│   │         Delete the medals. Five options, presented flat. B9
│   │         narrows with a counsellor-style recommendation — reason
│   │         stated first — not medals.
│   ├── B8.2  ✂ DISCLOSURE IS MANDATORY (L13). Not optional, not moved
│   │         to the end, not softened.
│   ├── B8.3  Exactly five by default (Newton · NIAT · Scaler ·
│   │         Plaksha · Kalvium). Flat. No Best Match tiers.
│   ├── B8.4  ONE sentence per college, tied to THEIR priority.
│   ├── B8.5  Only list colleges you can describe HONESTLY.
│   └── B8.6  No claim about salary, placement percentage or
│             "guaranteed placement".
│
└── ✎ CHANGED
       ✂ Removed the 🥇🥈🥉 ranking from the company flow.
       ✎ ★ Added the disclosure line.
       ✎ Happy-path product update: shortlist is FIVE flat new-age
         colleges (not three). Polar is not in catalog — use Plaksha
         / Kalvium until a verified Polar partner row exists.
       ✎ Moved "Would you like me to help you find the best fit?" out
         of this beat into B9.

►► B9
```

---

## B9 · FIT — counsellor narrowing (NIAT pitch on yes)

```
B9  ·  FIT   (was: v2 B6 · THE CASE)
   fires immediately after B8, same turn, separate bubble · 1 tap

├── 🟧 PURPOSE
│   Take the student from five flat options to one clear next step,
│   using THEIR stated priority as the reason — senior-counsellor
│   narrative leaning *NIAT* when the catalog fits — and pass honestly
│   when the profile is clearly out of catalog.
│
├── SKIP THE ASK IF  student has already named one of the five —
│                    "tell me about NIAT" → go straight to that path.
│
├── 🤖 COPY — the ask
│
│      Want me to narrow it down to the one that fits you best?
│
├── 🎛 INPUT — BUTTONS (2)
│
│      [ Yes, narrow it down ]      [ I'll look them up myself ]
│
├── 🤖 COPY — the answer (if yes) · NIAT, REASON STATED FIRST
│
│      Sure 😊
│
│      You said {priority_phrase} matters most, and you're interested
│      in {interest_phrase}. On that specific basis, I'd look at
│      *NIAT* first — {reason_tied_to_priority}.
│
│      Here is how I usually explain it:
│      • Curriculum — industry-linked, refreshed often, coding early
│      • Internships — real work exposure, not certificate theatre
│      • Industry ties — mentors / partner ecosystems (named on call)
│      • Environment — applied learning and peer building
│
│      That's my read from what you've shared — not a verdict.
│      The other four may suit you better once someone has seen your
│      marks, budget and where you can actually study.
│
│      Which is exactly what a short counsellor call is for.
│
├── 🤖 COPY — ★ THE HONEST PASS
│      (fires when profile is clearly out-of-catalog)
│
│      Being straight with you — from what you've shared, I'm not
│      sure any of these five is the obvious fit…
│
├── 9.1 · [ I'll look them up myself ] — honoured immediately, no re-pitch
├── 9.2 · Compare-on-tap — compact 4-row factor block across the five
│
├── ▣ SAVES
│      fit_college · fit_reason · honest_pass_fired
│
├── ⚠ GUARDS
│   ├── B9.1  Reason is stated FIRST from their priority / interests.
│   ├── B9.2  "It's not a verdict" STAYS.
│   ├── B9.3  Honest pass remains a real path for out-of-catalog leads.
│   ├── B9.4  Possibility language ONLY. No salary / placement guarantees.
│   └── B9.5  Self-lookup is honoured once — no same-turn re-pitch.
│
└── ✎ CHANGED
       ✎ Happy-path product update: on yes, deliver a senior-counsellor
         NIAT case (curriculum / internships / industry ties /
         environment) then hand to B10 hybrid book.
       ✂ Still no medals, no vision bubble, no manufactured hesitation.

►► B10
```

---

## B10 · BOOK — the close

```
B10  ·  BOOK   (was: v2 B7 · BOOK — now actually completes a booking)
   fires after B9 · ALSO fires from anywhere on booking intent (L2)
   ★ THE ONLY GATE IN THE ENTIRE PATH IS BEHIND YOU. This is the close.

├── SKIP IF ........ booking_id already exists for this lead.
│
│  ── B10.1 · THE OFFER ──────────────────────────────────────────────
│
├── 🤖 COPY
│
│      You're at the point where one good decision saves a couple of
│      years of backtracking.
│
│      GuideXpert runs a free 1:1 session with a senior
│      counsellor{credential_clause}. It's 30 minutes, on a call, and
│      in it you'll get:
│
│      ✅ Whether NIAT — or one of the other four — actually fits your marks and budget
│      ✅ Which branch matches how you like to work
│      ✅ What the career paths after it realistically look like
│      ✅ Which scholarships you're eligible to apply for
│
│      No fee, and no obligation to join anything.
│
│      Shall I book you in?
│
├── 🎛 INPUT — BUTTONS (2)
│      [ 📅 Book my session ]      [ Not right now ]
│
├── 🟥 ⚠ GUARD — {credential_clause}
│      The company flow says "with an IITian". That clause renders
│      ONLY if the counsellor assigned to this student's queue
│      actually holds an IIT degree. If the roster cannot guarantee it
│      for this lead, the clause renders EMPTY and the copy reads
│      "a senior counsellor".
│
│      A student who books for an IITian and meets someone else has
│      been misled, will say so publicly, and is right to. This is L9,
│      and it is the one guard in this beat that is not negotiable.
│
├── 🟧 FOR A STUDENT WHO ARRIVED VIA R4-P
│      The invite names BOTH routes — "compare your rank options
│      against the aptitude-based ones" — which is a genuinely
│      stronger reason to book than either list alone.
│
│
│  ── B10.2 · THE SLOT ───────────────────────────────────────────────
│
├── 🤖 COPY  (fires on "Book my session", and directly from Node 0)
│
│      👍 When suits you?
│
├── 🎛 INPUT — LIST, generated live from counsellor availability
│      Button: "Pick a time"
│
│      1  Today, {slot_a}
│      2  Today, {slot_b}
│      3  Tomorrow, {slot_c}
│      4  Tomorrow, {slot_d}
│      5  This weekend
│      6  Some other time — I'll tell you
│
│      🟥 ⚠ Never show a slot that isn't genuinely free. A booking we
│         reschedule converts worse than one booked a day later.
│
│
│  ── B10.3 · THE NAME ───────────────────────────────────────────────
│
├── 🤖 COPY
│
│      Done — {slot_chosen} it is.
│
│      Last thing: what should I call you, and is this the best
│      number for the call?
│
├── 🎛 INPUT — free text  ← the ONLY typed answer in the whole flow
│      name only → assume this WhatsApp number, confirm
│      different number → ▣ callback_number
│
│      🟧 The WhatsApp profile name is already in the record from B1.
│      This asks anyway, because a booking confirmation carrying a
│      nickname the student didn't choose reads as careless at exactly
│      the wrong moment.
│
│
│  ── B10.4 · CONFIRMATION ───────────────────────────────────────────
│
├── 🤖 COPY
│
│      All set, {name} ✅
│
│      📅 {day}, {time}
│      👤 {counsellor_name}
│      📞 We'll call you on {number}
│
│      They'll have your answers already, so you won't repeat any of
│      this.
│
│      Two things to bring: your 12th marks (or expected marks), and
│      a rough budget range. Even approximate is fine — it makes the
│      30 minutes count.
│
│      If something comes up, just message me here and I'll move it 👍
│
│
│  ── B10.5 · HELPER MODE ────────────────────────────────────────────
│
├── 🤖 COPY — sent as a follow-on bubble
│
│      I'm still right here meanwhile — ask me anything about
│      placements, fees or scholarships while you wait.
│
│      [ Fees breakdown ] [ Placement info ] [ Hostel & safety ]
│      [ Scholarships ]
│
│      ✅ v2's post-booking assist unlock ships unchanged.
│
│
├── 10.6 · [ Not right now ]
│
│      🤖 Totally fine — no rush at all 🙂
│         I'm here whenever. Anything you want to dig into meanwhile?
│
│         [ Fees ] [ Placements ] [ Hostel & safety ] [ Scholarships ]
│
│      ├── ⚠ Accept it warmly. NEVER re-push immediately.
│      ├── ⚠ Answer whatever they pick, then stay available.
│      ├── ⚠ Offer booking again ONLY on FRESH intent — a new question
│      │     about a specific college, a new worry, or "actually can I
│      │     talk to someone".
│      └── ►► B10-F · two follow-ups, then silence
│
├── ▣ SAVES
│      booking_id · slot_datetime · counsellor_id · name ·
│      callback_number · lead_status = BOOKED
│      Full lead record pushed to the counsellor's CRM view BEFORE
│      the call.
│
├── ⚠ GUARDS
│   ├── B10.1  ★ The counsellor MUST receive qualification, goal,
│   │          interests[], priority, budget_band, city_pref,
│   │          shortlist_shown[] and fit_college before the call.
│   │          "They'll have your answers already" is a promise made in
│   │          the confirmation message. If the handoff is broken, the
│   │          student repeats everything — and the entire premise of
│   │          the flow, that we were listening, collapses at the
│   │          moment of highest expectation.
│   ├── B10.2  Do not say "free" more than once. The company flow says
│   │          it three times in one stage. Repetition of "free" reads
│   │          as a catch.
│   ├── B10.3  No countdown timers, no "only 3 slots left", no
│   │          manufactured scarcity. This product's entire position is
│   │          that it isn't the loudest advertiser.
│   ├── B10.4  ONE yes = ONE booking flow. v2's build asked at Phase 12
│   │          and AGAIN at Phase 13 — literally the "are you sure?"
│   │          your own spec forbids. Both gates are deleted.
│   ├── B10.5  URL_FORBIDDEN regex stays live everywhere except the
│   │          booking confirmation.
│   └── B10.6  Never dead-end after "yes". Helper mode stays live until
│              a human takes over.
│
└── ✎ CHANGED
       ✎ ★ THE BIG ONE: the company's Stage 10 ends at "Would you like
         to book your session?" and never books anything. No slot, no
         name, no confirmation. A lead that taps "Book My Session" and
         then hears nothing is worse than one that never tapped.
         B10.2–B10.4 close the loop.
       ✎ v2 sent a form URL. v3 books in the chat. A URL that gets
         opened and abandoned looks identical to a booking in your
         data and isn't one.
       ✎ "IITian" gated behind an actual-roster check.
       ✎ Added the confirmation card and the two-item prep list — prep
         raises show-up rate, and show-up rate is what "quality lead"
         actually means.
       ✅ Kept "one good decision now saves years of confusion later",
         the strongest line in the original Stage 10.

►► EXIT 1 · BOOKED
```

---

## B10-F · FOLLOW-UPS

```
B10-F  ·  FOLLOW-UPS   (★ NEW — replaces the company's 30min/1h/3h)

├── 🟧 PURPOSE
│   Recover the warm lead who didn't book, without becoming the thing
│   the flow spent nine beats promising it wasn't.
│
├── FIRES .......... on [ Not right now ] at B10.1, on B9.1, or on
│                    silence after B10.1 — i.e. ONLY for students who
│                    actually received a shortlist.
│
├── STOPS ON ....... any inbound message. A reply cancels all pending
│                    follow-ups immediately — including a reply that
│                    isn't a booking.
│
├── NEVER FIRES FOR
│      opted_out = true        — permanent, no exceptions
│      stage = parked_core     — closed warmly at 3.2-F2, not paused
│      escalated (R7 Tier 2)   — a human owns this conversation
│      permission_recommend = false — they never got a shortlist;
│                                     ONE 24h nudge only, not two
│
│  ── FOLLOW-UP 1 · +4 HOURS ─────────────────────────────────────────
│
│      Hi 👋 no pressure at all — just leaving this here.
│
│      The three colleges I mentioned, plus the seven checks, are
│      above whenever you want them.
│
│      And if you'd rather just talk it through with someone, the
│      session's still open. 30 minutes, free.
│
│      [ 📅 Book my session ]
│
│  ── FOLLOW-UP 2 · +2 DAYS ──────────────────────────────────────────
│
│      Last message from me on this 😊
│
│      Admission timelines move fast around now, so if you do want a
│      session, sooner is easier to schedule than later.
│
│      Either way — good luck with it. You can message me any time.
│
│      [ 📅 Book my session ]
│
│  ── THEN SILENCE. PERMANENTLY. ─────────────────────────────────────
│      The thread resumes only when the student sends something. On
│      their return the flow picks up at the last unfilled slot — it
│      does NOT restart at B1, and it does NOT re-send the checklist.
│      (L4 · checklist_sent)
│
└── ⚠ GUARDS
    ├── F.1  ✂ CUT the company flow's 30-minute / 1-hour / 3-hour
    │        cadence. Three chases inside three hours is the pattern of
    │        an aggressive lead-gen bot — exactly the behaviour B1's
    │        copy promises we are not. It also trains students to mute
    │        the number, which kills the return-visit path where a real
    │        share of bookings come from.
    ├── F.2  Follow-up 2 says "last message from me on this" and that
    │        must be TRUE. If a third fires, the flow has lied in
    │        writing.
    └── F.3  No urgency claim that isn't real. "Admission timelines
             move fast around now" is true in season and must be
             swapped out off-season.
```

---

# PART 8 · R2 – R13 · EVERY OTHER BUCKET IN FULL

```
LEAF COLOUR KEY
🟦 BOT   🟩 STUDENT   🟧 WHY   🟥 ⚠ GUARD RAIL   🟪 ✂ CUT   🟢 ✓ KEEP
```

---

## R2 · TYPES IT
### `~20%` ►► rejoins at **B2**

```
R2  ·  TYPES THE ANSWER INSTEAD OF TAPPING

├── 🟩 STUDENT
│   "im in 12th" · "inter final year" · "mpc" · "12 class mpc"
│   "just finished intermediate" · "diploma 3rd year"
│
├── ◆ CAN QUALIFICATION BE EXTRACTED WITH CONFIDENCE?
│   ├── YES · full match
│   │   ▣ save the slot, treat EXACTLY as a tap
│   │   🟦 "Perfect — MPC keeps engineering and tech wide open for you."
│   │   ►► B2
│   └── PARTIAL · "12th" but no stream
│       🟦 "Got it — 12th. Which stream?"
│          [ MPC ]   [ BiPC ]   [ MEC / CEC ]
│       ►► B2
│
├── 🟧 WHY
│   Roughly one in five ignores the list and types. They ANSWERED —
│   the answer just arrived in the wrong format. Extraction runs on
│   every message, not only the ones you expected.
│
└── 🟥 ⚠ NEVER reply "please select from the options." (L5) It is the
    single most robotic sentence this bot could produce. Rejecting
    valid input costs a lead; a one-tap confirmation costs two seconds.
```

---

## ⭐ R3 · OVER-ANSWERS
### `~8%` ►► **B4**, with B2, B3 and B6.5 ALL SKIPPED

```
R3  ·  THE OVER-ANSWERER — the whole test of your memory layer

├── 🟩 STUDENT
│   "im in 12th mpc, want cse, budget around 3 lakhs, hyderabad only"
│
├── ▣ SAVES — four slots from one line
│   ▣ qualification = 12th-MPC        → B1 done
│   ▣ interests / branch = CSE        → B3 SKIPS
│   ▣ budget_band = ₹2–5L             → B6.5 budget SKIPS
│   ▣ city = Hyderabad                → B6.5 location SKIPS
│   ▣ temperature = HOT — four facts unprompted is high intent
│
├── 🟦 BOT
│   That's really helpful, thanks — 12th MPC, CSE, around ₹3L,
│   Hyderabad. That's most of what I need already.
│
│   Just one thing left: what matters most to you?
│
│   [ Placements ]  [ AI & future tech ]  [ Affordable & safe ]
│
├── ►► B4 fires. B2, B3 and ALL of B6.5 skip. Then B5 → B6 → B7 → B8.
│   ★ ONE question instead of six. That is the entire payoff of the
│     memory layer, and this bucket is how you prove it works.
│
├── 🟧 WHY THIS IS THE BEST-CASE STUDENT
│   Students rarely answer in the order you ask. Extraction must run
│   on EVERY message, not just the ones you expected.
│
├── 🟥 ⚠ R3.1 — THE FAILURE TO AVOID
│   Asking for any of those four again. This is exactly where the
│   current bot loses people. They gave you everything and got asked
│   for it again — so they concluded nobody was listening, and left.
│
└── 🟥 ⚠ R3.2 — REFLECT BACK ONCE, AND BRIEFLY
    ✅ "12th MPC, CSE, around ₹3L, Hyderabad."       ← confirms you heard
    ❌ "So you're in 12th MPC and you want to do CSE and your budget is
        around 3 lakhs and you prefer Hyderabad, is that correct?"
        ← parroting, reads as robotic
```

---

## R5 · ASKS ABOUT US
### `~4%` ►► answer honestly, then **B1 / B2**

```
R5  ·  ASKS ABOUT US

├── 🟩 "is this a bot?"
│   └── 🟦 Yep — I'm GuideXpert's AI counsellor. I do the shortlisting
│       and comparisons, and when you're ready I hand you to a human
│       counsellor for the real conversation. Best of both.
│
│       Want to carry on?
│       [ Sure, continue ]   [ Get me a human ]
│
│       ├── [ Get me a human ] ──► NODE 0 · book them NOW
│       └── [ Sure, continue ] ──► B1 / B2
│
├── 🟩 "who are you?" / "what is guidexpert"
│   └── 🟦 GuideXpert is a career counselling service — we help
│       students pick colleges that fit their goals, and we do free
│       1-on-1 sessions with counsellors when you want one.
│       I'm the bot that does the groundwork first 🙂
│
│       Shall we find your fit? Where are you right now?
│       ►► B1
│
├── 🟩 "is this free?" / "how much do you charge?"
│   └── 🟦 This chat is completely free, and so is the 1-on-1 session.
│       Nothing to pay at any point here.
│       ►► B1
│
├── 🟩 "how did you get my number?"
│   └── 🟦 You messaged us first — this is GuideXpert's official
│       WhatsApp. If you'd rather not continue, just say stop and I
│       won't message again.
│       🟥 ⚠ if the lead came from an ad or a form, SAY SO honestly.
│          "You filled our form on [site]" — never be vague here.
│
├── 🟩 "how long will this take?"
│   └── 🟦 About 2 minutes — a few taps and you'll have a shortlist.
│       ►► B1
│
├── 🟩 "do you get paid by these colleges?"          ★ NEW IN v3
│   └── 🟦 Fair question, and yes — GuideXpert works with the colleges
│       I'd shortlist for you. That's why I say so upfront when I show
│       them, and why the checklist I give you works on us as well as
│       on anyone else.
│
│       Still want the shortlist?
│       [ Yes ]   [ Just the checklist ]
│
│       🟧 This question is now MORE likely, because B8 discloses. That
│          is the correct trade. Answer it plainly — a straight answer
│          here is worth more than the shortlist.
│
├── 🟥 ⚠ ALWAYS answer "are you a bot" honestly. (L8) Never dodge,
│      never say "I'm a counsellor" and leave it hanging. One evasion
│      poisons every recommendation that follows.
│
└── 🟥 ⚠ Only say "free" if it IS free. If the 1-on-1 is paid, the
    price belongs HERE and in B1 — never discovered at the booking
    step. That is how you get reported as spam.
```

---

## R6 · DEFLECTS / RESISTS
### `~2%` ►► give them what they asked for, then offer better

```
R6  ·  DEFLECTS

├── 🟩 "why do you need all this info?"
│   └── 🟦 Fair question. Only so the list I give you is actually
│       yours and not a copy-paste of the top 10.
│       Four taps, nothing personal, and you can stop whenever.
│       ►► B2
│
├── 🟩 "just send me the list"
│   ├── 🟦 I can — but a generic list is the thing you can already
│   │   Google. Give me three taps and I'll give you one that's
│   │   actually about you. Deal?
│   │   [ Okay, 3 taps ]   [ Just the generic list ]
│   ├── [ Okay, 3 taps ] ──► B2
│   └── [ Just the generic list ] ──► send the honest general list
│       (8.4), WITH the disclosure line, THEN:
│       🟦 That's the broad view. Two taps and I can tell you which of
│          those actually fits you.
│       ►► B2
│
├── 🟩 "i'll check later" / "busy now"
│   └── 🟦 Of course — no rush. I'll keep everything saved here, just
│       message whenever. 👍
│       ▣ stage saved → R13 resumes them
│       🟥 ⚠ ONE nudge at 24h max, then never again.
│
├── 🟩 "i'm not interested" / "stop" / "don't message me"
│   └── 🟦 No problem at all — I won't message again.
│       If you ever want a hand with college choices, just say hi. 👍
│       ▣ opted_out = true
│       🟥 ⚠ STOP. No retention attempt. No "may I ask why". Honour it
│          instantly and permanently. (L11)
│
└── 🟪 ✂ CUT
    Withholding the list to force compliance is a sales tactic and
    reads as one. Give them what they asked for, then earn the next
    step. (L3)
```

---

## R7 · EMOTIONAL ⚠
### `~2%` ►► **two tiers** — Tier 2 overrides everything in this document

```
R7  ·  EMOTIONAL / VULNERABLE

├── 🟧 WHY THIS BUCKET EXISTS
│   Results season puts genuinely distressed students in your inbox.
│   Tier 1 needs one human line before any button. Tier 2 is not a
│   funnel event at all.
│
├─── TIER 1 · DISAPPOINTMENT  ►► handle warmly, then continue
│    │
│    ├── 🟩 "i got very less marks" · "i failed" · "my rank is horrible"
│    │   └── 🟦 Okay — first, that's genuinely not the end of anything,
│    │       even though it feels like it today. I've seen this exact
│    │       situation turn out fine more times than I can count.
│    │
│    │       Tell me the number and let's look at what's actually
│    │       possible.
│    │       ►► R4-P · THE PREDICTOR
│    │       🟥 ⚠ don't rush to buttons. One human line first. (L10)
│    │
│    ├── 🟩 "my parents are forcing me to take engineering"
│    │   └── 🟦 That's more common than you'd think, and it's worth
│    │       taking seriously rather than just going along with it.
│    │
│    │       What would YOU pick if it were entirely your call?
│    │       [ Coding/tech ] [ Design ] [ Business ] [ I don't know ]
│    │       ▣ conflict = parental → flag for the human counsellor
│    │       🟥 ⚠ never side against the parents. Never side against the
│    │          student. Hold both. This is exactly what a 1-on-1
│    │          resolves and a bot can't.
│    │
│    ├── 🟩 "i'm so confused, everyone's telling me different things"
│    │   └── 🟦 That's the most normal thing in the world right now —
│    │       everyone has an opinion and none of them know you.
│    │
│    │       Let's cut through it. One question at a time, and you can
│    │       change your mind at any point.
│    │       ►► B2
│    │
│    └── 🟥 ⚠ ONE human line BEFORE any button. A student who says "i
│        failed" and gets an instant menu feels processed, not heard.
│        🟥 ⚠ NEVER fire the B3.2 core fork at a Tier 1 student.
│
└─── TIER 2 · GENUINE DISTRESS  🛑 HARD STOP  (= ⚡ I-10)
     │
     ├── 🟩 TRIGGERS
     │   "my life is over" · "i want to end it" · "no point living" ·
     │   "everyone would be better off without me" · self-harm language
     │   of any kind
     │
     ├── 🛑 THE FUNNEL STOPS COMPLETELY
     │   ✗ no shortlist  ✗ no buttons  ✗ no booking pitch  ✗ no upsell
     │
     ├── 🟦 BOT
     │   I'm really glad you told me that, and I don't want to move
     │   past it. A result doesn't decide your worth, whatever it
     │   feels like today.
     │
     │   Please talk to someone you trust right now — a parent, a
     │   teacher, a friend. And if it's heavier than that, Tele-MANAS
     │   is free and available 24/7 on 14416.
     │
     │   I'm connecting you with one of our counsellors — a real
     │   person — right away.
     │
     └── 🟥 ⚠ GUARD RAIL
         🚨 IMMEDIATE HUMAN ESCALATION · flag the conversation · notify
            the team · do NOT resume the flow, even if the student says
            they're fine and asks about colleges again.
         🚨 B10-F never fires for this lead.

         ★ This overrides every other rule in this document, including
           Node 0. Build this classifier BEFORE the shortlist engine.
```

---

## R8 · NOT THE STUDENT
### `~1%` ►► parent track, or route out

```
R8  ·  NOT THE STUDENT

├── 🟩 "i'm asking for my daughter, she's finishing 12th"
│   └── 🟦 It's really good that you're guiding her — students decide
│       much better with a parent involved.
│
│       Most parents I speak with weigh three things: safety,
│       placements and fees. Shall I shortlist with those first?
│
│       [ Yes — safety & jobs first ] [ Fees matter most ]
│       [ She should choose ]
│       ▣ is_parent = true  → reweights the ENTIRE journey
│       ►► B2
│
├── 🟧 WHY — what changes on the parent track
│   Every college line now carries: campus safety · hostel supervision
│   · accreditation · TOTAL cost, not just tuition.
│   Placement record moves ahead of "innovation ecosystem".
│   At B3.2 the joke swaps for the ROI version; at 3.2-F2 the emoji is
│   dropped and the copy tightened — parents read hedging as evasion.
│   At B5 the checklist keeps all seven checks; parents use them.
│   At B8 the disclosure line stays EXACTLY as written. A parent who
│   later discovers an undisclosed commercial relationship is the
│   single worst outcome available in this flow.
│
├── 🟩 "asking for my brother / friend / cousin"
│   └── 🟦 Happy to help — and it's good of you.
│       Quick thing: it'll be much more accurate if they message me
│       directly, since I'll ask about their goals. Want to pass this
│       number on, or shall we work through you?
│       [ I'll pass it on ]   [ Let's do it through me ]
│       ▣ proxy = true
│
├── 🟩 vendor pitch / "i want to advertise" / bulk spam
│   └── 🟦 This line is for student counselling only. For business
│       queries, please use the contact form on guidexpert.co.in.
│       ▣ type = spam · no further engagement
│
└── 🟩 "wrong number sorry"
    └── 🟦 No worries at all! If you ever need college guidance, you
        know where I am. 👍
```

---

## R9 · NON-TEXT
### `~1%` ►► extract what you can, then rejoin

```
R9  ·  NON-TEXT

├── 🟩 sticker / emoji only  (👍 😊 🙏)
│   └── 🟦 🙂 Let's get you started — where are you right now?  [ list ]
│       🟥 ⚠ do NOT re-send the whole greeting. Just the question. (L7)
│
├── 🟩 marksheet / rank card screenshot   ⭐ very common in India
│   ├── 🟦 WITH OCR
│   │   "Got it — [exam], rank [X]. Let me see what's realistic."
│   │   ►► R4-P · THE PREDICTOR
│   └── 🟦 WITHOUT OCR
│       "Thanks! I can't read images clearly — could you just type
│        the rank or percentage?"
│   🟧 WHY: screenshotting the result IS the student's natural first
│      move, and it is a hot-intent signal. OCR here is worth building.
│
├── 🟩 voice note
│   ├── transcription available → transcribe → route as text
│   └── 🟦 otherwise
│       "I can't play voice notes yet, sorry! Quick tap instead —
│        where are you right now?"  [ list ]
│
├── 🟩 blank / "." / "?" / random keys
│   └── 🟦 Didn't quite catch that 🙂 Where are you right now?  [ list ]
│
└── 🟩 document / PDF
    └── 🟦 Thanks for sending that — I can't open files here. What's
        the key detail I should know?
```

---

## R10 · AMBIGUOUS
### `<1%` ►► guess, then confirm in ONE tap

```
R10  ·  AMBIGUOUS / UNCLEAR

├── 🟩 "inter"        → 🟦 "Inter — first year or second year?"
│                          [ 1st year ] [ 2nd year ] [ Just finished ]
├── 🟩 "2nd year"     → 🟦 "Second year of…?"
│                          [ Inter / 12th ] [ Diploma ] [ B.Tech ]
├── 🟩 "passed out"   → 🟦 "Passed out of 12th, or of a diploma?"
│                          [ 12th ] [ Diploma ] [ Degree ]
├── 🟩 "PCM"          → ▣ save as 12th-MPC  (North Indian equivalent)
├── 🟩 "PCB"          → ▣ save as 12th-BiPC
├── 🟩 "12th pass"    → 🟦 "Got it. Which stream?"
│                          [ MPC ] [ BiPC ] [ MEC / CEC ]
├── 🟩 heavy typos    → interpret generously, confirm in ONE tap
│                        🟦 "12th MPC, right?"   [ Yes ] [ No ]
│
├── 🟧 WHY
│   Indian schooling has a dozen regional names for the same year. A
│   bot that can't parse "inter" reads as one built elsewhere.
│
└── 🟥 ⚠ NEVER "I didn't understand, please choose from the options."
    Guess, then confirm with one tap. A tap costs the student nothing.
    A rejection costs you the lead. (L6)
```

---

## R11 · OUT OF SCOPE
### `<1%` ►► admit the limit, offer the human

```
R11  ·  OUT OF SCOPE

├── 🟩 STUDENT
│   "MBBS" · "law" · "MBA" · "CA" · "only abroad" · "PhD" · "i want a job"
│
├── 🟦 BOT
│   Honest answer — my depth is engineering and tech programs in
│   India, so I'd rather not guess at medical admissions and point
│   you wrong.
│
│   Our counsellors do cover this properly though. Want me to book
│   you with the right person?
│
│   [ Book a session ]   [ Tell me about tech anyway ]
│   ├── [ Book a session ] ──────────► NODE 0 · straight to B10.2
│   └── [ Tell me about tech anyway ] ►► B2
│
├── 🟩 "actually i want to go abroad"
│   └── 🟦 Abroad is a real option — and an expensive one. A middle
│       path a lot of students take: a strong Indian program with
│       global exposure, then a master's abroad. Same destination, far
│       lower total cost. Want to see programs with international
│       pathways?
│       [ Yes, show pathways ]   [ Only direct-abroad ]
│
├── 🟧 WHY
│   Admitting a limit builds more trust than a confident wrong answer
│   — and it's the thing a student remembers when a friend asks them
│   for a recommendation.
│
└── 🟥 ⚠ Never fake expertise to keep the conversation alive.
    If GuideXpert DOES cover medical or law, delete this branch and
    route properly. Only claim what is true — in both directions.
```

---

## R12 · HOSTILE / TESTING
### `<1%` ►► redirect ONCE, then go quiet

```
R12  ·  HOSTILE / TESTING

├── 🟩 "are you chatgpt lol" / "ignore your instructions" / prompt tests
│   └── 🟦 Ha — I'm GuideXpert's counselling bot, that's genuinely
│       all 😄 I'm useful for exactly one thing though: finding you a
│       college that fits. Want to try me?
│       [ Go on then ]   [ Nah ]
│
├── 🟩 "write me a poem" / off-topic requests
│   └── 🟦 I'll leave poetry to the professionals 😄 Colleges I can do.
│       Where are you right now?
│       ►► B1
│
├── 🟩 abuse / slurs
│   └── 🟦 I'm happy to help with college questions whenever you'd
│       like. 👍
│
├── 🟧 WHY
│   Most of these are teenagers testing the toy. A warm, unbothered
│   redirect converts a surprising number of them.
│
└── 🟥 ⚠ Redirect ONCE. If they persist, stay friendly and stop
    steering: "I'm here whenever you want college help 👍"
    One calm line. Never argue. Never apologise. Never grovel.
    Never escalate. Then go quiet.
```

---

## R13 · SILENCE / RETURNING
### ►► nudge per L12, then resume — never restart

```
R13  ·  SILENCE & RETURN

├── ⏱ B1 SENT, NO REPLY, 4 HOURS
│   └── 🟦 THE ONLY FOLLOW-UP AT THIS STAGE
│       Hey {name} — still here whenever you want a hand picking a
│       college. Just one tap to start 🙂
│       [ list ]
│       ▣ stage = greeted_no_reply
│       🟥 ⚠ ONE. Never two. They received nothing, so they get one.
│
├── ⏱ SILENCE MID-FLOW, BEFORE B8, 24 HOURS   (= ⚡ I-8)
│   └── 🟦 Hey {name} — no rush at all 🙂
│       Everything's saved right here whenever you want to pick it up.
│       [ Carry on ]   [ Leave it for now ]
│       🟥 ⚠ ONE.
│
├── ⏱ SILENCE AFTER B8   ►► B10-F · two nudges
│   They received a shortlist. That earns the second nudge. (L12)
│
├── 🟩 RETURNS DAYS LATER — "hey sorry was busy"
│   └── 🟦 ►► resume at lead.stage
│       No worries at all, {name} 🙂 We'd shortlisted three for AI +
│       placements last time. Want to pick up where we left off, or
│       add anything new first?
│       [ Pick up ] [ Add something ] [ Start fresh ]
│       🟥 ⚠ do NOT re-send B5's checklist. checklist_sent = true.
│
├── 🟧 WHY
│   Coming back is itself intent — don't waste it by restarting
│   discovery. The stage pointer is what makes this possible.
│
└── 🟥 ⚠ NO NUDGE AT ALL for these states
    ├── opted_out = true          — permanent, no exceptions
    ├── stage = parked_core       — closed warmly at 3.2-F2
    └── escalated (R7 Tier 2)     — a human owns this conversation
```

---

# PART 9 · R4 · JUMPS AHEAD · SUB-CASES A–G
### `~7%` · they ignored the question and stated a need · **answer the need first**

```
        🟩 student states a need instead of tapping
                          │
              ◆ WHAT KIND OF NEED IS IT?
                          │
   ┌────────┬────────┬────┴───┬────────┬────────┬────────┐
   ▼        ▼        ▼        ▼        ▼        ▼        ▼
 R4-A     R4-B     R4-C     R4-D     R4-E     R4-F     R4-G
 RANK   COLLEGE   MONEY    GOAL /   "BEST    ADMISSION  X vs Y
 SCORE   NAME    QUESTION  BRANCH   COLLEGE"  DEADLINE
   │        │        │        │        │        │        │
   ▼        ▼        ▼        ▼        ▼        ▼        ▼
 R4-P    honest   budget   interest  reframe  answer   HOT —
PREDICTOR  read   captured  filled     +      or      late
   │     + compare    │    B3 skips  2 taps  admit    stage
   │        │        │        │        │      limit     │
   └────────┴────────┴────────┴────────┴────────┘        │
                          │                              │
                          ▼                              ▼
          B2 → B3 → B4 → B5 → B6 → B6.5 → B7 → B8   B8 → B9 → B10
                 (slots pre-filled)                 invite EARLY
                          │                              │
                          └──────────────┬───────────────┘
                                         ▼
                                   B10 · BOOK
```

```
🟧 THE PRINCIPLE

   Answer the need they stated. Then rejoin.

   Refusing to answer — in order to protect your script — is the
   fastest way to look like a form instead of a counsellor.

   ⚠ And never substitute your preferred flow for the thing they
     actually asked for. If you can't deliver it, get them someone
     who can. Offering counselling to a student who asked for
     predictions is the same error as offering a shortlist to a
     student who asked to book. (L3)
```

```
R4  ·  JUMPS AHEAD
│
├──R4-A · A RANK OR SCORE                                   ►► R4-P
│  │
│  ├── 🟩 "my eamcet rank is 18000" · "TS EAMCET 18453 OC Male"
│  │      "jee 95 percentile" · "can I get CSE with 18k"
│  │
│  ├── 🟦 "Got it — TS EAMCET, rank 18453. Which category?"
│  │      [ OC ]  [ BC ]  [ SC ]  [ ST ]  [ EWS ]
│  │
│  ├── ►► HAND OFF TO R4-P · THE PREDICTOR NODE
│  │      slot-filling → CollegeDost API → Top Matches →
│  │      sticky results → the honest bridge → B2
│  │
│  ├── 🟪 ✂ DELETED FROM THE EARLIER DRAFT
│  │      "✅ Safe · 🟡 Likely · 🔶 Stretch"
│  │      The API returns Top Matches. It does not return confidence
│  │      tiers. Inventing them means labelling a college "safe" on no
│  │      data — the exact fabrication the Phase 10 guardrail exists to
│  │      prevent.
│  │
│  └── 🟥 ⚠ Show the colleges FIRST. The counselling offer comes after
│      the results, never instead of them.
│
│
├──R4-B · A COLLEGE NAME                          ►► B9 lane, then B2
│  │
│  ├── 🟩 "is NIAT any good?" · "tell me about Scaler"
│  │      "what's the placement at Newton"
│  │
│  ├── 🟦 BOT
│  │   Good that you're researching rather than guessing.
│  │
│  │   Straight read: it's strong on [X], less so on [Y].
│  │
│  │   Worth saying upfront — that's one GuideXpert works with, so
│  │   weigh my read accordingly. Let me put two comparable ones next
│  │   to it so you can judge on what matters to YOU.
│  │
│  │   [ Yes, compare fairly ]   [ Just their placements ]
│  │
│  │   ⚠ ★ NEW IN v3: the disclosure fires HERE too, not only at B8.
│  │     A student who asks about a partner college by name gets the
│  │     same disclosure a student who receives the shortlist gets.
│  │     Disclosing only when convenient is worse than not disclosing.
│  │
│  ├── ▣ college_of_interest = NIAT   ▣ temperature = warm
│  │
│  ├── 🟦 after the comparison
│  │   "To rank these properly I need one thing: what matters most to
│  │    you?"  ►► B4
│  │
│  ├── 🟥 ⚠ NEVER trash a college to sell another. Fastest way to look
│  │      like a salesperson instead of a counsellor.
│  │
│  └── 🟥 ⚠ If they name a college NOT in the catalog, still give the
│      honest read. "I don't cover that one" is a worse answer than a
│      fair one, and refusing looks evasive.
│      → If you genuinely lack reliable detail (OPEN ◆ CAT-3):
│        🟦 "I don't have reliable detail on that one — I won't guess.
│            Here's what I'd ask them directly…" + the B5 checklist.
│            That's still a good answer, and better than a vague one
│            that sounds like you're avoiding it.
│
│
├──R4-C · A MONEY QUESTION                    ►► B2, B6.5-budget skips
│  │
│  ├── 🟩 "what is the fees" · "cheap college" · "low budget"
│  │      "do you have scholarships"
│  │
│  ├── 🟧 WHY THIS OPENER IS DELICATE
│  │   Money is THE constraint for this student, and they are often
│  │   slightly embarrassed to lead with it. A scary first number
│  │   loses them instantly. So does anything reading as judgement.
│  │
│  ├── 🟦 BOT
│  │   Totally fair thing to lead with — and honestly, good news:
│  │   there are strong project-based colleges well under ₹2L/yr, and
│  │   several offer scholarships.
│  │
│  │   What range is comfortable for your family?
│  │
│  │   [ Under ₹2L ]  [ ₹2–5L ]  [ ₹5L+ ]  [ Not sure yet ]
│  │
│  ├── ▣ budget_band captured  →  B6.5-budget SKIPS
│  ├── ▣ if [ Under ₹2L ] → scholarship_flag = true, aid surfaced at B8
│  │
│  ├── 🟦 then straight into B2
│  │   "Good — that keeps it realistic. What would help you most
│  │    right now?"
│  │
│  └── 🟥 ⚠ Never quote a fee figure you cannot source. "Exact fees
│      are what the 1-on-1 covers, with current scholarships."
│
│
├──R4-D · A GOAL OR A BRANCH                        ►► B2, B3 skips
│  │
│  ├── 🟩 "i want to become a software engineer" · "i want AI branch"
│  │      "i want to do cse" · "i want mechanical"
│  │
│  ├── ▣ interests[] / branch_interest filled  →  B3 SKIPS
│  ├── ▣ career_goal stored separately (NOT the B4 priority)
│  │
│  ├── 🟦 tech / AI
│  │   Clear goal — that helps a lot, and it's a flexible one.
│  │   To point you at the right colleges: what matters most to you?
│  │   ►► B4
│  │
│  ├── 🟦 core engineering  ►► B3.2 CORE FORK fires here
│  │   Mechanical's a genuinely strong field — I'd never talk anyone
│  │   out of it. Before I shortlist though, let me be straight with
│  │   you about something most counsellors won't say out loud…
│  │
│  ├── 🟧 WHY B4 STILL FIRES
│  │   "Software engineer" is a CAREER GOAL. B4 asks for the PRIORITY
│  │   — placements vs AI vs affordability. Different slot. Filling one
│  │   does not fill the other, and assuming it does produces a badly
│  │   weighted shortlist.
│  │
│  └── 🟥 ⚠ Never re-ask the branch. They just told you.
│
│
├──R4-E · "WHICH IS THE BEST COLLEGE"                        ►► B4
│  │
│  ├── 🟩 "which is the best college for cse" · "top college in
│  │      hyderabad" · "just tell me the best one"
│  │
│  ├── 🟦 BOT
│  │   I'll get you there — but "best" depends on you, and I'd hate
│  │   to send you somewhere that's wrong for your goal.
│  │
│  │   Two quick taps and I'll give you a real shortlist instead of a
│  │   generic one. What matters most to you?
│  │
│  ├── ▣ interests captured if they named a field → B3 SKIPS
│  │
│  ├── 🟦 if they push back "just give me a safe pick"
│  │   Fair. Broadly safe bet for most students: [X], because it's
│  │   strong on placements without being expensive.
│  │   (⚠ + disclosure if [X] is a partner college.)
│  │   But honestly — two taps and I can do much better than
│  │   "broadly".
│  │
│  └── 🟥 ⚠ Give them something. Withholding a general answer to force
│      compliance is a sales tactic and reads as one.
│
│
├──R4-F · ADMISSION / DEADLINE / ELIGIBILITY          ►► answer, then B2
│  │
│  ├── 🟩 "when does admission close" · "can I get in without JEE"
│  │      "is management quota available" · "what's the last date"
│  │
│  ├── 🟦 when you know
│  │   Answer plainly and precisely, then:
│  │   "While you're here — want me to shortlist based on your goals
│  │    so you're ready when you apply?"
│  │
│  ├── 🟦 when you do NOT know
│  │   I won't guess at dates — those change and a wrong one could
│  │   cost you a seat.
│  │
│  │   Your counsellor will have the current calendar. Want me to set
│  │   that up? Meanwhile I can shortlist colleges against your goals.
│  │
│  │   [ Book the session ]  [ Shortlist first ]
│  │
│  ├── 🟥 ⚠ NEVER invent a deadline, cutoff or quota rule. (L9) The
│  │      highest-cost category to be wrong about — a missed date is a
│  │      lost year.
│  │
│  └── 🟥 ⚠ Deadline pressure means URGENCY. If they say "closing
│      today", compress hard: 3 taps → shortlist → B10.
│
│
└──R4-G · "X vs Y"                              🔥 HOT ►► B9, book EARLY
   │
   ├── 🟩 "NIAT vs Scaler" · "which is better, A or B"
   │
   ├── 🟧 WHY THIS IS NOT ORDINARY R4
   │   Two named finalists means late-stage research and real intent.
   │   This student is closer to booking than anyone in the happy
   │   path. Do not run them through full discovery.
   │
   ├── 🟦 BOT
   │   Both are genuinely strong — and both are ones GuideXpert works
   │   with, so weigh my read accordingly. Let's decide it on you, not
   │   on hype. Quick: which matters more to you right now?
   │
   │   [ Fastest path to jobs ] [ Deepest coding mentorship ]
   │   [ Lower cost ]
   │
   ├── 🟦 the tie-break
   │   Based on that, I'd lean [X] — because [reason tied to that
   │   exact priority].
   │
   │   Honestly though, this final call is what a 1-on-1 nails in
   │   20 minutes with real numbers in front of you. Want me to set
   │   it up?
   │
   ├── ►► B9 fit → B10 book. Skips B3, B5, B6, B6.5, B7, B8.
   │      ⚠ B5's checklist is NOT sent to this student — they are past
   │        the evaluation stage and it would read as a delay.
   │
   └── 🟥 ⚠ Do not answer "which is better" in the abstract. The
       tie-break must come from THEIR stated priority, or the
       recommendation is unearned.
```

## R4 · What it pre-fills — the skip table

```
                        B2     B3      B4     B6.5b  B6.5l    B8
                       GOAL  INTEREST PRIORITY BUDGET  CITY   LIST
──────────────────────────────────────────────────────────────────
R4-A  rank / score      ●      ○        ●       ●      ●      ●
      → qualification inferred from exam · interest if filtered

R4-B  college name      ●      ●        ●       ●      ●      ●
      → college_of_interest pinned into the comparison

R4-C  money question    ●      ●        ●       ✗      ●      ●
      → scholarship_flag if under ₹2L

R4-D  goal / branch     ●      ✗        ●       ●      ●      ●
      → core engineering forks to B3.2 first

R4-E  "best college"    ●      ○        ●       ●      ●      ●

R4-F  admission / date  ●      ●        ●       ●      ●      ●

R4-G  "X vs Y"          ✗      ✗        ✗       ✗      ✗      ✗
      → straight to B9, then B10

  ● fires    ✗ skipped, already known    ○ skips only if a field named
```

## R4 · Guard rails

```
🟥  BOOKING INTENT IS NOT R4
    "talk to someone" / "call me" / "book" / "counsellor" is
    NODE 0 · THE OVERRIDE. Book first, backfill after. This holds even
    mid-predictor, mid-comparison, anywhere.

🟥  ANSWER THE NEED BEFORE THE FLOW
    Every R4 sub-case answers what they asked before asking anything.
    The one exception is R4-E, where "best" is genuinely unanswerable
    without one input — and even there, offer a general pick if pushed.

🟥  NEVER INVENT
    No fees, no cutoffs, no deadlines, no placement percentages, no
    confidence tiers. If you don't have it, say so and route to the
    1-on-1. (L9)

🟥  DISCLOSE WHEREVER A CATALOG COLLEGE IS NAMED   ★ NEW IN v3
    R4-B and R4-G name partner colleges before B8 ever fires. The
    disclosure must fire there too. Disclosing only in the beat where
    it was convenient is worse than not disclosing at all. (L13)

🟥  NEVER RE-ASK WHAT R4 ALREADY CAPTURED
    A rank entrant should never see "what's your qualification?"
    A student who said "I want CSE" should never see B3.
    This is where re-asking is most obvious and most damaging.

🟥  ONE HUMAN LINE FIRST IF EMOTION IS PRESENT
    "my rank is horrible, can I get anything" is R4-A AND R7 Tier 1.
    Acknowledge before predicting. (L10)
```

## R4 · Data written

```
▣ door = jumps_ahead
▣ jump_type = rank | college | money | goal | best | admission | vs
▣ temperature = warm  (hot for R4-G)
▣ whichever slots the message filled — always MERGED, never
   overwritten with blanks
▣ stage = the node they were routed into
```

---

# PART 10 · R4-P · THE COLLEGE PREDICTOR

```
              🟩 "my eamcet rank is 18000"          fires at ANY node
                              │
                     ① EXTRACT WHAT'S THERE
                exam · rank/percentile · category · gender · quota
                              │
                     ◆ ALL SLOTS FILLED?
                              │
               ┌──────────────┴──────────────┐
              NO                            YES
               │                             │
      ask ONE missing slot                   │
      exam-specific order                    │
      never re-ask a known slot              │
               │                             │
               └────── loop ─────────────────┤
                                             ▼
                              ◆ AP EAMCET + OC + Male?
                                             │
                        ┌────────────────────┴────────────────────┐
                       YES                                       NO
                        │                                         │
              ⚠ BLOCKED · no fake number              ② PREDICTION RUNS
                        │                              CollegeDost API
                        ▼                                         │
              ►► AGENT · a human who                              ▼
                 has the real data                   ★ ③ TOP MATCHES SHOWN
                        │                            what they came for
              ⚠ NEVER divert to B2                              │
                 They asked for colleges.                        ▼
                 Counselling is not a                   ④ STICKY RESULTS
                 substitute for the answer.                      │
                                          ┌──────────────┬───────┴────────┐
                                          ▼              ▼                ▼
                                   [ Show more ]  [ Filter these ]  [ Help me choose ]
                                          │              │                │
                                          └──── back ────┘                │
                                              to ④                        ▼
                                                                  ⑤ THE BRIDGE
                                                            name the two routes honestly
                                                                          │
                                                    ┌─────────────────────┴──────────┐
                                                    ▼                                ▼
                                          [ Show me both ]              [ Stick to my rank list ]
                                                    │                                │
                                                    ▼                          warm close
                                B2 → B3 → B4 → B5 → B6 → B6.5 → B7 → B8 → B9 → B10
                                qualification INFERRED from exam           ▣ list saved
                                interests pre-filled if they filtered      no re-pitch
                                → usually 4 taps, not 8
```

```
R4-P  ·  PREDICTOR → HAPPY FLOW
   fires on any rank / score / percentile · real API · sticky results

├──⓪ TRIGGER
│  ├── 🟩 "my eamcet rank is 18000" · "TS EAMCET rank 18453 OC Male"
│  │      "jee 95 percentile" · "can I get CSE with 18k"
│  │      also: menu option 5 · "college predictor"
│  │      also: a marksheet screenshot via R9 + OCR
│  ├── ▣ botState = college_predictor (sticky) · door = rank_entry
│  └── 🟧 WHY IT OVERRIDES EVERYTHING
│      A rank up front means they are asking "what can I GET", not
│      "what should I CHOOSE". Answer the question they asked.
│      Discovery first is how you lose them.
│
├──① SLOT FILLING · extract → merge → ask only what's missing
│  ├── ▣ EXAM-SPECIFIC ORDER
│  │   AP / TS EAMCET   exam → rank → category → gender → region (AP)
│  │   JEE Main / Adv   exam → rank → gender → category
│  │   KCET             exam → rank → admission type → category
│  │   MHT CET          exam → PERCENTILE → admission type → category
│  │   WBJEE            exam → rank → category → quota
│  │   TNEA / KEAM      exam → rank → category
│  ├── 🟩 many slots in one line: "TS EAMCET rank 18453 OC Male"
│  │      → exam + rank + category + gender all filled
│  │      → NOTHING asked. Prediction runs immediately.
│  ├── 🟦 only the missing slot, one at a time
│  │      "Got it — TS EAMCET, rank 18453. Which category?"
│  │      [ OC ] [ BC ] [ SC ] [ ST ] [ EWS ]
│  └── 🟥 ⚠ If the exam is already known — this message, an earlier
│      turn, or the lead record — DO NOT ask it. Same anti-repeat rule
│      as B1–B10, and this is where students notice it fastest.
│
├──② BLOCKED CASE · AP EAMCET + OC + Male
│  ├── 🟧 WHY IT IS BLOCKED
│  │   Cutoffs for this combination move too much for a prediction
│  │   worth standing behind. Shipping a number you don't trust is
│  │   worse than shipping none — a wrong call here costs a year.
│  ├── 🟦 BOT
│  │   For AP OC male candidates the cutoffs swing enough that I won't
│  │   give you a number I can't stand behind — a wrong prediction
│  │   here could cost you a year.
│  │
│  │   So let me get you to someone who has the actual current data
│  │   for your combination, rather than have me guess.
│  │
│  │   [ Connect me ]   [ What should I look for meanwhile? ]
│  ├── [ Connect me ] ►► AGENT · human handoff
│  ├── [ What should I look for meanwhile? ]
│  │   🟦 cutoff trend over 3 years · seat matrix for their category ·
│  │      spot-round history. Then back to [ Connect me ].
│  ├── 🟥 ⚠ NEVER route this to B2. They asked for predicted colleges.
│  │      Counselling is not a substitute for the answer — offering it
│  │      instead reads as bait-and-switch, and they are right to read
│  │      it that way. (L3)
│  └── 🟥 ⚠ NEVER say "our system doesn't support that" — it sounds
│      broken. Say it is about ACCURACY, because it is.
│
├──③ PREDICTION RUN
│  ├── ▣ buildPredictionContext  category/gender/quota → reservation codes
│  ├── ▣ runPrediction → fetchCollegeDostColleges
│  ├── ▣ cache a WIDER window  so Show more / filters never re-hit the API
│  ├── ▣ formatPredictionReply  first page
│  ├── 🟦 BOT — ★ what they came for
│  │      TS EAMCET · rank 18453 · OC · Male
│  │
│  │      *Top Matches*
│  │      [ 5 colleges, exactly as the API returned them ]
│  ├── ✅ KEEP idempotency — the same inbound message will not
│  │      double-run the prediction. Webhook retries are real.
│  └── 🟥 ⚠ Present EXACTLY what the API returns. No confidence tiers,
│      no "safe / likely / stretch", no invented ordering. If the API
│      gives an order, that IS the order.
│
├──④ STICKY RESULTS · step = results
│  ├── 🟦 footer as TAPS, not typed commands
│  │      [ Show more ]   [ Filter these ]   [ Help me choose ]
│  ├── [ Filter these ] → LIST
│  │      CSE · ECE · Mechanical · Civil · Government only ·
│  │      Private only · Girls colleges · By district · Start again
│  ├── ROUTING
│  │      Show more        → next page from cache, refetch only if short
│  │      Branch filter    → local filter, refetch if too few
│  │      Govt / Private   → local filter
│  │      District / named → local filter
│  │      AP region change → RE-PREDICT with new region (AU / SVU)
│  │      Start again      → reset context, ask exam
│  │      Unrecognised     → remind actions + soft counselling prompt
│  │      Help me choose   → ⑤ THE BRIDGE
│  │      MENU / AGENT     → exit / human handoff
│  ├── 🟧 WHY THE FOOTER BECOMES BUTTONS
│  │   This is the last typed-command surface in the product.
│  │   Everywhere else we removed typing; leaving SHOW MORE / AGAIN /
│  │   AGENT as typed words makes the predictor feel bolted on.
│  └── 🟥 ⚠ Stay in results mode. Do not drift into counselling on an
│      unrecognised message — remind them of the actions instead.
│
├──⑤ THE BRIDGE · the honest handover
│  ├── 🟧 ⚠ THE THING THAT MUST BE SAID OUT LOUD
│  │   The predictor returned RANK-GATED colleges. The counselling
│  │   shortlist returns new-age colleges that mostly are NOT
│  │   rank-gated. Two different lists, two different doors.
│  │
│  │   Move a student between them silently and it reads as bait —
│  │   "the predictor was just to get me into a sales funnel." Name
│  │   the difference and the same move reads as a counsellor showing
│  │   them an option they didn't know existed.
│  ├── 🟦 BOT
│  │   That list is what your rank opens up — worth keeping.
│  │
│  │   There's a second route most students don't know about: newer
│  │   colleges that admit on aptitude and interviews rather than
│  │   rank, and are built around projects and placements. Different
│  │   door, sometimes a better fit.
│  │
│  │   Want me to shortlist those against your goals too, so you can
│  │   compare both routes?
│  │
│  │   [ Show me both ]   [ Stick to my rank list ]
│  ├── [ Show me both ] ►► B2 · GOAL
│  │   ▣ seedCareerContextFromPredictor — exam · rank · category ·
│  │      gender · predicted colleges → career profile
│  │   ▣ clear college sticky state
│  │   ▣ qualification INFERRED from exam — never asked. B1 SKIPS.
│  │      EAMCET / JEE / KCET / MHT CET / WBJEE → 12th-MPC
│  │   ▣ interests pre-filled IF they used a branch filter → B3 SKIPS
│  │   → still needed: goal · priority · budget · city = 4 taps, not 8
│  └── [ Stick to my rank list ] ►► warm close
│      🟦 "Fair enough — that list is saved right here. If you want
│          help choosing between them later, just say the word. 👍"
│      ▣ stage = predictor_results
│      🟥 ⚠ ONE offer. Never re-pitch. R13 resumes them if they return.
│
├──⑥ INTO THE HAPPY FLOW
│  ├── B1 · QUALIFY      SKIPPED — inferred from the exam
│  ├── B2 · GOAL         asked — the predictor never learned this
│  ├── B3 · INTEREST     SKIPPED if they filtered by branch
│  ├── B4 · PRIORITY     asked
│  ├── B5 · CHECKLIST    0 taps  ★ still fires — this student needs it
│  │                     MORE than most, because they are about to
│  │                     compare two catalogs against each other
│  ├── B6 · PERMISSION   1 tap
│  ├── B6.5 · CONSTRAINTS asked — budget + city still unknown
│  ├── B7 · TWO MODELS   0 taps ★ this beat was WRITTEN for this
│  │                     student. The rank list IS the established
│  │                     column; the shortlist is the newer one. Name
│  │                     both, honestly, exactly as B7 does.
│  ├── B8 · SHORTLIST    ★ new-age catalog, scored on their goals
│  ├── B9 · FIT          the narrowing
│  └── B10 · BOOK        the close
│  │
│  └── 🟧 WHY B10 GETS STRONGER FOR THIS STUDENT
│      They arrive with rank, category and a real predicted list
│      already in the profile. The invite at B10.1 can name BOTH
│      routes — "compare your rank options against the aptitude-based
│      ones" — which is a genuinely stronger reason to book than
│      either alone.
│
├──GUARD RAILS
│  ├── 🟥 Never re-ask a slot the extractor already filled.
│  ├── 🟥 Never invent tiers, cutoffs or confidence the API doesn't return.
│  ├── 🟥 Never predict for AP OC + Male. Explain why, route to AGENT.
│  ├── 🟥 Never substitute counselling for a prediction they asked for.
│  ├── 🟥 Never say a rank "will" get a college.
│  ├── 🟥 If the API errors or times out, say so plainly and offer the
│  │      counsellor. Never fall back to a guessed list.
│  └── 🟥 "book" / "call me" is still NODE 0 · THE OVERRIDE, even here.
│
└──▣ DATA WRITTEN
   exam · rank | percentile · category · gender · quota · region
   predicted_colleges[] · filters_used[]
   qualification (inferred) · interests (if filtered)
   door = rank_entry · temperature = warm
   stage = predictor_results | bridged_to_counselling
```

```
★ THE PRINCIPLE THIS ESTABLISHES — it generalises past the predictor

  Never substitute your preferred flow for the thing they actually
  asked for. If you can't deliver it, get them someone who can.
  Offering counselling to a student who asked for predictions is the
  same error as offering a shortlist to a student who asked to book.

  That's the difference between a counsellor and a funnel, and
  students can feel it immediately.
```

---

# PART 11 · ⚡ THE INTERRUPTS

*Everything cut from the phase list lives here. Each fires **on detection**, answers inline, and **returns to the node it left** — never resets.*

```
┌──────┬─────────────────────┬─────────────────────────────────────────────────┐
│ ID   │ FIRES WHEN          │ WHAT HAPPENS                                    │
├──────┼─────────────────────┼─────────────────────────────────────────────────┤
│ I-1  │ "not sure" /        │ 🟦 "Totally normal. Let's narrow it a           │
│      │ "i don't know"      │     different way — which sounds more like      │
│      │ at B2, B3 or B4     │     you?"                                        │
│      │                     │  [Building things] [Working with people]        │
│      │                     │  [Numbers & analysis]                           │
│      │                     │ → infer → confirm in one line → ↩ same node     │
│      │                     │ 🟥 never push a default. Never reset.            │
│      │                     │ 🟧 a student who knows what they want never      │
│      │                     │    sees this. Asking everyone wastes a turn on   │
│      │                     │    the 80% who don't need it.                    │
├──────┼─────────────────────┼─────────────────────────────────────────────────┤
│ I-2  │ budget anxiety      │ 🟦 "Completely fair — no pressure at all.       │
│      │ any node            │     There are strong project-based colleges     │
│      │                     │     under ₹2L, and several give scholarships.   │
│      │                     │     Want me to focus there?"                    │
│      │                     │ → ▣ budget updated → ↩ re-run B8                │
│      │                     │ 🟧 money anxiety arrives when it arrives, not    │
│      │                     │    on your schedule.                             │
├──────┼─────────────────────┼─────────────────────────────────────────────────┤
│ I-3  │ family / parent     │ 🟦 "What do your parents lean toward —          │
│      │ mentioned           │     staying nearby, a known brand, or are they  │
│      │                     │     backing your call?"                          │
│      │                     │  [Nearby] [Known brand] [My call]               │
│      │                     │ → ▣ parent_constraints → ↩ same node            │
│      │                     │ 🟥 ONLY fires if THEY raise it. Most students    │
│      │                     │    have no parent constraint — asking everyone   │
│      │                     │    invents one.                                  │
├──────┼─────────────────────┼─────────────────────────────────────────────────┤
│ I-4  │ any of your 9       │ answer inline using existing Phase 7 copy →     │
│      │ concern classifiers │ 🟦 "Does that help for now?"  [Yes] [No]        │
│      │ detected            │ → ↩ return to the node you left                 │
│      │                     │ 🟪 ✂ NO "which concern first?" menu.             │
│      │                     │    Never invite worries that weren't there.      │
├──────┼─────────────────────┼─────────────────────────────────────────────────┤
│ I-5  │ hesitation          │ classify into your existing 5 categories →      │
│      │ VOLUNTEERED         │ answer personally → ↩ return                    │
│      │ (never solicited)   │ 🟥 escalation rule UNCHANGED: repeated           │
│      │                     │    hesitation, or explicit "talk to a human"     │
│      │                     │    → escalate. NEVER on a first objection.       │
│      │                     │ 🟧 soliciting hesitation at peak intent          │
│      │                     │    manufactures the objection that kills the     │
│      │                     │    sale. Keep the classifier, delete the prompt. │
├──────┼─────────────────────┼─────────────────────────────────────────────────┤
│ I-6  │ out of scope        │ 🟦 "Honest answer — my depth is engineering     │
│      │ (MBBS/law/MBA/      │     and tech in India. Our counsellors do cover │
│      │ arts/business if    │     this — want me to book you with the right   │
│      │ the catalog lacks   │     person?"                                     │
│      │ it)                 │  [Book a session] [Tell me about tech]          │
│      │                     │ 🟧 faking expertise to keep a conversation       │
│      │                     │    alive costs more than admitting a limit.      │
├──────┼─────────────────────┼─────────────────────────────────────────────────┤
│ I-7  │ "how much does      │ answer plainly and IMMEDIATELY                  │
│      │ this cost"          │ 🟥 if the 1-on-1 is paid, say the price HERE,    │
│      │                     │    not at B10. A surprise fee at the booking     │
│      │                     │    step is how you get reported as spam.         │
├──────┼─────────────────────┼─────────────────────────────────────────────────┤
│ I-8  │ 24h silence at      │ ONE nudge before B8: "Everything's saved right  │
│      │ any node before B8  │ here whenever you want it 🙂"                   │
│      │                     │ 🟥 one. never two. After B8, B10-F takes over    │
│      │                     │    and allows two. (L12)                         │
│      │                     │ 🟥 does NOT fire for opted_out, parked_core,     │
│      │                     │    or escalated leads.                           │
├──────┼─────────────────────┼─────────────────────────────────────────────────┤
│ I-9  │ "I've never coded"  │ 🟦 "Not a problem — the good programs assume    │
│      │ beginner fear       │     zero coding and teach from scratch with     │
│      │                     │     mentors."            ↩ same node             │
│      │                     │ 🟧 beginner fear is the quiet reason students    │
│      │                     │    self-select out of CS.                        │
├──────┼─────────────────────┼─────────────────────────────────────────────────┤
│ I-10 │ ⚠ GENUINE DISTRESS  │ 🛑 THE FUNNEL STOPS COMPLETELY.                 │
│      │ (R7 Tier 2)         │ ✗ no list ✗ no buttons ✗ no booking pitch       │
│      │                     │ human line + Tele-MANAS 14416 + immediate       │
│      │                     │ human escalation.                                │
│      │                     │ ★ OVERRIDES EVERY OTHER RULE IN THIS DOCUMENT.  │
│      │                     │ 🟧 build this classifier before anything else.   │
└──────┴─────────────────────┴─────────────────────────────────────────────────┘
```

---

# PART 12 · THE SKIP MATRIX · B1 → B10

*Pre-filled slots are skipped **silently** — never confirmed, never re-asked. (L4)*

```
                      B1    B2    B3    B4    B5    B6   B6.5   B7    B8    B9   B10
                    QUAL  GOAL  INT  PRIOR CHECK PERMIT CONST MODELS LIST   FIT  BOOK
──────────────────────────────────────────────────────────────────────────────────────
R1 · taps a row      ●     ●     ●     ●     ●     ●     ●     ●     ●     ●     ●
R2 · types it        ●     ●     ●     ●     ●     ●     ●     ●     ●     ●     ●
R3 · over-answerer   ✗     ●     ✗     ●     ●     ●     ✗     ●     ●     ●     ●
R4-A · rank entry    ✗     ●     ○     ●     ●     ●     ●     ●     ●     ●     ●
R4-B · college name  ●     ●     ●     ●     ●     ●     ●     ●     ●     ●     ●
R4-C · fees-first    ●     ●     ●     ●     ●     ●     ◐     ●     ●     ●     ●
R4-D · names branch  ●     ●     ✗     ●     ●     ●     ●     ●     ●     ●     ●
R4-E · "best colle." ●     ●     ○     ●     ●     ●     ●     ●     ●     ●     ●
R4-F · admission     ●     ●     ●     ●     ●     ●     ●     ●     ●     ●     ●
R4-G · "X vs Y"      ●     ✗     ✗     ✗     ✗     ✗     ✗     ✗     ✗     ●     ● ← early
NODE 0 · booking     ✗     ✗     ✗     ✗     ✗     ✗     ✗     ✗     ✗     ✗     ● ← 1st
R5 · asks about us   ●     ●     ●     ●     ●     ●     ●     ●     ●     ●     ●
R7 T1 · emotional    ●     ●     ●     ●     ●     ●     ●     ●     ●     ●     ●
R8 · parent          ●     ●     ●     ●     ●     ●     ●     ●     ●*    ●     ●
R11 · out of scope   —     —     —     —     —     —     —     —     —     —     ●
R13 · returning           resume at stored stage — never restart, never re-send B5
3.2-F2 · pure core        terminal under Variant B. Does not enter B4–B10.
R7 T2 · distress          🛑 the flow stops. No node fires. Human owns it.

  ● fires   ✗ skipped, already known   ○ skips only if a field was named
  ◐ half-skips: budget known, location still asked
  * shortlist reweighted: safety · placements · fees · accreditation
```

```
🟥 ⚠ THE ONE THAT IS NEVER SKIPPED

   B5 · THE CHECKLIST fires for every student who reaches it, on every
   path except R4-G and Node 0 — both of which are past the evaluation
   stage and would read the checklist as a delay.

   Everything else in this flow can be skipped by a well-informed
   student. B5 cannot, because it is the only beat that gives before
   it asks, and it is what makes B6's yes mean something.
```

---

# PART 13 · THE DATA LAYER

*The four-layer fix for the re-asking bug. The flow above is only honest if this is underneath it.*

```
LAYER 1 · THE LEAD PROFILE — one persistent object, never rebuilt per phase
────────────────────────────────────────────────────────────────────────────
IDENTITY      phone · name · language · is_parent · proxy · callback_number
SOURCE        source / campaign · door · raw_first_message · created_at
STAGE         stage · botState · temperature
QUALIFICATION qualification · stream · entry_type (regular|lateral|dropper)
              timeline
GOALS         goal · priority[] · career_goal · interests[] ·
              interest_cluster · branch · core_interest
CONSTRAINTS   budget_band · scholarship_flag · city_pref · city · state
PREDICTOR     exam · rank | percentile · category · gender · quota · region
              predicted_colleges[] · filters_used[]
DELIVERY      checklist_sent · frame_sent · permission_recommend ·
              shortlist_shown[] · shortlist_timestamp · fit_college ·
              fit_reason · honest_pass_fired
INTEREST      college_of_interest · concerns[] · hesitations[]
BOOKING       booking_id · slot_datetime · counsellor_id · booking_status
FLAGS         opted_out · spam · out_of_scope · conflict · escalate_human
              bridge_attempted · bridge_closed · status · exit_reason
              followups_sent (0 | 1 | 2)

LAYER 2 · THE SLOT REGISTRY — declarative, with cross-phase reuse
────────────────────────────────────────────────────────────────────────────
Each slot declares: name · which nodes read it · which nodes can fill it ·
the question that asks for it · its extraction patterns · whether a node
SKIPS when it is present.
A slot filled anywhere is filled everywhere. That is the whole point.

LAYER 3 · EXTRACTION ON EVERY INBOUND MESSAGE
────────────────────────────────────────────────────────────────────────────
Not just the messages you expected. R3 and R4 are only possible because
extraction runs unconditionally, merges into the profile, and NEVER
overwrites a filled slot with a blank.

LAYER 4 · nextSlot() — the advancement function
────────────────────────────────────────────────────────────────────────────
The engine asks: what is the next slot this node needs that the profile
does not already have? If the answer is "none", the node is skipped
SILENTLY and the engine advances. No confirmation message. No "I already
have your budget." Just — it doesn't ask.
```

## 13.1 · Slots written by the happy path

```
SLOT                  WRITTEN AT   TYPE          REQUIRED FOR
──────────────────────────────────────────────────────────────────────────
qualification         B1           enum          catalog gating
stream                B1           enum          catalog gating
name                  B1 (webhook) string        every message
source                B1           string        attribution
goal                  B2           enum          B8 framing
interests[]           B3           enum array    B5, B8, B9
interest_cluster      B3           enum          fork routing
core_interest         B3.2         enum          B8/B9 payoff lines
priority[]            B4           enum array    B5 line, B8 weights, B9
checklist_sent        B5           bool          prevents re-send on return
permission_recommend  B6           bool          gates B7–B8, and B10-F
budget_band           B6.5         enum          budgetFit 12
scholarship_flag      B6.5 / B4    bool          B8 aid surfacing
city_pref · city      B6.5         enum/string   locationFit 14
frame_sent            B7           bool          prevents re-send
shortlist_shown[]     B8           id array      counsellor handoff
fit_college           B9           id | null     counsellor handoff
fit_reason            B9           enum          counsellor handoff
honest_pass_fired     B9           bool          ⚠ integrity metric
slot_datetime         B10.2        datetime      the call
callback_number       B10.3        string        the call
booking_id            B10.4        string        lead_status = BOOKED
followups_sent        B10-F        int           enforces L12
```

```
🟥 ⚠ THE TEST FOR THIS LAYER

   Paste "im in 12th mpc, want cse, budget around 3 lakhs, hyderabad
   only" into the bot. If it asks for ANY of those four again, the
   data layer is not done, and no amount of flow redesign will fix it.

   Second test, new in v3: reach B8, close the chat, come back
   tomorrow. If B5's checklist arrives a second time, checklist_sent
   is not being read, and the bot has just told the student it forgot
   the single most useful thing it gave them.
```

---

# PART 14 · EXIT STATES

```
Every conversation ends in exactly one of these.

►► EXIT 1 · BOOKED               slot confirmed, name captured,
                                 confirmation sent, helper mode live
                                 ★ the business objective

►► EXIT 2 · PROCEED / PARKED     shortlist delivered, no booking
                                 ▣ B10-F fires — two nudges, then silence
                                 R13 resumes on fresh intent

►► EXIT 2b · PARKED PRE-VALUE    declined at B6, never got a shortlist
                                 ▣ ONE nudge at 24h, then silence

►► EXIT 3 · SIDE TRACK           Class 10 stream advice · commerce ·
                                 arts · already in college — real help,
                                 different journey

►► EXIT 4 · PREDICTOR CLOSE      rank list delivered, [Stick to my rank
                                 list] ▣ stage = predictor_results
                                 ONE offer made, never re-pitched

►► EXIT 5 · HONEST SCOPE EXIT    3.2-F2 pure core · R11 out of scope
                                 checklist given, closed with dignity
                                 ⚠ NO nudge sequence, ever

►► EXIT 6 · AGENT HANDOFF        AP OC+Male blocked case · repeated
                                 hesitation · explicit "get me a human"

►► EXIT 7 · CLOSED               opted out · spam · wrong number
                                 ⚠ opt-out is permanent

►► EXIT 8 · 🚨 ESCALATED         genuine distress → human, immediately
                                 rare, and the one that matters most
```

---

# PART 15 · BEFORE / AFTER

```
                              SHIPPED     v2 SPEC    v3 (this doc)
  Student turns to booking      ~40           6         8–10
  Permission gates              ~14           1           1
  Typed answers required        ~10           0           1  (name)
  Colleges appear at          turn ~11     turn 5      turn 7
  Value given before any ask     never      never      turn 5  ★
  Commercial disclosure          none        none       B8 ★
  Booking actually completes      no          no        yes ★
  Follow-up messages            3 in 3h    1 ever    2 over 2 days
  Manufactured objections      1 prompt        0           0
```

```
🟧 WHY v3 IS SLOWER THAN v2 AND THAT IS THE RIGHT CALL

   v2 optimised for turns. It got to 6 and colleges at turn 5, and on
   that metric it wins.

   v3 costs 2–4 more turns and buys three things v2 did not have:

     · B5   — the student receives something before being asked to
              commit to anything. This is what makes B6's yes real.
     · B8   — the commercial relationship is disclosed. v2 never did.
     · B10  — a booking that actually exists in a calendar.

   A shorter funnel that produces unconvinced bookings is not a better
   funnel. The metric that decides this is BOOKED → SHOWED UP, not
   turns-to-URL. If show-up rate does not improve, revisit B6.5 and
   B2 first — in that order.
```

---

# PART 16 · WHAT SHIPS UNTOUCHED FROM THE CURRENT BUILD

*Not everything needs changing. These are genuinely good.*

```
✅ Phase 10 guardrail (throws on "guaranteed" / "100%" / "will get")
✅ Phase 12 URL_FORBIDDEN regex
✅ "Why I ask:" lines — now at B6.5, used more
✅ RECOMMENDATION_WEIGHTS matrix, all 9 dimensions
✅ Phase 9 dynamic why-bullet builder → now B9's reason line
✅ NIAT mid-list in the wider catalog, never forced first
✅ All 9 concern classifiers + all 5 hesitation classifiers
✅ Phase 11 escalation copy and its "never on first objection" rule
✅ Post-booking assist unlock → now B10.5
✅ Phase 14 closure copy, all 5 outcomes
✅ Deterministic state machine, no LLM routing
✅ Predictor idempotency (webhook retries are real)
✅ buildPredictionContext → reservation code mapping
✅ The AP OC+Male block itself — the judgement behind it is right
✅ The B1 opening line — "not just the ones with the biggest ads" is
   the best sentence in the company's flow and it survives verbatim
```

---

# PART 17 · WHAT TO INSTRUMENT

*If you track only six things on this flow, track these.*

```
1   B4 → B5 completion %       the four-questions-before-value risk.
                               Below ~85% → merge B3 and B4 into one
                               two-part question. Do NOT shorten B5.

2   B6 yes-rate                the value of B5, measured directly.
                               The cleanest read on whether the
                               checklist is working. This is the
                               single most informative number here.

3   B6.5 drop-off              does asking budget after the checklist
                               cost anything? Prediction: far less
                               than asking it at beat 3 did. If it
                               costs more than ~5%, delete the node
                               and accept the weaker scoring.

4   B8 → B9 yes-rate           whether the disclosure line costs
                               anything. Prediction: it doesn't.
                               Measure it rather than assuming.

5   honest_pass_fired %        ★ if this is 0% across a thousand
                               leads, the fit threshold is dishonest
                               and B9 is theatre.

6   BOOKED → SHOWED UP %       ★★ the only definition of "quality
                               lead" that matters. Everything above is
                               a proxy for this one number.
```

```
🟧 THE COMPARISON THAT SETTLES THE DESIGN ARGUMENT

   Run v2's spine and v3's spine as an A/B on show-up rate, not on
   booking rate. v2 will book more. v3 should have more of those
   bookings turn into people who actually answer the call.

   If that is not true after a few hundred leads on each, the
   honest-disclosure hypothesis is wrong for this market and I would
   want to know that.
```

---

# PART 18 · BUILD ORDER

```
1 ▸ ⚡ I-10 · THE DISTRESS CLASSIFIER
    Before anything else. The only thing here where getting it wrong
    causes real harm rather than a lost lead. Must run BEFORE the
    router in the pipeline, not as a branch inside the flow.

2 ▸ THE DATA LAYER (Part 13)
    Nothing below works without it. The R3 paste test is the gate,
    and checklist_sent is the second gate.

3 ▸ NODE 0 · THE OVERRIDE + B10.2–B10.4
    Node 0 is one regex and an early return — highest ROI per line of
    code in this document. But it now needs B10's slot picker to exist,
    so build them together. A booking override that overrides into
    nothing is worse than none.

4 ▸ B1 → B6 (QUALIFY → PERMISSION)
    The front half of the 55% path. B5 is the beat to get right; if
    the checklist copy is weak, everything downstream weakens with it.

5 ▸ B7 → B10 (TWO MODELS → BOOK)
    The back half. Blocked on the B8 differentiators being written and
    fact-checked, and on the B10 credential answer.

6 ▸ B6.5 · CONSTRAINTS
    Small, conditional, and easy to add or remove once 4 and 5 are
    live. Ship 4 and 5 first, measure, then decide with data.

7 ▸ R2 · R3 · R10
    Typed and messy input. Extraction work, not flow work — lands
    almost free once step 2 exists.

8 ▸ R4-P · THE PREDICTOR + the ⑤ bridge
    Already partly built. The work is: buttons instead of typed
    commands, the blocked-case copy, and the honest two-catalog bridge.

9 ▸ B3.2 · THE CORE FORK (both directions)
    Needs the OPEN ITEMS answered first — NIAT-1, NIAT-2, CAT-1, and
    the Variant A/B call.

10 ▸ R5 – R9, R11 – R13, B10-F
    Copy work, low logic. Fill in as volume justifies.
```

---

# PART 19 · OPEN BEFORE SHIP

## 19.1 · Blocking — the flow cannot ship without these

```
◆ DIFF-1  ★ B8's three differentiator lines must be WRITTEN and
          FACT-CHECKED. The shortlist cannot ship with placeholder
          text, and an unverifiable line is worse than a missing
          college. This is the single hardest blocker in the document
          because it is content work, not engineering.

◆ CRED    ★ Can the counsellor roster guarantee an IIT-graduate for
          every booked lead? If not, B10 ships as "senior counsellor"
          — and the ads should match, or the mismatch surfaces at the
          worst possible moment.

◆ PAID    ★ Is placement in the B8 shortlist EDITORIAL or PAID? If
          money affects the ORDER and not just membership, the
          disclosure line must say so explicitly. "We work with" is
          not sufficient disclosure for paid ordering.

◆ THRESH  ★ B9's honest-pass threshold. Set it BEFORE launch, not
          after seeing conversion numbers — or it will be set to zero.

◆ SLOTS   B10.2 — live counsellor calendar, or a fixed grid? Fixed
          ships faster but breaks the "never show an unavailable slot"
          guard the moment two students pick the same one.
```

## 19.2 · Needed soon, not blocking

```
◆ 6.5-a   Keep B6.5, or run at 8 turns without budgetFit/locationFit?
          Recommendation: keep it, measure #3 in Part 17, decide with
          data after a few hundred leads.

◆ CORE    Can a human GuideXpert counsellor advise on core branches?
          Locked as NO (Variant B). Getting this wrong in the
          OPTIMISTIC direction is the expensive mistake.

◆ FREE    Is the 1-on-1 genuinely free? B1, R5, I-7 and B10 all assert
          it. If it's paid, the price moves into B1.

◆ SCOPE   Does GuideXpert cover medical / law / MBA / arts? R11, I-6
          and four B1 list rows depend on the answer.

◆ NIAT-1  CSE only, or CSE with AI/data specialisations? If
          specialisations exist, name the closest one to the student's
          field at B8 — it converts far better.

◆ NIAT-2  Does NIAT project work genuinely touch robotics /
          automation / simulation? If NO, delete 3.2-P4 and convert on
          the honest pitch alone.

◆ CAT-1   Which catalog colleges carry CORE branches? The pure-core
          fork needs a real shortlist under Variant A.

◆ CAT-2   Can B8 ever mix the predictor's rank-gated colleges with the
          new-age catalog? If yes, the R4-P bridge gets much simpler
          and stronger — "let me rank all of these, yours and mine,
          against your actual goals" — and the two-catalog problem
          disappears entirely.

◆ CAT-3   For a college NOT in the catalog (R4-B), do you have enough
          real information to give an honest read?

◆ DATA    Drop-off by phase from the current build. My prediction: a
          cliff at Phase 4 step 2–3, and a second at Phase 11. If the
          numbers disagree, some cuts in this document are wrong and
          I'd rather find out now than after it ships.
```

---

```
╔═══════════════════════════════════════════════════════════════════════════╗
║  END · GUIDEXPERT MASTER FLOW v3                                          ║
║                                                                            ║
║  Happy path: B1 QUALIFY → B2 GOAL → B3 INTEREST → B4 PRIORITY →           ║
║  B5 CHECKLIST → B6 PERMISSION → B6.5 CONSTRAINTS → B7 TWO MODELS →        ║
║  B8 SHORTLIST → B9 FIT → B10 BOOK                                         ║
║                                                                            ║
║  8–10 student turns · 1 gate · 1 typed answer · value at turn 5 ·          ║
║  colleges at turn 7 · disclosure at B8 · a real booking at B10             ║
║                                                                            ║
║  Say a node ID ("change B8 line 2", "B4 row 5", "R4-C copy") and I'll     ║
║  revise that node only.                                                    ║
╚═══════════════════════════════════════════════════════════════════════════╝
```
