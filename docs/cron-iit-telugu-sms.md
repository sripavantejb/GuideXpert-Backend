# IIT Telugu SMS — external cron (cron-job.org)

Telugu counselling SMS uses a **different** endpoint than IIT WhatsApp reminders.

| Job | Endpoint | Collection / channel |
|-----|----------|----------------------|
| IIT WhatsApp (`iitmessages`) | `/api/cron/send-iit-reminders` | `WhatsAppReminderJob` |
| **IIT Telugu SMS** (this doc) | `/api/cron/send-iit-telugu-sms` | `IitTeluguSmsReminderJob` / MSG91 |

Vercel also runs `/api/cron/send-iit-telugu-sms` every minute (`vercel.json`). Adding cron-job.org is optional but recommended as a backup if Vercel cron auth or scheduling fails.

## Create the cron job

1. Open **[cron-job.org — Create job](https://console.cron-job.org/jobs/create)** (sign in if needed).
2. **Title:** `IIT Telugu SMS` (or `iit-telugu-sms`).
3. **URL:** run locally to copy the full URL with your secret:
   ```bash
   npm run cron:url:iit-telugu-sms
   ```
   Or build manually:
   ```
   https://guide-xpert-backend.vercel.app/api/cron/send-iit-telugu-sms?key=<GUIDEXPERT_CRON_SECRET or CRON_SECRET>
   ```
4. **Schedule:** every **1** minute (`* * * * *` or “Every minute” in the UI).
5. **Request method:** `GET`.
6. **Timeout:** **60** seconds or more (do not use 30s — IIT WhatsApp cron can be slow; Telugu SMS is usually fast).
7. **Enabled:** yes.

Keep your existing **`iitmessages`** job pointed at `send-iit-reminders` if you still send IIT WhatsApp reminders. Do not replace that URL with the SMS URL.

## Verify

Browser or curl should return:

```json
{
  "success": true,
  "message": "IIT Telugu SMS jobs processed",
  "stats": { "scheduler": "iit_telugu_sms_job_v1", ... }
}
```

Wrong endpoint returns `"scheduler": "iit_reminder_job_v1"` (WhatsApp only).

## Troubleshoot

```bash
npm run diagnose:iit-telugu-sms -- --phone <10-digit>
npm run diagnose:iit-telugu-sms -- --list-recent 10
```
