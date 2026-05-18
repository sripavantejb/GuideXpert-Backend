# GuideXpert Backend

Multi-step form API with SMS OTP (MSG91), demo slots, and application storage.

## Environment

Copy `.env.example` to `.env` and set:

- `PORT` – server port (default 5000)
- `MONGODB_URI` – MongoDB connection string
- `MSG91_AUTH_KEY` – MSG91 auth key (control.msg91.com)
- `MSG91_TEMPLATE_ID` – DLT template ID for OTP SMS
- `OTP_EXPIRY_MINUTES` – OTP validity in minutes (default 5)
- `OTP_SECRET` – strong random string for HMAC-SHA256 OTP hashing
- `FRONTEND_URL` – allowed CORS origin (e.g. `http://localhost:5173`)
- `CRON_SECRET` – required for `/api/cron/*` routes (query `key` or header `x-cron-key`)
- `OSVI_ABANDONED_DELAY_MS` – optional fallback delay in ms after OTP before abandoned-flow OSVI call is due (default `600000`)
- `OSVI_WEBHOOK_TOKEN` – permanent static bearer token for `POST /api/osvi/call-session`
- `OSVI_ADMIN_API_TOKEN` – permanent static bearer token for OSVI/admin patch APIs

## Run locally

```bash
npm install
cp .env.example .env
# Edit .env with your values
npm run dev
```

## Demo meet (`/meet`) join gate

Registered leads (completed demo booking) may join public `/meet` only during **global live windows** stored in MongoDB (`DemoMeetLiveSchedule`). Configure recurring IST windows in **Admin → Demo meet schedule** (`GET`/`PUT` `/api/admin/demo-meet-schedule`). This is independent of each lead’s originally chosen slot date.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/send-otp | Send OTP (body: fullName, phone, occupation). Rate limit: 3 per phone per 15 min. |
| POST | /api/verify-otp | Verify OTP (body: phone, otp). Marks phone as verified for 15 min. |
| GET | /api/demo-slots | Returns slot1, slot2 objects with id + label (next Sat 7 PM, Sun 3 PM IST). |
| POST | /api/submit-application | Submit form (body: fullName, phone, occupation, demoInterest, selectedSlot). Optional: utm_source, utm_medium, utm_campaign, utm_content. Requires prior verification. |
| POST | /api/save-step1 | Save step 1 (body: fullName, phone, occupation). Optional UTM fields. |
| POST | /api/save-step2 | Save OTP verification (body: phone). Optional UTM fields. |
| POST | /api/save-step3 | Save slot booking (body: phone, selectedSlot, slotDate). Optional UTM fields. Cancels pending abandoned-flow OSVI call for that phone. |
| POST | /api/save-post-registration | Save post-registration data (body: phone, interestLevel, email). Optional UTM fields. |
| POST | /api/osvi/call-session | Store OSVI call session in CRM DB. Requires `Authorization: Bearer <OSVI_WEBHOOK_TOKEN>`. |
| GET | /api/osvi/test | OSVI route test endpoint. |
| GET | /api/osvi/call-sessions | List stored OSVI call sessions for admin panel (admin JWT required). |
| GET | /api/health | Health check. |
| PATCH | /api/admin/leads/slot-by-phone | Update lead slot by phone (body: phone, slotDate, selectedSlot). Uses permanent bearer token `OSVI_ADMIN_API_TOKEN`. |

### Influencer tracking (admin only; require `Authorization: Bearer <token>`)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/influencer-links | Create/generate UTM link (body: influencerName, platform, campaign?, save?). If `save: true`, stores in DB. |
| GET | /api/influencer-links | List all saved influencer links. |
| GET | /api/influencer-analytics | Aggregated registrations by utm_content. Query: `from`, `to` (ISO date), `sort` (registrations \| latest). |

Backend optional env: `REGISTRATION_BASE_URL` — base URL for generated UTM links (default: `https://guidexpert.co.in/register`).

### Blogs (public read; admin write requires `Authorization: Bearer <admin token>`)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/blogs | List blogs (newest first). Optional query: `limit`. |
| GET | /api/blogs/:id | Single blog by MongoDB id. |
| POST | /api/admin/blogs | Create blog (body: title, subtitle, category, coverImage, content, author?). |
| PUT | /api/admin/blogs/:id | Update blog. |
| DELETE | /api/admin/blogs/:id | Delete blog. |

Seed sample articles (only if collection is empty): `npm run seed:blogs`

## Cron (production)

Set `CRON_SECRET` / `GUIDEXPERT_CRON_SECRET` in the environment. Schedule HTTP calls (e.g. Vercel Cron or external scheduler) **every minute** where applicable:

