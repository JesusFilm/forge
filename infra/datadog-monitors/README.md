# Fleet-ceiling Datadog monitors (feat-240)

Monitors-as-code for admin's per-fleet-key search **abuse ceiling**. These are the
three Datadog **log-alert** monitors requested in the spec
[`docs/observability/fleet-ceiling-datadog-monitors.md`](../../docs/observability/fleet-ceiling-datadog-monitors.md)
(§7, "the 3 requested"). They are created from the committed JSON payloads via the
Datadog Monitor API — there is no monitors-as-code convention in the repo yet, so
this directory establishes it (a sibling of `infra/datadog-agent/`, per
`infra/AGENTS.md`).

## What these watch

Admin emits plain-string logs `[search] event=fleet_ceiling.<name> path=… …` from
`apps/admin/src/auth/fleet-ceiling.ts`. Each monitor is a quoted-substring log
query with a 5-minute rollup and `count >= 1`.

| File                     | Event                          | Priority | Fires when                                      | Meaning                                                                                                                           |
| ------------------------ | ------------------------------ | -------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `m1-exceeded.json`       | `fleet_ceiling.exceeded`       | P2       | a key crosses `ceiling+1` (once per 60s window) | abuse or under-sized ceiling. Under `enforce=false` = "would-have-blocked" (calibration signal); under `enforce=true` = real 429s |
| `m2-missing-key-id.json` | `fleet_ceiling.missing_key_id` | P2       | a fleet bearer arrives with no `fleetKeyId`     | derivation bug — should be flat zero                                                                                              |
| `m3-near.json`           | `fleet_ceiling.near`           | P4       | a key hits 80% of ceiling (once per 60s window) | calibration tripwire, not an incident                                                                                             |

> The spec §3 also **recommends** two more — M4 `fleet_ceiling.degraded` (Redis
> fallback) and M5 `fleet_ceiling.error` (ceiling check threw). Only the three
> requested are shipped here; add M4/M5 later by copying a payload and swapping the
> `event=` token, name, message, and priority.

## Prerequisites

- **`DD_API_KEY`** — the `Forge-production` Datadog API key.
- **`DD_APP_KEY`** — a Datadog **application** key (Organization Settings →
  Application Keys → New Key). Monitor writes need both keys.
- Datadog site is **US1** (`datadoghq.com`); override with `DD_SITE` if needed.

## Precondition — verify the log pipeline first

In Datadog → Logs, run `service:forge-admin` and confirm recent admin logs are
arriving. If none are, syslog forwarding isn't active and **every monitor below
will be silently green**. Fix the pipeline (see `docs/observability/datadog.md`)
before trusting these. Note: `.near`/`.exceeded` only fire once a key nears/crosses
the ceiling — at current traffic they may never fire, which is healthy, not broken.

## Before you apply — edit two placeholders

- **Notification channel.** Every payload routes to `@urim.chae@tandem.org.nz`,
  mirroring the existing forge-tv monitor (id `303307205`). This is a **personal
  email**, not a shared channel — swap the `@…` handle in each `message` for a team
  Slack/Teams channel (e.g. `@slack-forge-alerts`) once one exists. For M3
  (`near`, P4) prefer a low-urgency channel or a dashboard over paging.
- **Team tag.** Payloads tag `team:forge`; replace it with your real team tag if
  different.

## Apply

```bash
DD_API_KEY=<forge-production-api-key> \
DD_APP_KEY=<your-datadog-app-key> \
./create.sh
```

`create.sh` validates each payload with `jq`, then POSTs it to `/api/v1/monitor`
and prints the new `{id, name}`. **Re-running creates duplicates** — Datadog has no
create-if-absent. To re-apply, delete the old ones first:

```bash
# list fleet-ceiling monitors
curl -sS "https://api.datadoghq.com/api/v1/monitor/search?query=fleet_ceiling" \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  | jq '.monitors[] | {id, name}'
# delete one
curl -sS -X DELETE "https://api.datadoghq.com/api/v1/monitor/<id>" \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY"
```

## Calibration → enforcement

These monitors are the calibration instrument. Today `enforce=false`, so
`.exceeded` means "would have blocked", not a real 429. Measure the real per-key
peak, size `FLEET_SEARCH_GLOBAL_CEILING_PER_MIN` to ~3–5× peak, then flip
`FLEET_SEARCH_CEILING_ENFORCE=true`. Full sequence + definition of done:
[`docs/observability/fleet-ceiling-datadog-monitors.md`](../../docs/observability/fleet-ceiling-datadog-monitors.md)
§5 and §7.
