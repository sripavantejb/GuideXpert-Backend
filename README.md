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
- 6-digit OTP, configurable expiry (OTP_EXPIRY_MINUTES), single-use.
- Resend cooldown 60s; 3 OTP requests per phone per 15 minutes; max 3 verification attempts per OTP.
