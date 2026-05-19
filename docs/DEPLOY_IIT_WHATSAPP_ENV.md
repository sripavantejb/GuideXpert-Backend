# Production env: IIT slot_booked WhatsApp

Set these on the **API server** (Vercel/host dashboard). No leading/trailing spaces on keys. Redeploy after saving.

| Variable | Value |
|----------|--------|
| `ENABLE_WHATSAPP` | `true` |
| `GUPSHUP_API_KEY` | (existing) |
| `GUPSHUP_SOURCE` | (existing) |
| `GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY` | `da210654-4ab6-42df-8999-dfa9854ba1ca` |
| `GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SATURDAY` | `bfa01e16-0609-451f-94c2-756449a71847` |
| `GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SUNDAY` | `48267f24-b371-4344-b8e6-495467d5d5f6` |
| `GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL` | `https://res.cloudinary.com/dfqdb1xws/image/upload/v1779169268/image_1_opyelz.png` |

Optional after debugging: `WA_IIT_SEND_TRACE=0` to reduce log volume.

## Verify one booking

1. POST `/api/iit-counselling/section1` with `slotBooking` + `slotBookingDate`.
2. Logs: `iit_wa_send_trace` → `sendTemplateMessage_before_axios` with `hasMessageField: true` and `outboundBodyString` containing `message=`.
3. Ops: status `submitted` → `delivered`/`read`, not `messagePayload is not defined` or missing header URL.
