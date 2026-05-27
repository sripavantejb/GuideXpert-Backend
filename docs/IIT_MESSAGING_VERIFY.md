# IIT messaging verification checklist

Run after deploy (`main` ≥ `7beac67`):

```bash
npm run verify:iit-messaging
npm run verify:iit-messaging:ping   # optional live cron ping
```

## Vercel env (production)

- Gupshup: `ENABLE_WHATSAPP`, `GUPSHUP_API_KEY`, `GUPSHUP_SOURCE`, all IIT template UUIDs
- Pre2hr: `GUPSHUP_IIT_PRE2HR_PARAM_PROFILES` (see [DEPLOY_IIT_WHATSAPP_ENV.md](./DEPLOY_IIT_WHATSAPP_ENV.md))
- MSG91: `MSG91_AUTH_KEY` + six `MSG91_IIT_TELUGU_SMS_*` template IDs
- Cron: `GUIDEXPERT_CRON_SECRET` or `CRON_SECRET`

## cron-job.org

| Job | URL path | Timeout |
|-----|----------|---------|
| `iitmessages` | `/api/cron/send-iit-reminders` | ≥ 60s |
| `iitsmstelugu` | `/api/cron/send-iit-telugu-sms` | ≥ 60s |

Expect schedulers: `iit_reminder_job_v1` and `iit_telugu_sms_job_v1`.

## Gupshup pre2hr template audit

1. Open Gupshup dashboard for `GUPSHUP_TEMPLATE_IIT_PRE2HR_TELUGU` and `_HINDI`.
2. Count body variables (0 / 1 / 3).
3. Set `GUPSHUP_IIT_PRE2HR_PARAM_PROFILES` on Vercel to match (default in code: `name|none|name,date,time`).
4. If template has IMAGE header, set `GUPSHUP_IIT_PRE2HR_HEADER_IMAGE_URL`.

## Recovery commands

```bash
npm run repair:iit-wa-pre2hr -- --dispatch
npm run repair:iit-telugu-sms-tminus2h -- --execute
npm run diagnose:iit-telugu-sms -- --list-recent 10
```

## MSG91 NDNC

Submitted + 0% delivered with NDNC DND is carrier blocking, not an automation bug. Use WhatsApp for those users.
