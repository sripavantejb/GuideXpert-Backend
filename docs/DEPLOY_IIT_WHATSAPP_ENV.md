# Production env: IIT counselling WhatsApp

Set these on the **API server** (Vercel/host dashboard). No leading/trailing spaces on keys. Redeploy after saving.

## Shared (required)

| Variable | Purpose |
|----------|---------|
| `ENABLE_WHATSAPP` | `true` |
| `GUPSHUP_API_KEY` | Provider auth |
| `GUPSHUP_SOURCE` | Sender number |
| `GUIDEXPERT_CRON_SECRET` | Protects `/api/cron/*` |

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

Set each value to the Gupshup template UUID from your dashboard.

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

## Cron (external scheduler)

Run **every 1 minute**:

```http
GET /api/cron/send-iit-reminders?key=<CRON_SECRET or GUIDEXPERT_CRON_SECRET>
```

Same auth as other cron routes (`?key=`, `x-cron-key`, or `Authorization: Bearer`).

## Verify

1. **Section 1**: POST `/api/iit-counselling/section1` with `slotBooking` + `slotBookingDate` → slot confirmation WhatsApp (`slot_booked`).
2. **Section 2**: POST `/api/iit-counselling/section2` with `preferredLanguage` (`Telugu` or `Hindi`) → three `WhatsAppReminderJob` rows (`iit_pre2hr`, `iit_pre45min`, `iit_pre15min`) with `scheduledSendAt` = slot − offset.
3. **Cron**: After each offset window, jobs dispatch with the correct Wed/Sat vs Sunday template for the language.
4. **Ops**: Admin → WhatsApp Ops → product **IIT Counselling** → template chips (slot booked, 2hr / 45m / 15m) and language breakdown.

Optional after debugging: `WA_IIT_SEND_TRACE=0` to reduce log volume.
