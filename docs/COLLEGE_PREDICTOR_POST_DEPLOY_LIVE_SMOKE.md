# College Predictor — Post-Deploy Live Smoke Certification

**Phone:** 9347763131
**Webhook:** https://guide-xpert-backend.vercel.app/webhook/gupshup
**Finished:** 2026-07-18T15:49:32.654Z
**Verdict:** **FULL_PRODUCTION_GO**

## Totals

| Executed | Passed | Failed |
|---:|---:|---:|
| 20 | 20 | 0 |

## Metrics

```json
{
  "avgWebhookMs": 7573,
  "p95WebhookMs": 13002,
  "maxWebhookMs": 13768,
  "webhook4xx5xx": 0
}
```

## Results

- **PASS** [deploy] short counselor welcome deployed
- **PASS** [deploy] menu digit 5 not KEAM
- **PASS** [journey_ts] TS EAMCET full journey + live API
- **PASS** [sticky_filters] sticky CSE filter no crash
- **PASS** [sticky_filters] sticky Government filter
- **PASS** [sticky_filters] sticky named CBIT
- **PASS** [interrupt] sticky noise interrupt
- **PASS** [interrupt] AGAIN restart
- **PASS** [journey_ap] AP EAMCET full journey + AU
- **PASS** [named_college] named entry: Can I get CBIT
- **PASS** [named_college] named entry: Can I get Vasavi
- **PASS** [named_college] named entry: Can I get VNR
- **PASS** [multilingual] roman telugu Na rank
- **PASS** [typos] typo eamset colleges
- **PASS** [slots] out-of-order multi-slot NL
- **PASS** [routing] no FP: rank predictor
- **PASS** [routing] no FP: help me
- **PASS** [routing] no FP: suggest a college
- **PASS** [security] prompt injection safe
- **PASS** [stress] no crash on rapid sticky messages

## Evidence previews

### welcome

```
Sure!
Which entrance exam did you write?

e.g. TS EAMCET, JEE Main, KCET, AP EAMCET
```

### TS_EAMCET

```
Perfect — predicting for your TS EAMCET rank 18453…

Here are your predicted colleges:

Exam: TS EAMCET
Rank/Percentile: 18453
Category: OC
Gender: Female

Top Matches:

1. MAHATMA GANDHI INSTITUTE OF TECHNOLOGY (AUTONOMOUS)
   Branch: ELECTRONICS AND COMMUNICATION ENGINEERING
   Cutoff: 18018

2. CHAITANYA BHARATHI INSTITUTE OF TECHNOLOGY
   Branch: ELECTRICAL AND ELECTRONICS ENGINEERING
   Cutof
```

### AP_EAMCET

```
Perfect — predicting for your AP EAMCET rank 12000…

Here are your predicted colleges:

Exam: AP EAMCET
Rank/Percentile: 12000
Category: BC-A
Gender: Female

Top Matches:

1. SHRI VISHNU ENGG. COLLEGE FOR WOMEN
   Branch: COMPUTER SCIENCE AND ENGINEERING
   Cutoff: 11819

2. R V R AND J C COLLEGE OF ENGINEERING
   Branch: COMPUTER SCIENCE AND ENGINEERING
   Cutoff: 12760

3. VISHNU GRP OF INSTNS -
```


## Recommendation

✅ **FULL PRODUCTION GO** — post-deploy live WhatsApp smoke passed.