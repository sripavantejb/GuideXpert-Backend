# Flow V3 TOOL_CONTRACT

Allowlisted tools (snake_case). The broker rejects anything else.

| Tool | Purpose | Side effect |
|---|---|---|
| `next_question` | Deterministic next profile slot from BEAT_ORDER | No |
| `get_curated_catalog` | 10-row curated catalog (`catalog: curated`) | No |
| `get_predictor_matches` | CollegeDost Top Matches (`catalog: predictor`); refuses AP+OC+male | No |
| `get_booking_slots` | Live GuidanceSlot options | No |
| `search_knowledge` | Knowledge chunks with ids for grounding | No |
| `update_lead_profile` | CAS allowlisted profile patch + meta | Yes |
| `create_booking_link` | Official website booking URL (no CRM create) | Yes |
| `escalate_to_human` | Human / crisis handoff | Yes |

## Grounding ids

- Curated rows: `curated:<id>`
- Predictor rows: `predictor:<id>`
- Knowledge: `knowledge:<chunkId>`
- Booking: cite `create_booking_link` result; set `booking_url_slot`

## Refusals

Tools may return `{ refused: true, copy }` — render that copy, do not invent a rank list.
