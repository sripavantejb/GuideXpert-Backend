# GuideXpert · Happy Flow B8–B10 (product overlay)

**Option 3 (company Stage 1–10):** PCM happy path uses company verbatim copy and stage order. B6.5 budget/location is **skipped** after permission Yes.

Scope note: B1–B7 company copy lives in `flowV2/nodes/*` (greeting → b7TwoModels). This overlay covers B8–B10 product shape.

## B8 · Shortlist (6 colleges, one WhatsApp bubble)

Shows new-age colleges with medal framing + two more peers, **in the same button interactive** as the fit ask (so WhatsApp never drops the college list):

1. 🥇 Newton School of Technology  
2. 🥈 NIAT  
3. 🥉 Scaler  
4. Polar School of Technology  
5. Plaksha University  
6. Kalvium  

Company Stage 8 body (no partnership disclosure pitch on the happy path). Wider catalog available on typed ask.

## B9 · Fit ask → NIAT soft nudge

Ask: *Would you like me to help you find the best fit?*

- **Yes, help me** → company Stage 9 NIAT soft nudge (AI & Tech / practical / projects / placements) → **same turn** Stage 10 booking invite.  
- **I'll explore myself** → honour once, warm park.  
- Honest pass only for clearly out-of-catalog profiles.

## B10 · Hybrid book (IITian copy)

Company Stage 10 offer (FREE 1:1 with an **IITian**) → live slots in chat → official website URL only. WhatsApp never creates CRM bookings (`HYBRID_BOOKING_WEBSITE_CREATE`).

Buttons: **📅 Book My Session** / **Maybe Later**.

### Maybe Later follow-ups (+30m / +1h / +3h)

Scheduled on `profile.bookingFollowup` when the student taps Maybe Later. Cron: `GET /cron/process-booking-followups` (see `bookingFollowupService.js` + `processBookingFollowups.js`).
