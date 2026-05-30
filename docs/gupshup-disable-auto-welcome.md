# Disable stray "Welcome" WhatsApp messages (Gupshup / Meta)

If users see a short **"Welcome"** bubble before (or instead of) the GuideXpert chatbot menu, that message is usually **not** from our backend API. MongoDB `WhatsAppOutboundMessage` rows for the same time will show the full menu text (`Hi <name>!` …), not `Welcome` alone.

Our chatbot sends **one plain-text reply** per inbound (`sendMainMenu` → `sendBotTextReply` only).

## Where "Welcome" comes from

| Source | In Mongo outbound? | Fix |
|--------|-------------------|-----|
| Gupshup **Journey / Bot** first node | No | Disable or change the Journey in Gupshup console |
| Meta **Greeting / Welcome message** | No | WhatsApp Manager → phone number → messaging tools |
| **Icebreaker** or default reply | No | Clear in Meta Business settings |
| `GUPSHUP_SRC_NAME=Welcome` on Vercel | Sometimes odd labels | Unset or use your app name, not `Welcome` |
| GuideXpert chatbot code | Yes (full menu text) | Already text-only; deploy latest backend |

## Gupshup console checklist

1. Log in to [Gupshup](https://www.gupshup.io/) → your WhatsApp app.
2. Open **Bot / Journey / Workflow** (name varies by account).
3. Find any **start node** or **default reply** that sends text `Welcome` → **disable** the Journey or change the message.
4. Ensure the **webhook URL** points to your API only:  
   `https://<your-api-host>/webhook/gupshup`  
   (not a Gupshup-only bot that replies before the webhook).
5. Under app settings, check **Welcome message** / **Session message** templates — clear if set to `Welcome`.

## Meta WhatsApp Manager checklist

1. [Meta Business Suite](https://business.facebook.com/) → WhatsApp accounts → your number.
2. **WhatsApp Manager** → **Account tools** → **Greeting message** (or **Welcome message**).
3. Turn **off** or replace text that says only `Welcome`.
4. Review **Icebreakers** — remove entries that say `Welcome`.

## Vercel environment

Confirm these are **not** set incorrectly:

- `GUPSHUP_SRC_NAME` — must not be `Welcome`
- `CHATBOT_USE_BUTTON_MENU` / `CHATBOT_INTERACTIVE_MAIN_MENU` — not required; main menu is plain text

Optional for users outside the 24h session window:

```bash
CHATBOT_SESSION_FALLBACK_TEMPLATE_ENV=GUPSHUP_TEMPLATE_YOUR_MENU_OR_NUDGE
GUPSHUP_TEMPLATE_YOUR_MENU_OR_NUDGE=<approved-template-uuid>
```

## Verify after changes

1. Send `hi` from a test phone.
2. You should see **one** grey bubble with the full menu (numbered options).
3. In MongoDB:

```javascript
// One outbound per inbound; preview should start with "Hi" or emoji salutation, not "Welcome"
db.whatsappoutboundmessages.find({ phone: "<phone10>" }).sort({ createdAt: -1 }).limit(3)
```

4. Production health:

```bash
cd GuideXpert-Backend && npm run check:whatsapp:production
```

If `Welcome` still appears and **no** matching row exists in `whatsappoutboundmessages`, it is entirely from Gupshup/Meta — repeat the console steps above.
