# Production env: IIT counselling WhatsApp

Set these on the **API server** (Vercel/host dashboard). No leading/trailing spaces on keys. Redeploy after saving.

## Shared (required)

| Variable | Purpose |
|----------|---------|
| `ENABLE_WHATSAPP` | Must be `true` — without it, `safeSendWhatsApp` skips all sends (jobs may still schedule) |
| `GUPSHUP_API_KEY` | Provider auth |
| `GUPSHUP_SOURCE` | Sender number |
| `GUIDEXPERT_CRON_SECRET` or `CRON_SECRET` | Protects `/api/cron/*` |

Local/staging: if reminders show as scheduled in ops but **0 recipients**, confirm `ENABLE_WHATSAPP=true` and Gupshup keys are set in `.env`, then restart the API process.

## Slot confirmation (Section 1 — unchanged)

| Variable | Purpose |
|----------|---------|
| `GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY` | Wed 6PM confirmation |
| `GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SATURDAY` | Sat 6PM confirmation |
| `GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SUNDAY` | Sun 11AM confirmation |
| `GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL` | IMAGE header for confirmation |

Production template IDs (example):

- Wednesday: `da210654-4ab6-42df-8999-dfa9854ba1ca`
- Saturday: `bfa01e16-0609-451f-94c2-756449a71847`
- Sunday: `48267f24-b371-4344-b8e6-495467d5d5f6`
- Header image: `https://res.cloudinary.com/dfqdb1xws/image/upload/v1779169268/image_1_opyelz.png`

## Language-aware reminders (Section 2 — new)

Reminders are **scheduled when Section 2 saves** (`preferredLanguage` = Telugu or Hindi). Template body uses **lead name only**.

### Wed/Sat 6PM (`Wednesday 6PM`, `Saturday 6PM`)

| Variable | When used |
|----------|-----------|
| `GUPSHUP_TEMPLATE_IIT_PRE2HR_TELUGU` | 2 hours before, Telugu |
| `GUPSHUP_TEMPLATE_IIT_PRE2HR_HINDI` | 2 hours before, Hindi |
| `GUPSHUP_TEMPLATE_IIT_PRE45MIN_TELUGU` | 45 minutes before, Telugu |
| `GUPSHUP_TEMPLATE_IIT_PRE45MIN_HINDI` | 45 minutes before, Hindi |
| `GUPSHUP_TEMPLATE_IIT_PRE15MIN_TELUGU` | 15 minutes before, Telugu |
| `GUPSHUP_TEMPLATE_IIT_PRE15MIN_HINDI` | 15 minutes before, Hindi |

### Sunday 11AM (`Sunday 11AM`)

| Variable | When used |
|----------|-----------|
| `GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE2HR_TELUGU` | 2 hours before, Telugu |
| `GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE2HR_HINDI` | 2 hours before, Hindi |
| `GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE45MIN_TELUGU` | 45 minutes before, Telugu |
| `GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE45MIN_HINDI` | 45 minutes before, Hindi |
| `GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE15MIN_TELUGU` | 15 minutes before, Telugu |
| `GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE15MIN_HINDI` | 15 minutes before, Hindi |

Set each value to the Gupshup template UUID from your dashboard (UUID only — no extra characters).

**Common misconfiguration:** `GUPSHUP_TEMPLATE_IIT_PRE45MIN_HINDI` must be a clean UUID. Values copied with stray suffixes (e.g. `₹=`) cause Hindi Wed/Sat 45-minute sends to fail template resolution.

## Optional tuning

| Variable | Default | Purpose |
|----------|---------|---------|
| `WA_IIT_PRE2HR_OFFSET_MS` | `7200000` | 2 hours before slot |
| `WA_IIT_PRE45MIN_OFFSET_MS` | `2700000` | 45 minutes before |
| `WA_IIT_PRE15MIN_OFFSET_MS` | `900000` | 15 minutes before |
| `WA_IIT_PRE2HR_CRON_WINDOW_MS` | mirrors GX pre4hr | Claim window for 2hr jobs |
| `WA_IIT_PRE45MIN_CRON_WINDOW_MS` | mirrors GX meet | Claim window for 45min jobs |
| `WA_IIT_PRE15MIN_CRON_WINDOW_MS` | mirrors GX 30min | Claim window for 15min jobs |
| `WA_IIT_REMINDER_JOB_TTL_MS` | optional | Expire stale pending jobs |
| `WA_IIT_SEND_TRACE` | `1` in dev | Verbose IIT send logs; set `0` in prod |

### Pre2hr template param retry (fixes Meta 132012)

If 2-hour reminders fail with `(#132012) Parameter format does not match`, align Gupshup template body variables with:

| Variable | Purpose |
|----------|---------|
| `GUPSHUP_IIT_PRE2HR_PARAM_PROFILES` | Pipe-separated attempts: e.g. `name\|none\|name,date,time` (attempt 1 = name only, 2 = static, 3 = name+date+time) |
| `GUPSHUP_IIT_PRE2HR_HEADER_IMAGE_URL` | Only if the pre2hr template has an IMAGE header in Gupshup |

After changing profiles, redeploy and run:

```bash
npm run repair:iit-wa-pre2hr -- --dispatch
npm run verify:iit-messaging
```

## Cron (external + Vercel)

**Vercel** (`vercel.json`) runs both IIT crons every minute when `CRON_SECRET` or `GUIDEXPERT_CRON_SECRET` is set (Bearer auth). **cron-job.org** remains recommended as backup with `?key=` on the URL.

## Cron (external scheduler)

Run **every 1 minute**:

```http
GET /api/cron/send-iit-reminders?key=<CRON_SECRET or GUIDEXPERT_CRON_SECRET>
```

Same auth as other cron routes (`?key=`, `x-cron-key`, or `Authorization: Bearer`).

After deploy, verify the route manually (replace host and secret):

```bash
curl -s "https://<API_HOST>/api/cron/send-iit-reminders?key=$GUIDEXPERT_CRON_SECRET"
```

Expect JSON with `jobsClaimed` / `jobsDispatched` ≥ 1 when pending IIT reminder jobs are due. If always zero, check the external scheduler URL, secret, and that Section 2 created jobs (or run `npm run backfill:iit-reminder-jobs -- --execute`).

## One-time index repair (if backfill fails with duplicate `formSubmissionId: null`)

Older deployments may have a non-partial unique index on `(formSubmissionId, messageKind)` that blocks multiple IIT jobs. Sync indexes once:

```bash
npm run sync:wa-reminder-indexes
```

Then run the IIT backfill again.

## Backfill (existing Section 2 bookings)

For submissions that completed Section 2 **before** the retry-group enum fix:

```bash
cd GuideXpert-Backend
npm run backfill:iit-reminder-jobs              # dry-run
npm run backfill:iit-reminder-jobs -- --execute # write jobs
```

## Verify

1. **Section 1**: POST `/api/iit-counselling/section1` with `slotBooking` + `slotBookingDate` → slot confirmation WhatsApp (`slot_booked`).
2. **Section 2**: POST `/api/iit-counselling/section2` with `preferredLanguage` (`Telugu` or `Hindi`) → three `WhatsAppReminderJob` rows (`iit_pre2hr`, `iit_pre45min`, `iit_pre15min`) with `scheduledSendAt` = slot − offset.
3. **Cron**: After each offset window, jobs dispatch with the correct Wed/Sat vs Sunday template for the language.
4. **Ops**: Admin → WhatsApp Ops → product **IIT Counselling** → template chips (slot booked, 2hr / 45m / 15m) and language breakdown.

Optional after debugging: `WA_IIT_SEND_TRACE=0` to reduce log volume.
