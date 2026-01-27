# GuideXpert Backend

Multi-step form API with WhatsApp OTP (Gupshup Sandbox), demo slots, and application storage.

## Environment

Copy `.env.example` to `.env` and set:

- `PORT` – server port (default 5000)
- `MONGODB_URI` – MongoDB connection string
- `GUPSHUP_API_KEY` – Gupshup API key
- `GUPSHUP_SANDBOX_SOURCE` – Gupshup sandbox WhatsApp source (e.g. `917834811114`)
- `GUPSHUP_APP_NAME` – Gupshup app name from dashboard
- `OTP_SECRET` – strong random string for HMAC-SHA256 OTP hashing
- `FRONTEND_URL` – allowed CORS origin (e.g. `http://localhost:5173`)

## Run locally

```bash
npm install
cp .env.example .env
# Edit .env with your values
npm run dev
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/send-otp | Send OTP (body: fullName, phone, occupation). Rate limit: 3 per phone per 15 min. |
| POST | /api/verify-otp | Verify OTP (body: phone, otp). Marks phone as verified for 15 min. |
| GET | /api/demo-slots | Returns slot1, slot2 objects with id + label (next Sat 7 PM, Sun 3 PM IST). |
| POST | /api/submit-application | Submit form (body: fullName, phone, occupation, demoInterest, selectedSlot). Requires prior verification. |
| GET | /api/health | Health check. |

## Security

- OTP hashed with HMAC-SHA256 (`OTP_SECRET`), never stored in plain text.
- 6-digit OTP, 5 min expiry, single-use.
- 3 OTP requests per phone per 15 minutes.
