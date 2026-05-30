# Disable stray "Welcome" WhatsApp messages (Gupshup Bot Studio)

## Root cause (confirmed)

GuideXpert uses Gupshup in **webhook mode** — every inbound message is forwarded to our API at `https://guide-xpert-backend.vercel.app/webhook/gupshup` and we reply via the session API.

However Gupshup also has a **Bot Studio** layer that runs in parallel. Bot Studio has a built-in **Welcome Journey** that fires automatically for every message that does not match a configured User Journey keyword. Because our app handles all conversations (no Bot Studio User Journeys configured), Bot Studio considers the user "not inside any journey" for every message and fires the Welcome Journey on every single inbound — sending a separate "Welcome" bubble before our API reply arrives.

```
User sends "hi"
  │
  ├─► Gupshup Bot Studio: no User Journey matched → fires Welcome Journey → sends "Welcome"
  └─► Gupshup webhook: forwards to our API → our API sends "🎓 Hi venkat!..." menu
```

**MongoDB confirms:** zero `WhatsAppOutboundMessage` rows with `textPreview` exactly "Welcome". The Welcome bubble does not come from our code.

---

## Fix — Gupshup Bot Studio console (required, cannot be done via API)

There is no REST API to disable Bot Studio journeys. This must be done in the Gupshup console.

### Step 1 — Open your Gupshup app

1. Log in at **https://app.gupshup.io** (or https://www.gupshup.io → Dashboard)
2. Find your WhatsApp app in **My Apps** / **Dashboard**
3. Click the app name to open it

### Step 2 — Open Bot Studio

Look for one of:
- A top navigation tab called **"Bot Studio"**
- Left sidebar item called **"Bot Studio"** or **"Studio"**
- A button/link called **"Design"** or **"Builder"**

### Step 3 — Delete the Welcome Journey text node

1. In the left panel under **Default Journeys**, click **"Welcome Journey"**
2. The canvas will show a **Starting Node** with a **Text Node** connected to it
3. The Text Node contains the word **"Welcome"** (or similar greeting)
4. **Click the Text Node** to select it
5. Press the **Delete** key (or right-click → Delete)
6. The Starting Node should now have nothing connected to it
7. Click **Save** (top right), then click **Deploy**

### Step 4 — Do the same for the Fallback Journey

1. Click **"Fallback"** in the Default Journeys list
2. Delete any Text Node connected to the Starting Node
3. Save → Deploy

### Step 5 — Verify the callback URL is set to our API

1. In the Gupshup console, go to your app → **Settings** or **Configuration**
2. Find the **Callback URL** / **Webhook URL**
3. It must be: `https://guide-xpert-backend.vercel.app/webhook/gupshup`
4. Save if you changed it

---

## Fix — Meta WhatsApp Manager (turn off Greeting message)

1. Go to [Meta Business Suite](https://business.facebook.com) → WhatsApp accounts → your number
2. **WhatsApp Manager** → **Account tools** → **Phone numbers** → click Settings icon next to your number
3. Under **Automations**, ensure "Greeting message" / "Welcome message" is **turned OFF**

---

## Vercel environment check

Confirm `GUPSHUP_SRC_NAME` is **not** set to `Welcome` on Vercel dashboard. If it is, delete or rename it.

---

## Verify the fix worked

Run the diagnostic script after making changes:

```bash
cd GuideXpert-Backend
node scripts/diagnose-stray-welcome.js 3131
```

Then send `hi` from a test phone. You should see **exactly one** grey bubble containing the full numbered menu (`🎓 Hi venkat!` …). No separate "Welcome" bubble.

If "Welcome" still appears with zero matching rows in `whatsappoutboundmessages` at the same timestamp, the Welcome Journey is still active — re-check that you Saved AND Deployed in Bot Studio.
