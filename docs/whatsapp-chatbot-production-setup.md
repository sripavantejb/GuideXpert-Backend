# WhatsApp chatbot — production setup

## Diagnosis (2026-05-30)

**Webhook auth (updated):** Inbound webhooks are accepted when `GUPSHUP_WEBHOOK_SECRET` is **not** set (Gupshup dev callback without headers). Auth is enforced automatically once you add `GUPSHUP_WEBHOOK_SECRET` on Vercel. To require a secret before it is configured, set `GUPSHUP_WEBHOOK_AUTH_REQUIRED=1` (returns **503** if secret missing). Set `GUPSHUP_WEBHOOK_AUTH_REQUIRED=0` to keep webhooks open even after a secret exists.

**MongoDB:** Last `WhatsAppInboundMessage` was `2026-05-29T12:08:05Z` (processed). **Zero** inbound rows since — consistent with webhooks rejected at the edge after webhook auth was enforced without a Vercel secret.

After deploy, confirm with `GET /api/health` — `whatsapp.ready` must be `true` and `whatsapp.issues` must be empty.

```bash
npm run check:whatsapp:production
```

## Required Vercel environment variables (Production)

| Variable | Purpose |
|----------|---------|
| `ENABLE_WHATSAPP` | `true` |
| `GUPSHUP_API_KEY` | Gupshup API key (session + template sends) |
| `GUPSHUP_SOURCE` | Registered WhatsApp sender number (digits) |
| `GUPSHUP_WEBHOOK_SECRET` | Shared secret for `POST /webhook/gupshup` |
| `MONGODB_URI` | Conversations / inbound / outbound persistence |
| `CRON_SECRET` or `GUIDEXPERT_CRON_SECRET` | Vercel cron auth for `process-chatbot-inbound` |
| `CHATBOT_SCOPE_FIREWALL_ENABLED` | **`1` required in production** — enables inbound scope firewall |
| `CHATBOT_SCOPE_FIREWALL_SHADOW_MODE` | **`0` or unset (enforce)** — blocks out-of-scope queries before any answer LLM. Set `1` only for log-only shadow rollout |
| `CHATBOT_SCOPE_CLASSIFIER_ENABLED` | `1` recommended — semantic classifier for ambiguous messages |
| `LLM_API_KEY` | Required when knowledge assistant / classifier are enabled |

Optional: `GUPSHUP_SRC_NAME` (must not be `Welcome`), session fallback template vars (see `.env.example`).

Main menu is **plain text only** (no interactive list/button). Do not set `CHATBOT_USE_BUTTON_MENU` unless you have a specific reason.

### Stray "Welcome" bubble before the menu

If users see a separate short message **Welcome** before the real menu, it is almost always configured in **Gupshup or Meta**, not in this codebase. See [gupshup-disable-auto-welcome.md](./gupshup-disable-auto-welcome.md).

Do **not** set `CHATBOT_ENABLED=0` unless disabling the bot intentionally.

Generate a webhook secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Gupshup console

1. **Callback URL:** `https://guide-xpert-backend.vercel.app/webhook/gupshup`  
   (Use your live API host if different.)

2. **Webhook secret:** Send the same value as `GUPSHUP_WEBHOOK_SECRET` using either:
   - HTTP header `x-webhook-secret: <secret>`, or
   - Query string: `https://.../webhook/gupshup?secret=<secret>`

3. Redeploy the backend after changing Vercel env vars.

## Verify

```bash
# Config flags (after deploy)
curl -sS https://guide-xpert-backend.vercel.app/api/health | jq .whatsapp

# Webhook auth (should be 401 without secret, not 503)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST \
  https://guide-xpert-backend.vercel.app/webhook/gupshup \
  -H "Content-Type: application/json" -d '{"type":"message"}'

# With secret (replace SECRET)
curl -sS -X POST "https://guide-xpert-backend.vercel.app/webhook/gupshup" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: SECRET" \
  -d '{"type":"message","payload":{"source":"919876543210","id":"smoke-test","payload":{"type":"text","text":"hi"}}}'
```

Send a real WhatsApp message; check Vercel logs for `[chatbot]` and Mongo `WhatsAppInboundMessage` with `processStatus: processed`.

## Scope firewall (production)

The student WhatsApp chatbot enforces a **scope firewall** before any answer LLM (Knowledge Assistant, ICE, ICS, CPA). Blocked queries (programming, trivia, injection, etc.) receive a standard refusal and **never** reach answer generation. Empty RAG retrieval also short-circuits without calling the answer LLM.

**Required for production:**

```bash
CHATBOT_SCOPE_FIREWALL_ENABLED=1
# enforce mode is the default when unset; do not set shadow in production
CHATBOT_SCOPE_FIREWALL_SHADOW_MODE=0
```

Verify on deploy:

```bash
curl -sS https://guide-xpert-backend.vercel.app/api/health | jq '.scopeFirewall'
# expect: enabled=true, shadowMode=false, enforceMode=true, productionReady=true
```

Offline regression (500+ prompts):

```bash
node scripts/generateScopeFirewallCertPrompts.js
node scripts/scopeFirewallCertification.js --orchestrator-sample=50
node scripts/scopeFirewallSmoke500.js
npm test -- test/scopeFirewallMatrix.test.js test/scopeFirewallRagGuard.test.js test/scopeFirewallCertification.test.js
```

## Cron replay

`vercel.json` schedules `GET /api/cron/process-chatbot-inbound` every minute to replay `pending` inbound rows after transient send failures.