| GET | Path | Purpose |
|-----|------|---------|
| | `/api/cron/send-reminders` | Reminder SMS + pre4hr WhatsApp: **deadline-backward** band — `step3Data.slotDate` must fall in the last `WA_PRE4HR_CRON_WINDOW_MS` before `now + WA_PRE4HR_OFFSET_MS` (default 4h / 10m), so nothing sends **before** true T−4h. Optional `WA_SLOT_CRON_DEADLINE_FORWARD_SLACK_MS` (default 0) extends the upper bound slightly for late cron ticks. Tune offsets/windows in `.env`. Call this route at least as often as the window width (e.g. every minute or every 5 minutes). |
| | `/api/cron/send-meetlinks` | Meet link SMS + meet WhatsApp: same **deadline-backward** semantics with `WA_MEET_OFFSET_MS` / `WA_MEET_CRON_WINDOW_MS` (defaults 1h / 10m). |
| | `/api/cron/send-30min-reminders` | 30min reminder SMS + WhatsApp: same pattern with `WA_30MIN_OFFSET_MS` / `WA_30MIN_CRON_WINDOW_MS` (defaults 30m / 10m). |
| | `/api/cron/retry-whatsapp` | Promote retry-eligible WhatsApp failures to Retry 1 / Retry 2 using existing retry orchestrator |
| | `/api/cron/osvi-outbound-due` | OSVI outbound calls due for abandoned Apply flows (`?key=` or `x-cron-key` header) |

Use the same `key` query param, `x-cron-key` header, or `Authorization: Bearer <CRON_SECRET>` (Vercel Cron uses the Bearer form when `CRON_SECRET` is set in the project). [`vercel.json`](vercel.json) schedules all four campaign routes every minute: `send-reminders`, `send-meetlinks`, `send-30min-reminders`, and `retry-whatsapp`. `WA_SLOT_CRON_DEADLINE_FORWARD_SLACK_MS` is ignored by design. Redeploy after changing cron config.

### Retry orchestration verification checklist

After deployment, verify these to confirm automatic Retry 1/Retry 2 promotion is working:

1. `MessagingCronRun` has recurring rows with `jobKey=retry_whatsapp` and `trigger=cron`.
2. Cron logs include `[Cron] Retry WhatsApp batch result` with non-zero `found` when failures exist.
3. Attempt 2 rows appear in `WhatsAppMessageEvent` for eligible attempt-1 failures after cooldown.
4. Attempt 3 rows appear only for remaining attempt-2 failures (campaign templates only).
5. `slot_booked` remains immediate-only and does not use campaign Retry 1/Retry 2 promotion.

**Campaign retry delays:** Optional env `WA_PRE4HR_RETRY_DELAY_MINUTES`, `WA_MEET_RETRY_DELAY_MINUTES`, `WA_30MIN_RETRY_DELAY_MINUTES` (comma-separated minutes, e.g. `1,2`). Matching `WA_*_RETRY_COOLDOWN_MINUTES` (default 0) should stay low so stage delays are not overridden by a global floor.

**OSVI:** Set `OSVI_API_TOKEN` and `OSVI_AGENT_UUID` on the deployment (e.g. Vercel Environment Variables). If `OSVI_AGENT_UUID` is missing, abandoned-flow calls will not be scheduled (`isOsviConfigured()` is false).

Without `/api/cron/osvi-outbound-due` running on a schedule, delayed OSVI calls will not execute on serverless hosts.

Optional fallback: `OSVI_ABANDONED_DELAY_MS` (default `600000`) — delay from OTP until abandoned-flow outbound call runs. Admin panel OSVI settings can override this delay at runtime.

### OSVI slot update integration

Use this endpoint from OSVI tool/action when the caller confirms a booked slot:

`PATCH /api/admin/leads/slot-by-phone`

Headers:

- `Authorization: Bearer <OSVI_ADMIN_API_TOKEN>`
- `Content-Type: application/json`

Body:

```json
{
  "phone": "9876543210",
  "slotDate": "2026-04-08",
  "selectedSlot": "TUESDAY_6PM"
}
```

**Vercel:** Slot booking uses `@vercel/functions` `waitUntil` so the OSVI request runs after the delay without relying only on cron. [`vercel.json`](vercel.json) sets `functions.server.js.maxDuration` to **300** seconds so the configured wait (default 10s) plus the OSVI HTTP call can finish (raise this in the dashboard if your plan allows). Hobby plans may cap duration at 10s — if calls still never fire, upgrade or rely on `/api/cron/osvi-outbound-due` every minute.

### OSVI call-session webhook

Generate a permanent webhook token once:

```bash
node utils/generateToken.js
```

Add the printed value to `.env`:

```bash
OSVI_WEBHOOK_TOKEN=your_generated_token
```

Test route:

```bash
curl -X GET http://localhost:5000/api/osvi/test
```

Webhook ingest test:

```bash
curl -X POST http://localhost:5000/api/osvi/call-session \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "callId": "call_123",
    "phone": "+916300203798",
    "agentName": "Demo Invitation Agent",
    "callType": "outbound",
    "duration": 28,
    "status": "picked",
    "recordingUrl": "https://recording-url",
    "summary": "User interested in demo",
    "transcript": "Assistant spoke with user",
    "tag": "interesting lead",
    "endReason": "silence-timed-out",
    "endedBy": "agent",
    "callTime": "2026-04-06T12:01:49Z"
  }'
```

## Security

- OTP hashed with HMAC-SHA256 (`OTP_SECRET`), never stored in plain text.
- 6-digit OTP, configurable expiry (OTP_EXPIRY_MINUTES), single-use.
- Resend cooldown 60s; 3 OTP requests per phone per 15 minutes; max 3 verification attempts per OTP.
