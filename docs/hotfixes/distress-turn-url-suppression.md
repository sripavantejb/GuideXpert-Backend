# Distress-turn URL suppression

**Branch:** `hotfix/distress-turn-url-suppression`  
**Defect:** After Branch 4 (`fix/g2b-multipart-delivery`) re-enables parts 2+,
an R7-T1 distress turn (or interrupt-resume) that fallthroughs into a booking
handoff would deliver empathy as bubble 1 and a booking URL as bubble 2.

## Required behaviour

On a turn that carries the R7-T1 empathy prefix (or an interrupt-resume
confirmation prefix), emit **no booking URL in any part / position**. The
prefix still delivers. Booking remains available on a later turn via Node 0 / B7.

Do **not** reorder bubbles to put the URL first — that would satisfy a naïve
“URL must be part 0” guard while making the distress experience worse.

## Touched surfaces

| File | Change |
|---|---|
| `services/chatbot/flowV2/flowV2DistressUrlGuard.js` | **New** — detect URL-bearing parts; `combineWithDistressUrlSuppression` |
| `services/chatbot/flowV2/flowV2Dispatcher.js` | R7-T1 block (~613–626) and interrupt-resume resolve (~559–575) call the guard |
| `test/flowV2DistressUrlSuppression.test.js` | **New** — zero-URL assertion + empathy still delivered |

## Explicitly not fixed here (G-7, deferred)

`node0Override.js` still hardcodes `BOOKING_URL = https://www.guidexpert.co.in/one-on-one-session`
and bypasses Phase 13 `allowUrl` + `BOOKING_SERVICE_REGISTRY`. Documented only;
do not consolidate in this hotfix.

## Merge order

This hotfix must land **before or with** Branch 4. Branch 4 is what arms the defect.
